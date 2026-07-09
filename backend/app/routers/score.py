from fastapi import APIRouter, Depends, HTTPException, Header, status, Form, UploadFile, File, Body, Query, Response
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_, and_, func, text
from typing import List, Optional
from .. import models, schemas, database, security
from ..crud.tasks import _resolve_dm_thread_id, _recalc_shot_status
from ..database import get_db
from ..security import get_current_user
from datetime import datetime
from ..timezone import now_jst_naive
import os
import shutil
import json as _json
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["score"])

# --- Helpers ---

def _get_pm_director_project_ids(db: Session, actor_id: int) -> List[int]:
    """
    ある actor が PM または Director として設定されているプロジェクトID を返す。
    score_user_roles テーブルで role が 'pm' または 'director' のエントリを検索する。

    注意: 以前は User.role in ('pm', 'admin') の場合に全 online プロジェクトを返す
    ショートカットが存在したが、以下の副作用があったため廃止した:
      - admin ユーザーの /api/me/tasks に、割当のない他人のタスクが混入する
      - admin ユーザーの /api/me/projects に、role assignment のないプロジェクトが混入する
    ロールごとの見え方は score_user_roles テーブルを唯一の真実源として扱う。
    """
    roles = db.query(models.ScoreUserRole).filter(
        models.ScoreUserRole.user_id == actor_id,
        models.ScoreUserRole.role.in_(['pm', 'director'])
    ).all()
    return [r.project_id for r in roles]

def get_actor_user_id(
    x_actor_user_id: Optional[int] = Header(None),
    current_user: models.User = Depends(get_current_user)
) -> int:
    """
    ヘッダーから実操作者のIDを取得します。
    管理者のみ X-Actor-User-Id ヘッダーで任意のユーザーIDを指定できます。
    一般ユーザーがヘッダーを指定した場合は、自分自身のIDを使用します。
    bypass経路: security.py で X-Actor-User-Id のユーザーが直接 current_user として渡るため、
    bypass判定ロジック不要。
    """
    if current_user.role == 'admin':
        if x_actor_user_id:
            logger.info(
                "ACTOR relay: principal admin user_id=%s acting as actor_id=%s",
                current_user.id, x_actor_user_id
            )
            return x_actor_user_id
        return current_user.id
    return current_user.id


async def get_actor_id_for_write_eps(
    authorization: Optional[str] = Header(None),
    x_actor_user_id: Optional[int] = Header(None),
    db: Session = Depends(get_db),
) -> int:
    """
    POST /api/assets と POST /api/reference_materials 専用の二経路 dep。
    CASPER_WRITE_TOKEN 経路: X-Actor-User-Id 必須 → actor_id を返す。
    JWT 経路: get_current_user() 経由の通常認証 → actor_id を返す（既存JWT経路非破壊）。
    """
    casper_token = os.getenv("CASPER_WRITE_TOKEN")
    bearer = None
    if authorization and authorization.startswith("Bearer "):
        bearer = authorization.split("Bearer ", 1)[1].strip()

    if casper_token and bearer == casper_token:
        if not x_actor_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Actor-User-Id ヘッダーは CASPER_WRITE_TOKEN 使用時に必須です。"
            )
        logger.info("CASPER_WRITE relay: actor_id=%s", x_actor_user_id)
        return x_actor_user_id

    # JWT path — call get_current_user directly with extracted bearer token
    current_user = await security.get_current_user(token=bearer or "", x_actor_user_id=x_actor_user_id, db=db)
    if current_user.role == 'admin':
        if x_actor_user_id:
            logger.info(
                "ACTOR relay: principal admin user_id=%s acting as actor_id=%s",
                current_user.id, x_actor_user_id
            )
            return x_actor_user_id
        return current_user.id
    return current_user.id

# --- Write APIs (18 endpoints) ---

