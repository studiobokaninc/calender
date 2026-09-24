import logging
import os
import base64
import hmac
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, Header
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from .. import crud, models, security, google_calendar as google_cal
from ..database import get_db
from ..services.google_sync import (
    _ensure_shared_token_updated,
    _ensure_user_calendar,
    initial_sync_for_user_bg,
    disconnect_user_calendar_bg,
    disconnect_shared_account_bg,
    sync_task_to_google,
    sync_event_to_google,
)

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
    """Google カレンダー連携の設定状況（共有アカウントの状態、自分の個人カレンダーの状態）を返す"""
    configured = google_cal.is_google_configured()
    account = crud.get_google_shared_account(db) if configured else None
    my_cal = crud.get_user_personal_calendar(db, current_user.id) if account else None
    connected = my_cal is not None and bool(my_cal.calendar_id)
    return {
        "configured": configured,
        "shared_account_connected": account is not None and account.status == "active",
        "shared_account_email": account.google_account_email if account else None,
        "shared_account_error": account.last_refresh_error if account and account.status == "error" else None,
        "my_calendar_connected": connected,
        "synced_task_ids": crud.get_synced_task_ids_for_user(db, current_user.id) if connected else [],
        "synced_event_ids": crud.get_synced_event_ids_for_user(db, current_user.id) if connected else [],
    }

# ============================================================
# 管理者専用: 共有アカウントのセットアップ
# ============================================================

@router.get("/admin/authorize")
def google_admin_authorize(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """共有アカウントのGoogle認証URLを返す（管理者専用）"""
    if current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="管理者のみ実行できます")
    if not google_cal.is_google_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google 連携が設定されていません。.envのGOOGLE_CLIENT_ID等を確認してください。"
        )
    state = _google_state_sign(current_user.id)
    url = google_cal.get_authorize_url(state=state)
    if not url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="認証URLを生成できません。")
    return {"url": url}

@router.get("/admin/callback")
def google_admin_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """共有アカウントのOAuthコールバック（管理者専用フロー）"""
    frontend_base = os.getenv("FRONTEND_URL", "http://localhost:5175")

    if error:
        logger.error(f"Google admin OAuth error: {error}")
        return RedirectResponse(url=f"{frontend_base}/admin/google?google=error&reason={error}")

    if not code or not state:
        return RedirectResponse(url=f"{frontend_base}/admin/google?google=error&reason=missing_params")

    admin_user_id = _google_state_verify(state)
    if admin_user_id is None:
        return RedirectResponse(url=f"{frontend_base}/admin/google?google=error&reason=invalid_state")

    try:
        tokens = google_cal.exchange_code_for_tokens(code)
        if not tokens:
            return RedirectResponse(url=f"{frontend_base}/admin/google?google=error&reason=token_exchange_failed")

        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in")
        expires_at = None
        if expires_in is not None:
            expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))

        userinfo = google_cal.get_userinfo(access_token) if access_token else None
        google_account_email = userinfo.get("email") if userinfo else None

        crud.upsert_google_shared_account(
            db,
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
            connected_by_user_id=admin_user_id,
            google_account_email=google_account_email,
        )

        return RedirectResponse(url=f"{frontend_base}/admin/google?google=connected")
    except Exception as e:
        logger.exception(f"Google admin token exchange exception: {e}")
        return RedirectResponse(url=f"{frontend_base}/admin/google?google=error&reason=token_exchange_exception")

@router.delete("/admin/disconnect")
def google_admin_disconnect(
    background_tasks: BackgroundTasks,
    confirm: bool = Query(False),
    current_user: models.User = Depends(security.get_current_user),
):
    """共有アカウント全体の連携解除。全社員分の個人カレンダーが一括で削除される（管理者専用・破壊的操作）"""
    if current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="管理者のみ実行できます")
    if not confirm:
        raise HTTPException(status_code=400, detail="confirm=true を指定してください（全社員分のカレンダーが削除されます）")
    background_tasks.add_task(disconnect_shared_account_bg)
    return {"message": "共有アカウントの連携解除を開始しました。全社員分の個人カレンダーが削除されます。"}

# ============================================================
# 一般ユーザー向け: 自分の個人カレンダー接続
# ============================================================

