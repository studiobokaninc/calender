import logging
import os
import base64
import hmac
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from .. import crud, models, security, google_calendar as google_cal
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/google", tags=["Google Calendar Sync"])

class TaskGoogleSyncRequest(BaseModel):
    sync: bool  # True=表示する, False=表示しない

class BulkTaskGoogleSyncRequest(BaseModel):
    task_ids: List[int]
    sync: bool

def _google_state_sign(user_id: int) -> str:
    """state パラメータ用: user_id を署名付きでエンコード"""
    raw = str(user_id).encode("utf-8")
    sig = hmac.new(security.SECRET_KEY.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(raw).decode("utf-8") + "." + sig


def _google_state_verify(state: str) -> Optional[int]:
    """state を検証して user_id を返す。無効なら None"""
    try:
        part = state.split(".")
        if len(part) != 2:
            return None
        raw = base64.urlsafe_b64decode(part[0].encode("utf-8")).decode("utf-8")
        user_id = int(raw)
        expected = hmac.new(security.SECRET_KEY.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(part[1], expected):
            return None
        return user_id
    except Exception:
        return None

@router.get("/status")
def google_calendar_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Google カレンダー連携の設定状況と、連携済みタスク/イベントIDリストを返す"""
    configured = google_cal.is_google_configured()
    token = crud.get_user_google_token(db, current_user.id) if configured else None
    connected = token is not None
    synced_task_ids = crud.get_synced_task_ids_for_user(db, current_user.id) if connected else []
    synced_event_ids = crud.get_synced_event_ids_for_user(db, current_user.id) if connected else []
    return {
        "configured": configured,
        "connected": connected,
        "synced_task_ids": synced_task_ids,
        "synced_event_ids": synced_event_ids,
    }

@router.get("/authorize")
def google_calendar_authorize(
    current_user: models.User = Depends(security.get_current_user),
):
    """Google 認証ページの URL を返す"""
    if not google_cal.is_google_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google 連携が設定されていません。"
        )
    state = _google_state_sign(current_user.id)
    url = google_cal.get_authorize_url(state=state)
    if not url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="認証URLを生成できません。"
        )
    return {"url": url}

@router.get("/callback")
def google_calendar_callback(
    background_tasks: BackgroundTasks,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """OAuth コールバック"""
    frontend_base = os.getenv("FRONTEND_URL", "http://localhost:5175")
    
    if error:
        logger.error(f"Google OAuth error: {error}")
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason={error}")
    
    if not code or not state:
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=missing_params")
    
    user_id = _google_state_verify(state)
    if user_id is None:
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=invalid_state")
    
    try:
        tokens = google_cal.exchange_code_for_tokens(code)
        if not tokens:
            return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=token_exchange_failed")
            
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in")
        expires_at = None
        if expires_in is not None:
            expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
            
        crud.upsert_user_google_token(
            db, user_id=user_id, access_token=access_token, refresh_token=refresh_token, expires_at=expires_at
        )

        from app.services.google_sync import initial_sync_for_user_bg
        background_tasks.add_task(initial_sync_for_user_bg, user_id)
        
    except Exception as e:
        logger.exception(f"Google token exchange exception: {e}")
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=token_exchange_exception")
    
    return RedirectResponse(url=f"{frontend_base}/calendar?google=connected")

@router.delete("/disconnect")
def google_calendar_disconnect(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Google 連携を解除"""
    from app.services.google_sync import cleanup_all_google_events_bg
    background_tasks.add_task(cleanup_all_google_events_bg, current_user.id)
    return {"message": "Google 連携解除のプロセスを開始しました"}

@router.post("/sync/task/{task_id}")
def google_calendar_sync_task(
    task_id: int,
    body: TaskGoogleSyncRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """タスク同期 ON/OFF"""
    if not google_cal.is_google_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google 連携が設定されていません")
    
    token_row = crud.get_user_google_token(db, current_user.id)
    if not token_row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="先に Google カレンダーと連携してください")
    
    db_task = crud.get_task(db, task_id=task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="タスクが見つかりません")

    if body.sync:
        if db_task.display_status == 'offline':
            db_task.display_status = 'online'
            db.commit()
            
        from app.services.google_sync import sync_task_to_google
        try:
            success = sync_task_to_google(db, db_task, token_row, current_user.id)
            if success:
                return {"synced": True, "message": "タスクを Google カレンダーに追加しました"}
            else:
                return {"synced": False, "message": "タスクはオフライン設定のため同期されませんでした"}
        except Exception as e:
            logger.exception(f"Manual sync failed: {e}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Google カレンダーへの同期に失敗しました: {str(e)}")
    else:
        sync_row = crud.get_task_google_sync(db, current_user.id, task_id)
        if sync_row:
            google_cal.delete_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at, sync_row.google_event_id, calendar_id=token_row.calendar_id
            )
            crud.delete_task_google_sync(db, current_user.id, task_id)
        return {"synced": False, "message": "Google カレンダーからの表示を解除しました"}

@router.post("/sync/tasks/bulk")
def google_calendar_sync_tasks_bulk(
    body: BulkTaskGoogleSyncRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """一括同期"""
    if not google_cal.is_google_configured():
        raise HTTPException(status_code=503, detail="Google 連携が設定されていません")
    token_row = crud.get_user_google_token(db, current_user.id)
    if not token_row:
        raise HTTPException(status_code=400, detail="先に Google カレンダーと連携してください")
    
    from app.services.google_sync import sync_task_to_google
    count = 0
    skipped = 0
    errors = 0
    
    for tid in body.task_ids:
        db_task = crud.get_task(db, task_id=tid)
        if not db_task:
            skipped += 1
            continue
        
        if body.sync:
            try:
                if db_task.display_status == 'offline':
                    db_task.display_status = 'online'
                    db.commit()
                success = sync_task_to_google(db, db_task, token_row, current_user.id)
                if success: count += 1
                else: skipped += 1
            except Exception as e:
                errors += 1
        else:
            try:
                sync_row = crud.get_task_google_sync(db, current_user.id, tid)
                if sync_row:
                    google_cal.delete_calendar_event(
                        token_row.access_token, token_row.refresh_token, token_row.expires_at, sync_row.google_event_id, calendar_id=token_row.calendar_id
                    )
                    crud.delete_task_google_sync(db, current_user.id, tid)
                    count += 1
                else: skipped += 1
            except Exception as e:
                errors += 1
    
    return {"message": f"{count} 件のタスクを更新しました", "count": count, "skipped": skipped, "errors": errors}

@router.post("/sync/event/{event_id}")
def google_calendar_sync_event(
    event_id: int,
    body: TaskGoogleSyncRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """イベント同期"""
    if not google_cal.is_google_configured():
         raise HTTPException(status_code=503, detail="Google 連携が設定されていません")
    token_row = crud.get_user_google_token(db, current_user.id)
    if not token_row:
        raise HTTPException(status_code=400, detail="先に Google カレンダーと連携してください")
    db_event = crud.get_event(db, event_id=event_id)
    if not db_event:
        raise HTTPException(status_code=404, detail="イベントが見つかりません")

    from app.services.google_sync import sync_event_to_google
    if body.sync:
        try:
            sync_event_to_google(db, db_event, token_row, current_user.id)
            return {"synced": True, "message": "イベントを Google カレンダーに追加しました"}
        except Exception as e:
            logger.exception(f"Manual event sync failed: {e}")
            raise HTTPException(status_code=502, detail="Google カレンダーへの同期に失敗しました")
    else:
        sync_row = crud.get_event_google_sync(db, current_user.id, event_id)
        if sync_row:
            google_cal.delete_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at, sync_row.google_event_id, calendar_id=token_row.calendar_id
            )
            crud.delete_event_google_sync(db, current_user.id, event_id)
        return {"synced": False, "message": "Google カレンダーからの表示を解除しました"}

@router.get("/sync/tasks")
def google_calendar_synced_tasks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """表示中タスクリスト"""
    ids = crud.get_synced_task_ids_for_user(db, current_user.id)
    return {"task_ids": ids}