@router.post("/retakes", response_model=schemas.Retake, status_code=status.HTTP_201_CREATED)
def create_retake(
    retake_in: schemas.RetakeCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_retake = models.Retake(
        shot_id=retake_in.shot_id,
        overall_comment=retake_in.overall_comment,
        priority=retake_in.priority,
        deadline=retake_in.deadline,
        created_by=actor_id,
        created_at=now_jst_naive()
    )
    db.add(db_retake)
    db.flush()
    
    for tc in retake_in.timecodes:
        db_tc = models.RetakeTimecode(
            retake_id=db_retake.id,
            timecode=tc.timecode,
            comment=tc.comment,
            paint_image=tc.paint_image,
            paint_mime=tc.paint_mime or "image/png"
        )
        db.add(db_tc)
    
    db.commit()
    db.refresh(db_retake)
    return db_retake

@router.post("/shots/{id}/approve", response_model=schemas.ShotResponse)
def approve_shot(
    id: int,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_shot = db.query(models.Shot).filter(models.Shot.id == id).first()
    if not db_shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    tasks = db.query(models.Task).filter(models.Task.shot_id == id).all()
    for t in tasks:
        if t.status == models.TaskStatus.DELIVER:
            continue  # 完了済みタスクはAPPROVEDへ降格させない
        t.status = models.TaskStatus.AP
        db.add(models.TaskStatusHistory(
            task_id=t.id,
            status=t.status,
            changed_at=now_jst_naive(),
            changed_by=actor_id
        ))
    _recalc_shot_status(db, id)
    db_shot.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_shot)
    return db_shot


@router.post("/tasks/{task_id}/approve")
def approve_task(
    task_id: int,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    db_task.status = models.TaskStatus.AP
    db.add(models.TaskStatusHistory(
        task_id=db_task.id,
        status=db_task.status,
        changed_at=now_jst_naive(),
        changed_by=actor_id
    ))
    if db_task.shot_id:
        _recalc_shot_status(db, db_task.shot_id)
    db.commit()
    return {"message": "approved", "task_id": task_id}

@router.post("/look_distributions", response_model=schemas.LookDistribution, status_code=status.HTTP_201_CREATED)
def create_look_distribution(
    dist_in: schemas.LookDistributionCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_dist = models.LookDistribution(
        **dist_in.dict(),
        created_by=actor_id,
        created_at=now_jst_naive()
    )
    db.add(db_dist)
    db.commit()
    db.refresh(db_dist)
    return db_dist

@router.post("/timecards/clock_out", response_model=schemas.Timecard, status_code=status.HTTP_201_CREATED)
def clock_out(
    timecard_in: schemas.TimecardCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    # actor_id を強制適用
    user_id = actor_id if timecard_in.user_id is None else timecard_in.user_id
    
    # default for_date to timecard_in.date's date string if not provided
    for_date = timecard_in.for_date
    if not for_date and timecard_in.date:
        for_date = timecard_in.date.strftime("%Y-%m-%d")

    db_timecard = models.Timecard(
        user_id=user_id,
        date=timecard_in.date,
        clock_out_at=timecard_in.clock_out_at or now_jst_naive(),
        worked_minutes=timecard_in.worked_minutes,
        break_minutes=timecard_in.break_minutes,
        memo=timecard_in.memo,
        type=timecard_in.type or "clock_out",
        mode=timecard_in.mode or "current",
        created_at=timecard_in.created_at or now_jst_naive(),
        submitted_at=timecard_in.submitted_at or timecard_in.clock_out_at or now_jst_naive(),
        for_date=for_date,
        fields=timecard_in.fields
    )
    db.add(db_timecard)
    db.commit()
    db.refresh(db_timecard)
    return db_timecard

@router.post("/routines", response_model=schemas.Routine, status_code=status.HTTP_201_CREATED)
def submit_routine(
    routine_in: schemas.RoutineCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    user_id = actor_id if routine_in.user_id is None else routine_in.user_id
    
    db_routine = models.Routine(
        user_id=user_id,
        date=routine_in.date,
        condition=routine_in.condition,
        blockers=routine_in.blockers,
        ai_priorities_adopted=routine_in.ai_priorities_adopted
    )
    db.add(db_routine)
    db.commit()
    db.refresh(db_routine)
    return db_routine

@router.post("/change_requests", response_model=schemas.ChangeRequest, status_code=status.HTTP_201_CREATED)
def create_change_request(
    request_in: schemas.ChangeRequestCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_request = models.ChangeRequest(
        **request_in.dict(),
        created_by=actor_id,
        created_at=now_jst_naive()
    )
    db.add(db_request)
    db.commit()
    db.refresh(db_request)
    return db_request

@router.post("/troubles", response_model=schemas.Trouble, status_code=status.HTTP_201_CREATED)
def report_trouble(
    trouble_in: schemas.TroubleCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_trouble = models.Trouble(
        **trouble_in.dict(),
        created_by=actor_id,
        created_at=now_jst_naive()
    )
    db.add(db_trouble)
    db.commit()
    db.refresh(db_trouble)
    return db_trouble

@router.patch("/troubles/{id}/resolve", response_model=schemas.Trouble)
def resolve_trouble(
    id: int,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_trouble = db.query(models.Trouble).filter(models.Trouble.id == id).first()
    if not db_trouble:
        raise HTTPException(status_code=404, detail="Trouble report not found")
    
    db_trouble.status = "resolved"
    # 追加の解決情報が必要な場合はモデルを拡張
    db.commit()
    db.refresh(db_trouble)
    return db_trouble

@router.patch("/troubles/{id}/reopen", response_model=schemas.Trouble)
def reopen_trouble(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin)
):
    """Admin: re-open a resolved trouble report (idempotent)."""
    db_trouble = db.query(models.Trouble).filter(models.Trouble.id == id).first()
    if not db_trouble:
        raise HTTPException(status_code=404, detail="Trouble report not found")
    db_trouble.status = "open"
    db.commit()
    db.refresh(db_trouble)
    return db_trouble

@router.post("/messages", response_model=schemas.UserMessage, status_code=status.HTTP_201_CREATED)
def send_message(
    msg_in: schemas.UserMessageCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_msg = models.UserMessage(
        **msg_in.dict(),
        author_id=actor_id,
        created_at=now_jst_naive()
    )
    db.add(db_msg)
    db.commit()
    db.refresh(db_msg)
    return db_msg

@router.patch("/notifications/{id}/read", response_model=schemas.Notification)
def read_notification(
    id: int,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_notif = db.query(models.Notification).filter(
        models.Notification.id == id,
        models.Notification.recipient_id == actor_id
    ).first()
    if not db_notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    db_notif.is_read = True
    db.commit()
    db.refresh(db_notif)
    return db_notif

# --- New Write APIs for U-01 ---

@router.post("/shots/{id}/comments", response_model=schemas.UserMessage, status_code=status.HTTP_201_CREATED)
def create_shot_comment(
    id: int,
    msg_in: schemas.UserMessageCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_msg = models.UserMessage(
        channel_id=f"shot_{id}",
        shot_id=id,
        body=msg_in.body,
        timecode=msg_in.timecode,
        author_id=actor_id,
        created_at=now_jst_naive()
    )
    db.add(db_msg)
    db.commit()
    db.refresh(db_msg)
    return db_msg

@router.get("/assets", response_model=List[schemas.AssetResponse])
def list_assets(
    shot_id: Optional[int] = Query(None),
    task_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    q = db.query(models.Asset)
    if shot_id is not None:
        q = q.filter(models.Asset.shot_id == shot_id)
    if task_id is not None:
        q = q.filter(models.Asset.task_id == task_id)
    if project_id is not None:
        shot_ids = [row.id for row in db.query(models.Shot.id).filter(models.Shot.project_id == project_id).all()]
        task_ids = [row.id for row in db.query(models.Task.id).filter(models.Task.project_id == project_id).all()]
        q = q.filter(or_(models.Asset.shot_id.in_(shot_ids), models.Asset.task_id.in_(task_ids)))
    return q.all()

@router.post("/assets", response_model=schemas.AssetResponse, status_code=status.HTTP_201_CREATED)
def upload_asset(
    file: UploadFile = File(...),
    shot_id: Optional[int] = Form(None),
    task_id: Optional[int] = Form(None),
    version: Optional[str] = Form(None),
    data: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_id_for_write_eps)
):
    # Casper 書込経路: data JSON からフィールドを補完
    if data:
        try:
            data_dict = _json.loads(data)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="data フィールドは有効な JSON 文字列である必要があります。")
        if shot_id is None and "shot_id" in data_dict:
            shot_id = data_dict["shot_id"]
        if task_id is None and "task_id" in data_dict:
            task_id = data_dict["task_id"]
        if version is None and "version" in data_dict:
            version = str(data_dict["version"])

    if version is None:
        version = "1"

    # shot_idが指定されておらず、task_idがある場合はタスク情報から補完する
    if shot_id is None and task_id is not None:
        db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if db_task:
            shot_id = db_task.shot_id

    BASE_DIR = Path(__file__).resolve().parent.parent.parent
    assets_dir = BASE_DIR / "static" / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    shot_id_str = str(shot_id) if shot_id is not None else "none"
    file_path = assets_dir / f"shot_{shot_id_str}_task_{task_id}_{version}_{file.filename}"
    try:
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except OSError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ファイルの保存に失敗しました: {e}"
        )

    db_asset = models.Asset(
        shot_id=shot_id,
        task_id=task_id,
        version=version,
        file_path=str(file_path.as_posix()),
        created_by=actor_id,
        created_at=now_jst_naive()
    )
    try:
        db.add(db_asset)
        db.commit()
        db.refresh(db_asset)
    except Exception as e:
        db.rollback()
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"アセットの DB 保存に失敗しました: {e}"
        )
    return db_asset

@router.delete("/assets/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    actor_id: int = Depends(get_actor_user_id)
):
    db_asset = db.query(models.Asset).filter(models.Asset.id == id).first()
    if not db_asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="アセットが見つかりません")

    # 削除権限の検証 (本人であるか、または admin ロールであること)
    if current_user.role != "admin" and db_asset.created_by != actor_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このアセットを削除する権限がありません"
        )

    # 物理ファイルの削除
    if db_asset.file_path:
        file_path = Path(db_asset.file_path)
        if file_path.exists() and file_path.is_file():
            try:
                file_path.unlink()
            except Exception as e:
                logger.warning(f"Failed to remove physical file {file_path}: {e}")

    # 関連する LookDistribution の result_asset_id を NULL に更新する (ソフト参照のクリーンアップ)
    db.query(models.LookDistribution).filter(models.LookDistribution.result_asset_id == id).update(
        {models.LookDistribution.result_asset_id: None},
        synchronize_session=False
    )

    # データベースレコードの削除
    db.delete(db_asset)
    db.commit()

@router.get("/deliveries", response_model=List[schemas.DeliveryResponse])
def list_deliveries(
    task_id: Optional[int] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    query = db.query(models.Delivery)
    if task_id:
        query = query.filter(models.Delivery.task_id == task_id)
    if project_id:
        query = query.join(models.Task, models.Delivery.task_id == models.Task.id)\
                     .filter(models.Task.project_id == project_id)
    return query.order_by(models.Delivery.created_at.desc()).all()

@router.post("/deliveries/{id}/receive", response_model=schemas.DeliveryResponse)
def receive_delivery(
    id: int,
    qc_status: str = Body(..., embed=True),
    memo: Optional[str] = Body(None, embed=True),
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_delivery = db.query(models.Delivery).filter(models.Delivery.id == id).first()
    if not db_delivery:
        db_delivery = models.Delivery(
            task_id=id,
            status="received",
            qc_status=qc_status,
            memo=memo,
            created_by=actor_id,
            created_at=now_jst_naive()
        )
        db.add(db_delivery)
    else:
        db_delivery.status = "received"
        db_delivery.qc_status = qc_status
        db_delivery.memo = memo
    db.commit()
    db.refresh(db_delivery)
    return db_delivery

@router.patch("/look_distributions/{id}/accept", response_model=schemas.LookDistribution)
def accept_look_distribution(
    id: int,
    estimated_hours: int = Body(..., embed=True),
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    dist = db.query(models.LookDistribution).filter(models.LookDistribution.id == id).first()
    if not dist:
        raise HTTPException(status_code=404, detail="Look distribution not found")
    dist.status = "in_progress"
    dist.estimated_hours = estimated_hours
    db.commit()
    db.refresh(dist)
    return dist

@router.patch("/look_distributions/{id}/complete", response_model=schemas.LookDistribution)
def complete_look_distribution(
    id: int,
    result_asset_id: int = Body(..., embed=True),
    notes: Optional[str] = Body(None, embed=True),
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    dist = db.query(models.LookDistribution).filter(models.LookDistribution.id == id).first()
    if not dist:
        raise HTTPException(status_code=404, detail="Look distribution not found")
    dist.status = "completed"
    dist.result_asset_id = result_asset_id
    dist.notes = notes
    db.commit()
    db.refresh(dist)
    return dist

@router.post("/dm", response_model=schemas.DirectMessageResponse, status_code=status.HTTP_201_CREATED)
def send_direct_message(
    dm_in: schemas.DirectMessageCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    recipient_id = dm_in.recipient_id
    thread_id = dm_in.thread_id
    
    if thread_id:
        if thread_id >= 10000000:
            # 3人以上の多人数スレッド（dm_thread_participantsで参加者確認）
            rows = db.query(models.DmThreadParticipant.user_id).filter(
                models.DmThreadParticipant.thread_id == thread_id
            ).all()
            if not rows:
                raise HTTPException(status_code=404, detail="スレッドに対応する参加者が見つかりません")
            participants = [row[0] for row in rows]
            if actor_id not in participants:
                raise HTTPException(status_code=403, detail="このスレッドの参加者ではありません")
        else:
            # 1対1スレッド
            p1 = thread_id // 10000
            p2 = thread_id % 10000
            participants = [p1, p2]
    else:
        if not recipient_id:
            raise HTTPException(status_code=400, detail="thread_id または recipient_id のいずれかが必要です")
        participants = [actor_id, recipient_id]
        thread_id = min(actor_id, recipient_id) * 10000 + max(actor_id, recipient_id)

    other_participants = [p for p in set(participants) if p != actor_id]
    if not other_participants:
        raise HTTPException(status_code=400, detail="有効な受信者が存在しません")
        
    representative_id = other_participants[0]

    db_dm = models.DirectMessage(
        thread_id=thread_id,
        sender_id=actor_id,
        recipient_id=representative_id,
        body=dm_in.body,
        context_json=dm_in.context_json,
        created_at=now_jst_naive()
    )
    db.add(db_dm)
    db.commit()
    db.refresh(db_dm)

    from app.utils.webhook_sender import send_webhook_in_thread
    send_webhook_in_thread("dm_thread.new_message", {
        "thread_id": db_dm.thread_id,
        "message_id": db_dm.id,
        "sender_id": db_dm.sender_id,
        "participants": participants,
        "body": db_dm.body,
        "created_at": db_dm.created_at.isoformat() if db_dm.created_at else None,
    })

    return db_dm

@router.post("/dm/threads", response_model=schemas.DMThreadResponse, status_code=status.HTTP_201_CREATED)
def create_dm_thread(
    thread_in: schemas.DMThreadCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    participants = thread_in.participant_ids
    if len(participants) < 2:
        raise HTTPException(status_code=400, detail="スレッドには少なくとも2人の参加者が必要です")
        
    try:
        thread_id = _resolve_dm_thread_id(db, participants)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    existing = db.query(models.DirectMessage).filter(models.DirectMessage.thread_id == thread_id).first()
    if not existing:
        other_participants = [p for p in set(participants) if p != actor_id]
        recipient_id = other_participants[0] if other_participants else participants[0]
        
        db_dm = models.DirectMessage(
            thread_id=thread_id,
            sender_id=actor_id,
            recipient_id=recipient_id,
            body="Thread started.",
            created_at=now_jst_naive()
        )
        db.add(db_dm)
        db.commit()
        
    if thread_in.task_id:
        db_task = db.query(models.Task).filter(models.Task.id == thread_in.task_id).first()
        if db_task:
            db_task.thread_id = thread_id
            db.commit()
            
    participants_info = []
    for pid in sorted(list(set(participants))):
        user = db.query(models.User).filter(models.User.id == pid).first()
        name = user.full_name or user.username if user else f"User {pid}"
        participants_info.append({"user_id": pid, "name": name})
        
    return {"thread_id": thread_id, "participants": participants_info}

@router.post("/group_dm", response_model=schemas.GroupDirectMessageResponse, status_code=status.HTTP_201_CREATED)
def send_group_direct_message(
    gdm_in: schemas.GroupDirectMessageCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    db_gdm = models.GroupDirectMessage(
        group_id=gdm_in.group_id,
        sender_id=actor_id,
        body=gdm_in.body,
        created_at=now_jst_naive()
    )
    db.add(db_gdm)
    db.commit()
    db.refresh(db_gdm)
    return db_gdm

@router.patch("/notifications/read_all")
def read_all_notifications(
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    notifs = db.query(models.Notification).filter(
        models.Notification.recipient_id == actor_id,
        models.Notification.is_read == False
    ).all()
    
    marked_count = len(notifs)
    for n in notifs:
        n.is_read = True
    db.commit()
    return {"marked_count": marked_count}

# --- Read APIs (22 endpoints) ---

@router.get("/me", response_model=schemas.UserResponse)
def get_my_profile(
    response: Response,
    current_user: models.User = Depends(get_current_user),
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # 本人識別レスポンスは中間プロキシ/ブラウザにキャッシュさせない（別ユーザーへの漏洩防止）
    response.headers["Cache-Control"] = "no-store, private"
    # actor_id が指定されている場合はそのユーザーを返す（Score Backend からの中継用）
    user = db.query(models.User).filter(models.User.id == actor_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    user_data = schemas.UserResponse.from_orm(user)
    if not user_data.avatar_url:
        user_data.avatar_url = f"/api/users/{user.id}/avatar"
    return user_data

@router.get("/me/tasks", response_model=List[schemas.TaskResponse])
def get_my_tasks(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    """自分が assigned_to のタスクのみを返す (strict assignment)。
    オフラインプロジェクトのタスクは、PM/Director として登録されていても表示しない。

    以前は PM/Director プロジェクトの全タスクを合流させていたが、
    Score ダッシュボードで「他人のタスクが本日 TODO に載る」原因となっていたため撤廃。
    プロジェクトの可視性は /api/me/projects で別途担保する。
    """
    query = db.query(models.Task).outerjoin(
        models.Project, models.Task.project_id == models.Project.id
    ).filter(
        models.Task.assigned_to == actor_id,  # 割当のみ
    ).filter(
        or_(
            models.Task.project_id.is_(None),
            models.Project.display_status == 'online',
        )
    )
    return query.distinct().all()

@router.get("/me/shots", response_model=List[schemas.ShotResponse])
def get_my_shots(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # タスクがアサインされているショット + オンラインの PM/Director プロジェクトのすべてのショット
    # (オフラインプロジェクトのショットは PM/Director でも表示しない)
    pm_director_project_ids = _get_pm_director_project_ids(db, actor_id)
    cond = [
        models.Shot.id.in_(
            db.query(models.Task.shot_id).filter(
                models.Task.assigned_to == actor_id,
                models.Task.shot_id.isnot(None)
            )
        )
    ]
    if pm_director_project_ids:
        cond.append(models.Shot.project_id.in_(pm_director_project_ids))

    query = db.query(models.Shot).outerjoin(models.Project, models.Shot.project_id == models.Project.id).filter(
        or_(
            models.Shot.project_id.is_(None),
            models.Project.display_status == 'online',
        )
    )
    return query.filter(or_(*cond)).distinct().all()

@router.get("/me/notifications", response_model=List[schemas.Notification])
def get_my_notifications(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    query = db.query(
        models.Notification,
        models.Project.name.label("project_name")
    ).outerjoin(models.Shot, models.Notification.body.contains(models.Shot.shot_code))\
     .outerjoin(models.Project, models.Shot.project_id == models.Project.id)\
     .filter(models.Notification.recipient_id == actor_id)\
     .filter((models.Project.display_status == 'online') | (models.Project.id == None))
    
    results = query.order_by(models.Notification.created_at.desc()).limit(50).all()
    
    for n, pn in results:
        n.project_name = pn
    return [n for n, pn in results]

@router.get("/me/projects", response_model=List[schemas.ProjectResponse])
def get_my_projects(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # タスクがアサインされているプロジェクト + PM/Director プロジェクト
    # ただし display_status='online' のプロジェクトのみを返す
    # (オフラインは PM/Director 割当があっても表示しない)
    task_project_ids = [
        t.project_id for t in
        db.query(models.Task.project_id).filter(
            models.Task.assigned_to == actor_id,
            models.Task.project_id.isnot(None)
        ).distinct().all()
    ]
    pm_director_project_ids = _get_pm_director_project_ids(db, actor_id)
    all_project_ids = list(set(task_project_ids + pm_director_project_ids))
    if not all_project_ids:
        return []
    return db.query(models.Project).filter(
        models.Project.id.in_(all_project_ids),
        models.Project.display_status == 'online',
    ).all()

@router.get("/me/retakes", response_model=List[schemas.Retake])
def get_my_retakes(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # 自分が発行した、または自分の担当ショットに対するリテイク
    # + PM/Director として設定されているプロジェクトのすべてのリテイク
    from sqlalchemy.orm import aliased
    Creator = aliased(models.User)
    pm_director_project_ids = _get_pm_director_project_ids(db, actor_id)
    query = db.query(
        models.Retake,
        models.Shot.shot_code,
        models.Project.name.label("project_name"),
        Creator.full_name.label("creator_name")
    ).join(models.Shot, models.Retake.shot_id == models.Shot.id)\
     .join(models.Project, models.Shot.project_id == models.Project.id)\
     .join(Creator, models.Retake.created_by == Creator.id)\
     .join(models.Task, models.Task.shot_id == models.Shot.id, isouter=True)

    retake_cond = [
        models.Retake.created_by == actor_id,
        models.Task.assigned_to == actor_id,
    ]
    if pm_director_project_ids:
        retake_cond.append(models.Shot.project_id.in_(pm_director_project_ids))
    query = query.filter(or_(*retake_cond)).distinct()

    # オフラインプロジェクトのリテイクは PM/Director でも表示しない
    query = query.filter(models.Project.display_status == 'online')

    results = query.options(selectinload(models.Retake.timecodes)).all()
    
    for r, sc, pn, cn in results:
        r.shot_code = sc
        r.project_name = pn
        r.creator_name = cn
    return [r for r, sc, pn, cn in results]

@router.get("/me/timecards", response_model=List[schemas.Timecard])
def get_my_timecards(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    type: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    actor_user_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timedelta
    
    if not from_date:
        from_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.now().strftime("%Y-%m-%d")
        
    query = db.query(models.Timecard).filter(models.Timecard.user_id == actor_user_id)
    if from_date:
        query = query.filter(func.date(models.Timecard.date) >= from_date)
    if to_date:
        query = query.filter(func.date(models.Timecard.date) <= to_date)
    if type:
        query = query.filter(models.Timecard.type == type)
        
    return query.order_by(models.Timecard.date.desc()).limit(limit).all()

@router.get("/me/troubles", response_model=List[schemas.Trouble])
def get_my_troubles(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # 自分が報告した、または自分にアサインされたトラブル
    # + PM/Director として設定されているプロジェクトのすべてのトラブル
    from sqlalchemy.orm import aliased
    Reporter = aliased(models.User)
    Assignee = aliased(models.User)
    pm_director_project_ids = _get_pm_director_project_ids(db, actor_id)
    query = db.query(
        models.Trouble,
        models.Shot.shot_code,
        models.Project.name.label("project_name"),
        Reporter.full_name.label("reporter_name"),
        Assignee.full_name.label("assigned_to_name")
    ).join(models.Shot, models.Trouble.shot_id == models.Shot.id)\
     .join(models.Project, models.Shot.project_id == models.Project.id)\
     .join(Reporter, models.Trouble.created_by == Reporter.id)\
     .outerjoin(Assignee, models.Trouble.assigned_to == Assignee.id)

    trouble_cond = [
        models.Trouble.created_by == actor_id,
        models.Trouble.assigned_to == actor_id,
    ]
    if pm_director_project_ids:
        trouble_cond.append(models.Shot.project_id.in_(pm_director_project_ids))
    query = query.filter(or_(*trouble_cond))

    # オフラインプロジェクトのトラブルは PM/Director でも表示しない
    query = query.filter(models.Project.display_status == 'online')

    results = query.all()
    
    for t, sc, pn, rn, an in results:
        t.shot_code = sc
        t.project_name = pn
        t.reporter_name = rn
        t.assigned_to_name = an
    return [t for t, sc, pn, rn, an in results]

@router.get("/shots/similar", response_model=List[schemas.ShotResponse])
def get_similar_shots(
    based_on: int,
    db: Session = Depends(get_db)
):
    # 簡易実装: 同じプロジェクトのショットを返す
    target_shot = db.query(models.Shot).filter(models.Shot.id == based_on).first()
    if not target_shot:
        raise HTTPException(status_code=404, detail="Source shot not found")
    
    return db.query(models.Shot).filter(
        models.Shot.project_id == target_shot.project_id,
        models.Shot.id != based_on
    ).limit(5).all()

@router.get("/projects/{project_id}/production-tracker")
def get_score_production_tracker(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """【制作現場専用】ショット・タスク進捗およびリテイク・トラブル状況を取得"""
    from sqlalchemy import func
    
    # 1. プロジェクトに紐づくすべてのショットを取得
    shots = db.query(models.Shot).filter(models.Shot.project_id == project_id).order_by(models.Shot.seq_code, models.Shot.display_order).all()
    
    # 2. ショットに関連付けられたタスクを取得
    tasks = db.query(models.Task).filter(
        models.Task.project_id == project_id,
        models.Task.display_status == 'online'
    ).all()
    
    # 3. リテイクとトラブルの集計（ショットごと）
    retake_counts = db.query(
        models.Retake.shot_id, 
        func.count(models.Retake.id).label('count')
    ).filter(models.Retake.status != 'closed').group_by(models.Retake.shot_id).all()
    retake_map = {r.shot_id: r.count for r in retake_counts}
    
    trouble_counts = db.query(
        models.Trouble.shot_id, 
        func.count(models.Trouble.id).label('count')
    ).filter(models.Trouble.status == 'open').group_by(models.Trouble.shot_id).all()
    trouble_map = {t.shot_id: t.count for t in trouble_counts}

    # 構造化: seq_code -> shots
    sequences = {}
    all_types = set()
    
    # タスクをショットIDごとにマッピング
    shot_tasks_map = {}
    for t in tasks:
        if t.shot_id not in shot_tasks_map:
            shot_tasks_map[t.shot_id] = {}
        
        t_type = t.type or "other"
        all_types.add(t_type)
        
        if t_type not in shot_tasks_map[t.shot_id]:
            shot_tasks_map[t.shot_id][t_type] = []
            
        shot_tasks_map[t.shot_id][t_type].append({
            "id": t.id,
            "name": t.name,
            "status": t.status.value if hasattr(t.status, 'value') else str(t.status or "todo"),
            "assignee": t.assignee.full_name if t.assignee else (t.assignee.username if t.assignee else None),
            "due_date": t.due_date.isoformat() if t.due_date else None
        })

    for s in shots:
        seq = s.seq_code or "Other"
        if seq not in sequences:
            sequences[seq] = []
            
        sequences[seq].append({
            "id": s.id,
            "shotID": s.shot_code,
            "status": s.status,
            "thumbnail_url": s.thumbnail_url,
            "retakes_count": retake_map.get(s.id, 0),
            "troubles_count": trouble_map.get(s.id, 0),
            "tasks": shot_tasks_map.get(s.id, {}),
            "cut": s.cut,
            "description": s.description,
            "action": s.action,
            "dialogue": s.dialogue,
            "bg": s.bg,
            "ch": s.ch,
            "prop": s.prop,
            "note": s.note,
            "frame_in": s.frame_in,
            "frame_out": s.frame_out,
            "duration": s.duration,
            "second": s.second,
            "frame_rem": s.frame_rem,
            "sl_no": s.sl_no,
        })

    # ショットに紐づかないタスクがある場合、またはショットが1つもない場合
    tasks_without_shot = [t for t in tasks if t.shot_id is None]
    if tasks_without_shot or not shots:
        seq = "General"
        if seq not in sequences:
            sequences[seq] = []
            
        sequences[seq].append({
            "id": 0,
            "shotID": "General Tasks",
            "status": "active",
            "thumbnail_url": None,
            "retakes_count": 0,
            "troubles_count": 0,
            "tasks": shot_tasks_map.get(None, {})
        })

    # シーケンスを整理
    result_sequences = []
    for seq_id in sorted(sequences.keys()):
        result_sequences.append({
            "seqID": seq_id,
            "shots": sequences[seq_id]
        })
    
    # 表示順序の定義
    priority_types = ["design", "asset", "animation", "fx", "lighting", "comp", "review", "other"]
    sorted_types = sorted(list(all_types), key=lambda x: priority_types.index(x) if x in priority_types else 999)

    return {
        "sequences": result_sequences,
        "types": sorted_types
    }

@router.get("/projects/summary")
def get_all_projects_production_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """【管理者用】全プロジェクトのショット・リテイク・トラブルのサマリーを取得"""
    from sqlalchemy import func
    
    # 1. ショット数の集計
    shot_counts = db.query(
        models.Shot.project_id,
        func.count(models.Shot.id).label('count')
    ).group_by(models.Shot.project_id).all()
    
    # 2. 保留中リテイクの集計 (Shot経由でプロジェクトIDを取得)
    retake_counts = db.query(
        models.Shot.project_id,
        func.count(models.Retake.id).label('count')
    ).join(models.Retake, models.Retake.shot_id == models.Shot.id)\
    .filter(models.Retake.status != 'closed').group_by(models.Shot.project_id).all()
    
    # 3. 未解決トラブルの集計 (Shot経由でプロジェクトIDを取得)
    trouble_counts = db.query(
        models.Shot.project_id,
        func.count(models.Trouble.id).label('count')
    ).join(models.Trouble, models.Trouble.shot_id == models.Shot.id)\
    .filter(models.Trouble.status == 'open').group_by(models.Shot.project_id).all()

    result = {}
    for pid, count in shot_counts:
        spid = str(pid)
        if spid not in result: result[spid] = {"shots": 0, "retakes": 0, "troubles": 0}
        result[spid]["shots"] = count
    
    for pid, count in retake_counts:
        spid = str(pid)
        if spid not in result: result[spid] = {"shots": 0, "retakes": 0, "troubles": 0}
        result[spid]["retakes"] = count
        
    for pid, count in trouble_counts:
        spid = str(pid)
        if spid not in result: result[spid] = {"shots": 0, "retakes": 0, "troubles": 0}
        result[spid]["troubles"] = count

    return result

# --- Admin/Viewer APIs (Listing all data) ---

@router.get("/retakes", response_model=List[schemas.Retake])
def list_retakes(
    shot_id: Optional[int] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    from sqlalchemy.orm import aliased
    Creator = aliased(models.User)
    Assignee = aliased(models.User)
    query = db.query(
        models.Retake,
        models.Shot.shot_code,
        models.Project.name.label("project_name"),
        Creator.full_name.label("creator_name"),
        Assignee.full_name.label("assignee_name")
    ).join(models.Shot, models.Retake.shot_id == models.Shot.id)\
     .join(models.Project, models.Shot.project_id == models.Project.id)\
     .join(Creator, models.Retake.created_by == Creator.id)\
     .outerjoin(Assignee, models.Retake.assigned_to == Assignee.id)\
     .filter(models.Project.display_status == 'online')\
     .options(selectinload(models.Retake.timecodes))

    if shot_id:
        query = query.filter(models.Retake.shot_id == shot_id)
    if project_id:
        query = query.filter(models.Shot.project_id == project_id)

    results = query.order_by(models.Retake.created_at.desc()).all()

    for r, sc, pn, cn, an in results:
        r.shot_code = sc
        r.project_name = pn
        r.creator_name = cn
        r.assignee_name = an
    return [r for r, sc, pn, cn, an in results]

@router.get("/troubles", response_model=List[schemas.Trouble])
def list_troubles(
    shot_id: Optional[int] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    from sqlalchemy.orm import aliased
    Reporter = aliased(models.User)
    Assignee = aliased(models.User)
    query = db.query(
        models.Trouble,
        models.Shot.shot_code,
        models.Project.name.label("project_name"),
        Reporter.full_name.label("reporter_name"),
        Assignee.full_name.label("assigned_to_name")
    ).join(models.Shot, models.Trouble.shot_id == models.Shot.id)\
     .join(models.Project, models.Shot.project_id == models.Project.id)\
     .join(Reporter, models.Trouble.created_by == Reporter.id)\
     .outerjoin(Assignee, models.Trouble.assigned_to == Assignee.id)\
     .filter(models.Project.display_status == 'online')
     
    if shot_id:
        query = query.filter(models.Trouble.shot_id == shot_id)
    if project_id:
        query = query.filter(models.Shot.project_id == project_id)
        
    results = query.order_by(models.Trouble.created_at.desc()).all()
    
    for t, sc, pn, rn, an in results:
        t.shot_code = sc
        t.project_name = pn
        t.reporter_name = rn
        t.assigned_to_name = an
    return [t for t, sc, pn, rn, an in results]

@router.get("/change_requests", response_model=List[schemas.ChangeRequest])
def list_change_requests(
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    query = db.query(models.ChangeRequest)
    if project_id:
        query = query.join(models.Shot).filter(models.Shot.project_id == project_id)
    return query.order_by(models.ChangeRequest.created_at.desc()).all()

@router.get("/look_distributions", response_model=List[schemas.LookDistribution])
def list_look_distributions(
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    import json
    from sqlalchemy.orm import aliased
    Assignee = aliased(models.User)
    query = db.query(
        models.LookDistribution,
        Assignee.full_name.label("assignee_name")
    ).outerjoin(Assignee, models.LookDistribution.assigned_to == Assignee.id)

    raw = query.order_by(models.LookDistribution.created_at.desc()).all()
    for r, an in raw:
        r.assignee_name = an
    results = [r for r, an in raw]

    if project_id:
        shot_ids = db.query(models.Shot.id).filter(models.Shot.project_id == project_id).all()
        project_shot_ids = set(s[0] for s in shot_ids)

        filtered_results = []
        for r in results:
            r_shot_ids = json.loads(r.shot_ids) if isinstance(r.shot_ids, str) else r.shot_ids
            if set(r_shot_ids).intersection(project_shot_ids):
                filtered_results.append(r)
        return filtered_results

    return results

@router.get("/timecards", response_model=List[schemas.Timecard])
def list_timecards(
    user_id: Optional[int] = None,
    date: Optional[datetime] = None,
    db: Session = Depends(get_db)
):
    query = db.query(models.Timecard)
    if user_id:
        query = query.filter(models.Timecard.user_id == user_id)
    if date:
        # 日付のみで比較（時間の無視）
        from sqlalchemy import func
        query = query.filter(func.date(models.Timecard.date) == date.date())
    return query.order_by(models.Timecard.date.desc()).all()

@router.get("/routines", response_model=List[schemas.Routine])
def list_routines(
    user_id: Optional[int] = None,
    date: Optional[datetime] = None,
    db: Session = Depends(get_db)
):
    query = db.query(models.Routine)
    if user_id:
        query = query.filter(models.Routine.user_id == user_id)
    if date:
        from sqlalchemy import func
        query = query.filter(func.date(models.Routine.date) == date.date())
    return query.order_by(models.Routine.date.desc()).all()

@router.get("/notifications", response_model=List[schemas.Notification])
def list_notifications(
    recipient_id: Optional[int] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    from sqlalchemy import or_
    query = db.query(models.Notification)
    if recipient_id:
        query = query.filter(models.Notification.recipient_id == recipient_id)
    if project_id:
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if project:
            # project_id列がある新規レコード: 直接参照。NULLの旧レコード: body文字列マッチで後方互換
            query = query.filter(
                or_(
                    models.Notification.project_id == project_id,
                    models.Notification.project_id.is_(None) & models.Notification.body.contains(project.name)
                )
            )

    return query.order_by(models.Notification.created_at.desc()).all()

@router.post("/notifications", response_model=schemas.Notification, status_code=status.HTTP_201_CREATED)
def create_notification(
    payload: schemas.NotificationCreate,
    db: Session = Depends(get_db)
):
    db_notif = models.Notification(
        recipient_id=payload.recipient_id,
        title=payload.title,
        body=payload.body,
        type=payload.type,
        meta=payload.meta or {},
        project_id=payload.project_id,
    )
    db.add(db_notif)
    db.commit()
    db.refresh(db_notif)
    return db_notif

@router.get("/user_messages", response_model=List[schemas.UserMessage])
def list_user_messages(
    shot_id: Optional[int] = None,
    author_id: Optional[int] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    query = db.query(models.UserMessage)
    if shot_id:
        query = query.filter(models.UserMessage.shot_id == shot_id)
    if author_id:
        query = query.filter(models.UserMessage.author_id == author_id)
    if project_id:
        query = query.join(models.Shot).filter(models.Shot.project_id == project_id)

    msgs = query.order_by(models.UserMessage.created_at.desc()).all()
    if not msgs:
        return []
    user_ids = {m.author_id for m in msgs}
    users = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
    user_name_map = {u.id: ((u.full_name or '').strip() or (u.username or '').strip() or None) for u in users}
    user_username_map = {u.id: u.username for u in users}
    user_email_map = {u.id: u.email for u in users}
    result = []
    for m in msgs:
        item = schemas.UserMessage.model_validate(m)
        item.author_name = user_name_map.get(m.author_id)
        item.author_username = user_username_map.get(m.author_id)
        item.author_email = user_email_map.get(m.author_id)
        result.append(item)
    return result

# --- New Read APIs for U-03 ---

@router.get("/me/shots/{id}")
def get_my_shot_detail(
    id: int,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    shot = db.query(models.Shot).filter(models.Shot.id == id).first()
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    # オフラインプロジェクトのショットは PM/Director でもアクセス不可
    project = db.query(models.Project).filter(models.Project.id == shot.project_id).first()
    if project and project.display_status != 'online':
        raise HTTPException(status_code=403, detail="Access denied for offline project")
        
    my_tasks = db.query(models.Task).filter(
        models.Task.shot_id == id,
        models.Task.assigned_to == actor_id
    ).all()
    
    assets = db.query(models.Asset).filter(models.Asset.shot_id == id).all()
    
    return {
        "shot_id": shot.id,
        "shot_code": shot.shot_code,
        "seq_code": shot.seq_code,
        "status": shot.status,
        "my_tasks": [schemas.TaskResponse.from_orm(t) for t in my_tasks],
        "asset_list": [schemas.AssetResponse.from_orm(a) for a in assets],
        "upstream": []
    }

@router.get("/me/events", response_model=List[schemas.EventResponse])
def get_my_events(
    start_date: Optional[datetime] = Query(None, alias="from"),
    end_date: Optional[datetime] = Query(None, alias="to"),
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    user = db.query(models.User).filter(models.User.id == actor_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # actor がメンバーであるプロジェクトIDの一覧を取得
    role_project_ids = [r.project_id for r in db.query(models.ScoreUserRole).filter(models.ScoreUserRole.user_id == actor_id).all()]
    task_project_ids = [t.project_id for t in db.query(models.Task).filter(models.Task.assigned_to == actor_id).all() if t.project_id is not None]
    member_project_ids = list(set(role_project_ids + task_project_ids))

    query = db.query(models.Event)
    
    # フィルタ条件の構築
    # (A) 参加者として設定されているイベント (actor_id が event.user_ids に含まれる、または participants に含まれる)
    cond_a_list = [models.Event.user_ids.contains(actor_id)]
    if user.email:
        cond_a_list.append(models.Event.participants.like(f"%{user.email}%"))
    if user.full_name:
        cond_a_list.append(models.Event.participants.like(f"%{user.full_name}%"))
        
    cond_a = or_(*cond_a_list)
    
    # (B) 関連するプロジェクトに属するイベント (project_id が member_project_ids に含まれる)
    # これにより、イベントタイプごとの項目差異に関わらず、関連プロジェクトのイベントはすべて取得可能です。
    if member_project_ids:
        cond_b = models.Event.project_id.in_(member_project_ids)
        query = query.filter(or_(cond_a, cond_b))
    else:
        query = query.filter(cond_a)
        
    # 一般ユーザー（非特権ユーザー）は、自分がPM/Directorになっていないオフラインプロジェクトのイベントを除外する
    pm_director_project_ids = _get_pm_director_project_ids(db, actor_id)
    query = query.outerjoin(models.Project, models.Event.project_id == models.Project.id).filter(
        or_(
            models.Event.project_id.is_(None),
            models.Project.display_status == 'online',
            models.Event.project_id.in_(pm_director_project_ids)
        )
    )

    if start_date:
        query = query.filter(models.Event.start_time >= start_date)
    if end_date:
        query = query.filter(models.Event.end_time <= end_date)
        
    return query.all()

@router.get("/me/projects/{id}")
def get_my_project_detail(
    id: int,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    project = db.query(models.Project).filter(models.Project.id == id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # オフラインプロジェクトは PM/Director でもアクセス不可
    if project.display_status != 'online':
        raise HTTPException(status_code=403, detail="Access denied for offline project")
        
    my_shots = db.query(models.Shot).join(models.Task).filter(
        models.Shot.project_id == id,
        models.Task.assigned_to == actor_id
    ).distinct().all()
    
    members = db.query(models.User).join(models.Task).filter(
        models.Task.project_id == id
    ).distinct().all()
    
    return {
        "project_id": project.id,
        "name": project.name,
        "status": project.status,
        "my_shots": [schemas.ShotResponse.from_orm(s) for s in my_shots],
        "my_team_members": [{"user_id": m.id, "name": m.full_name or m.username} for m in members]
    }

@router.get("/me/messages", response_model=List[schemas.UserMessage])
def get_my_messages_read(
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    my_shot_ids = [s.id for s in db.query(models.Shot).join(models.Task).filter(models.Task.assigned_to == actor_id).all()]

    query = db.query(models.UserMessage)
    if my_shot_ids:
        query = query.filter(models.UserMessage.shot_id.in_(my_shot_ids))
    else:
        query = query.filter(models.UserMessage.author_id == actor_id)

    if since:
        query = query.filter(models.UserMessage.created_at >= since)

    msgs = query.order_by(models.UserMessage.created_at.desc()).limit(100).all()
    if not msgs:
        return []
    user_ids = {m.author_id for m in msgs}
    users = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
    user_name_map = {u.id: ((u.full_name or '').strip() or (u.username or '').strip() or None) for u in users}
    user_username_map = {u.id: u.username for u in users}
    user_email_map = {u.id: u.email for u in users}
    result = []
    for m in msgs:
        item = schemas.UserMessage.model_validate(m)
        item.author_name = user_name_map.get(m.author_id)
        item.author_username = user_username_map.get(m.author_id)
        item.author_email = user_email_map.get(m.author_id)
        result.append(item)
    return result

@router.get("/me/dm/threads")
def get_my_dm_threads(
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    # Use ORM to fetch distinct thread_ids for the current actor
    dm_threads = db.query(models.DirectMessage.thread_id).filter(
        (models.DirectMessage.sender_id == actor_id) | (models.DirectMessage.recipient_id == actor_id)
    ).distinct().all()
    dm_tids = [row[0] for row in dm_threads]
    
    # actor_idが参加するDMスレッド(3人以上)のthread_idを取得
    g_tids_rows = db.query(models.DmThreadParticipant.thread_id).filter(
        models.DmThreadParticipant.user_id == actor_id
    ).distinct().all()
    g_tids = [row[0] for row in g_tids_rows]

    all_tids = list(set(dm_tids + g_tids))
    if not all_tids:
        return []

    dms = db.query(models.DirectMessage).filter(
        models.DirectMessage.thread_id.in_(all_tids)
    ).order_by(models.DirectMessage.created_at.desc()).all()

    # 各thread_idの参加者を取得
    group_participants = {}
    for tid in g_tids:
        members = db.query(models.DmThreadParticipant.user_id).filter(
            models.DmThreadParticipant.thread_id == tid
        ).all()
        group_participants[tid] = set(uid for (uid,) in members)
                
    threads = {}
    for dm in dms:
        tid = dm.thread_id
        if tid not in threads:
            if tid >= 10000000:
                p_ids = list(group_participants.get(tid, {dm.sender_id, dm.recipient_id}))
            else:
                p1 = tid // 10000
                p2 = tid % 10000
                p_ids = [p1, p2]
                
            participants_info = []
            for pid in sorted(list(set(p_ids))):
                if pid == actor_id:
                    participants_info.append({"user_id": actor_id, "name": "Me"})
                else:
                    user = db.query(models.User).filter(models.User.id == pid).first()
                    name = user.full_name or user.username if user else f"User {pid}"
                    participants_info.append({"user_id": pid, "name": name})
                    
            threads[tid] = {
                "thread_id": tid,
                "participants": participants_info,
                "last_message": dm.body,
                "updated_at": dm.created_at.isoformat()
            }
            
    return list(threads.values())

@router.get("/dm/threads/{thread_id}/messages", response_model=List[schemas.DMMessageResponse])
def get_dm_thread_messages(
    thread_id: int,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    # Thread membership check
    if thread_id >= 10000000:
        member = db.query(models.DmThreadParticipant).filter(
            models.DmThreadParticipant.thread_id == thread_id,
            models.DmThreadParticipant.user_id == actor_id
        ).first()
        if not member:
            raise HTTPException(status_code=403, detail="このスレッドの参加者ではありません")
    else:
        p1 = thread_id // 10000
        p2 = thread_id % 10000
        if actor_id not in (p1, p2):
            raise HTTPException(status_code=403, detail="このスレッドの参加者ではありません")

    messages = db.query(models.DirectMessage).filter(
        models.DirectMessage.thread_id == thread_id
    ).order_by(models.DirectMessage.created_at.asc()).all()
    return messages

@router.post("/dm/threads/{thread_id}/read", response_model=schemas.DMReadResponse)
def mark_dm_thread_read(
    thread_id: int,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    # Thread membership check
    if thread_id >= 10000000:
        member = db.query(models.DmThreadParticipant).filter(
            models.DmThreadParticipant.thread_id == thread_id,
            models.DmThreadParticipant.user_id == actor_id
        ).first()
        if not member:
            raise HTTPException(status_code=403, detail="このスレッドの参加者ではありません")
    else:
        p1 = thread_id // 10000
        p2 = thread_id % 10000
        if actor_id not in (p1, p2):
            raise HTTPException(status_code=403, detail="このスレッドの参加者ではありません")

    unread = db.query(models.DirectMessage).filter(
        models.DirectMessage.thread_id == thread_id,
        models.DirectMessage.sender_id != actor_id,
        models.DirectMessage.read_at == None  # noqa: E711
    ).all()
    now = now_jst_naive()
    for msg in unread:
        msg.read_at = now
    db.commit()
    return {"thread_id": thread_id, "read_count": len(unread)}

@router.get("/me/meeting_tasks", response_model=List[schemas.MeetingTaskResponse])
def get_my_meeting_tasks(
    status: Optional[str] = "pending",
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    user = db.query(models.User).filter(models.User.id == actor_id).first()
    if not user:
        return []
        
    query = db.query(models.MeetingTask)
    if status:
        query = query.filter(models.MeetingTask.status == status)
        
    conditions = []
    if user.full_name:
        conditions.append(models.MeetingTask.assignee_suggestion.contains(user.full_name))
    if user.username:
        conditions.append(models.MeetingTask.assignee_suggestion.contains(user.username))
        
    if conditions:
        query = query.filter(or_(*conditions))
    else:
        return []
        
    return query.all()

@router.get("/me/routines/latest")
def get_latest_routine(
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    latest = db.query(models.Routine).filter(models.Routine.user_id == actor_id).order_by(models.Routine.date.desc()).first()
    
    previous_tasks = []
    if latest:
        return {
            "routine_id": latest.id,
            "condition": latest.condition,
            "ai_priorities": latest.ai_priorities_adopted,
            "previous_tasks": previous_tasks
        }
    return {
        "routine_id": None,
        "condition": None,
        "ai_priorities": [],
        "previous_tasks": []
    }

@router.get("/projects/{project_id}/roles", response_model=schemas.ProjectRolesResponse)
def get_project_roles(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """プロジェクトのDirector/PMなど制作ロールをまとめて返す。role名→user_id の辞書形式。"""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="プロジェクトが見つかりません")
    role_entries = db.query(models.ScoreUserRole).filter(
        models.ScoreUserRole.project_id == project_id
    ).all()
    roles: dict = {}
    for entry in role_entries:
        if entry.role not in roles:
            roles[entry.role] = entry.user_id
    return schemas.ProjectRolesResponse(project_id=project_id, roles=roles)


@router.get("/score_user_roles", response_model=List[schemas.ScoreUserRole])
def list_score_user_roles(
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """全てのScore制作ロールを取得。project_id を指定するとそのプロジェクトのみ返す。"""
    query = db.query(models.ScoreUserRole)
    if project_id is not None:
        query = query.filter(models.ScoreUserRole.project_id == project_id)
    return query.all()


@router.post("/score_user_roles", response_model=schemas.ScoreUserRole, status_code=status.HTTP_201_CREATED)
def create_score_user_role(
    payload: schemas.ScoreUserRoleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Score制作ロールを新規登録。
    409 を返すケース:
      - 同一 (user_id, project_id) が既存 (1 user は 1 project につき 1 role)
      - 同一 (project_id, role) が既存 (1 project は 1 role につき 1 user、director/PM の重複割当防止)
    """
    existing_user = db.query(models.ScoreUserRole).filter(
        models.ScoreUserRole.user_id == payload.user_id,
        models.ScoreUserRole.project_id == payload.project_id
    ).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="この user_id + project_id の組み合わせは既に登録されています")
    existing_role = db.query(models.ScoreUserRole).filter(
        models.ScoreUserRole.project_id == payload.project_id,
        models.ScoreUserRole.role == payload.role
    ).first()
    if existing_role:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"project_id={payload.project_id} には既に role='{payload.role}' の担当者 (user_id={existing_role.user_id}) が割り当てられています。先に既存割当を削除・変更してください。",
        )
    new_role = models.ScoreUserRole(
        user_id=payload.user_id,
        project_id=payload.project_id,
        role=payload.role
    )
    db.add(new_role)
    db.commit()
    db.refresh(new_role)
    return new_role


@router.patch("/score_user_roles/{role_id}", response_model=schemas.ScoreUserRole)
def update_score_user_role(
    role_id: int,
    payload: schemas.ScoreUserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Score制作ロールのroleフィールドを変更。
    変更後の (project_id, role) が別レコードと衝突する場合は 409。
    """
    target = db.query(models.ScoreUserRole).filter(models.ScoreUserRole.id == role_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定されたロール割当が見つかりません")
    if payload.role != target.role:
        conflict = db.query(models.ScoreUserRole).filter(
            models.ScoreUserRole.project_id == target.project_id,
            models.ScoreUserRole.role == payload.role,
            models.ScoreUserRole.id != role_id,
        ).first()
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"project_id={target.project_id} には既に role='{payload.role}' の担当者 (user_id={conflict.user_id}) が割り当てられています",
            )
    target.role = payload.role
    db.commit()
    db.refresh(target)
    return target


@router.delete("/score_user_roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_score_user_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Score制作ロール割当を削除"""
    target = db.query(models.ScoreUserRole).filter(models.ScoreUserRole.id == role_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定されたロール割当が見つかりません")
    db.delete(target)
    db.commit()


@router.post("/reference_materials", response_model=schemas.ReferenceMaterial, status_code=status.HTTP_201_CREATED)
def create_reference_material(
    payload: schemas.ReferenceMaterialCreate,
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_id_for_write_eps)
):
    """参考資料を新規登録"""
    created_by = actor_id if payload.created_by is None else payload.created_by
    new_material = models.ReferenceMaterial(
        shot_id=payload.shot_id,
        task_id=payload.task_id,
        title=payload.title,
        media_type=payload.media_type,
        file_path=payload.file_path,
        created_by=created_by,
        created_at=now_jst_naive()
    )
    try:
        db.add(new_material)
        db.commit()
        db.refresh(new_material)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"参考資料の DB 保存に失敗しました: {e}"
        )
    return new_material


@router.get("/me/reference_materials", response_model=List[schemas.ReferenceMaterial])
def get_my_reference_materials(
    shot_id: Optional[int] = Query(None),
    task_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    """参考資料一覧を取得"""
    query = db.query(models.ReferenceMaterial)
    if shot_id is not None:
        query = query.filter(models.ReferenceMaterial.shot_id == shot_id)
    if task_id is not None:
        query = query.filter(models.ReferenceMaterial.task_id == task_id)
    return query.all()