@router.post("/my-calendar/connect")
def connect_my_calendar(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """自分の個人カレンダーを作成・共有し、初回同期を開始する（OAuth不要）"""
    if not google_cal.is_google_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google 連携が設定されていません")
    account = crud.get_google_shared_account(db)
    if not account or account.status != "active":
        raise HTTPException(status_code=400, detail="管理者がGoogle連携を設定していません。管理者にお問い合わせください。")
    access_token = _ensure_shared_token_updated(db)
    if not access_token:
        raise HTTPException(status_code=502, detail="Google連携でエラーが発生しています。管理者にお問い合わせください。")
    calendar_id = _ensure_user_calendar(db, access_token, account, current_user)
    if not calendar_id:
        raise HTTPException(status_code=502, detail="個人カレンダーの作成に失敗しました。")
    background_tasks.add_task(initial_sync_for_user_bg, current_user.id)
    row = crud.get_user_personal_calendar(db, current_user.id)
    return {"connected": True, "calendar_id": calendar_id, "shared_email": row.shared_email if row else current_user.email}

@router.post("/my-calendar/disconnect")
def disconnect_my_calendar(
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(security.get_current_user),
):
    """自分の個人カレンダーの連携解除"""
    background_tasks.add_task(disconnect_user_calendar_bg, current_user.id)
    return {"message": "個人カレンダーの連携解除を開始しました"}

# ============================================================
# タスク・イベント同期トグル
# ============================================================

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

    calendar_row = crud.get_user_personal_calendar(db, current_user.id)
    if not calendar_row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="先に Google カレンダーと連携してください")
    account = crud.get_google_shared_account(db)
    access_token = _ensure_shared_token_updated(db)
    if not access_token or not account:
        raise HTTPException(status_code=502, detail="Google連携でエラーが発生しています。管理者にお問い合わせください。")

    db_task = crud.get_task(db, task_id=task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="タスクが見つかりません")

    if body.sync:
        if db_task.display_status == 'offline':
            db_task.display_status = 'online'
            db.commit()

        try:
            success = sync_task_to_google(db, db_task, calendar_row, access_token, account)
            return {"synced": True, "message": "タスクを Google カレンダーに追加しました"}
        except Exception as e:
            logger.exception(f"Manual sync failed: {e}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Google カレンダーへの同期に失敗しました: {str(e)}")
    else:
        sync_row = crud.get_task_google_sync(db, current_user.id, task_id)
        if sync_row and sync_row.google_event_id:
            google_cal.delete_calendar_event(
                access_token, account.refresh_token, account.expires_at, sync_row.google_event_id, calendar_id=calendar_row.calendar_id
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
    calendar_row = crud.get_user_personal_calendar(db, current_user.id)
    if not calendar_row:
        raise HTTPException(status_code=400, detail="先に Google カレンダーと連携してください")
    account = crud.get_google_shared_account(db)
    access_token = _ensure_shared_token_updated(db)
    if not access_token or not account:
        raise HTTPException(status_code=502, detail="Google連携でエラーが発生しています。管理者にお問い合わせください。")

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
                sync_task_to_google(db, db_task, calendar_row, access_token, account)
                count += 1
            except Exception:
                errors += 1
        else:
            try:
                sync_row = crud.get_task_google_sync(db, current_user.id, tid)
                if sync_row and sync_row.google_event_id:
                    google_cal.delete_calendar_event(
                        access_token, account.refresh_token, account.expires_at, sync_row.google_event_id, calendar_id=calendar_row.calendar_id
                    )
                    crud.delete_task_google_sync(db, current_user.id, tid)
                    count += 1
                else:
                    skipped += 1
            except Exception:
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
    calendar_row = crud.get_user_personal_calendar(db, current_user.id)
    if not calendar_row:
        raise HTTPException(status_code=400, detail="先に Google カレンダーと連携してください")
    account = crud.get_google_shared_account(db)
    access_token = _ensure_shared_token_updated(db)
    if not access_token or not account:
        raise HTTPException(status_code=502, detail="Google連携でエラーが発生しています。管理者にお問い合わせください。")

    db_event = crud.get_event(db, event_id=event_id)
    if not db_event:
        raise HTTPException(status_code=404, detail="イベントが見つかりません")

    if body.sync:
        try:
            sync_event_to_google(db, db_event, calendar_row, access_token, account)
            return {"synced": True, "message": "イベントを Google カレンダーに追加しました"}
        except Exception as e:
            logger.exception(f"Manual event sync failed: {e}")
            raise HTTPException(status_code=502, detail="Google カレンダーへの同期に失敗しました")
    else:
        sync_row = crud.get_event_google_sync(db, current_user.id, event_id)
        if sync_row and sync_row.google_event_id:
            google_cal.delete_calendar_event(
                access_token, account.refresh_token, account.expires_at, sync_row.google_event_id, calendar_id=calendar_row.calendar_id
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
