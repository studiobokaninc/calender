from fastapi import APIRouter, Depends, HTTPException, Header, status, Form, UploadFile, File, Body, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_, and_, func
from typing import List, Optional
from .. import models, schemas, database, security
from ..database import get_db
from ..security import get_current_user
from datetime import datetime
from ..timezone import now_jst_naive
import shutil
from pathlib import Path

router = APIRouter(prefix="/api", tags=["score"])

# --- Helpers ---

def get_actor_user_id(
    x_actor_user_id: Optional[int] = Header(None),
    current_user: models.User = Depends(get_current_user)
) -> int:
    """
    ヘッダーから実操作者のIDを取得します。
    管理者のみ X-Actor-User-Id ヘッダーで任意のユーザーIDを指定できます。
    一般ユーザーがヘッダーを指定した場合は、自分自身のIDを使用します。
    """
    if x_actor_user_id and current_user.role == 'admin':
        return x_actor_user_id
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
    
    db_shot.status = "completed"
    db_shot.updated_at = now_jst_naive()
    
    # 承認履歴などを記録する仕組みが必要な場合はここに追加
    db.commit()
    db.refresh(db_shot)
    return db_shot

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
    
    db_timecard = models.Timecard(
        user_id=user_id,
        date=timecard_in.date,
        clock_out_at=timecard_in.clock_out_at or now_jst_naive(),
        worked_minutes=timecard_in.worked_minutes,
        break_minutes=timecard_in.break_minutes,
        memo=timecard_in.memo
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

@router.post("/assets", response_model=schemas.AssetResponse, status_code=status.HTTP_201_CREATED)
def upload_asset(
    file: UploadFile = File(...),
    shot_id: int = Form(...),
    task_id: Optional[int] = Form(None),
    version: str = Form(...),
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    assets_dir = Path("static/assets")
    assets_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = assets_dir / f"shot_{shot_id}_task_{task_id}_{version}_{file.filename}"
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    db_asset = models.Asset(
        shot_id=shot_id,
        task_id=task_id,
        version=version,
        file_path=str(file_path.as_posix()),
        created_by=actor_id,
        created_at=now_jst_naive()
    )
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    return db_asset

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
    if not thread_id:
        thread_id = min(actor_id, recipient_id) * 10000 + max(actor_id, recipient_id)
        
    db_dm = models.DirectMessage(
        thread_id=thread_id,
        sender_id=actor_id,
        recipient_id=recipient_id,
        body=dm_in.body,
        context_json=dm_in.context_json,
        created_at=now_jst_naive()
    )
    db.add(db_dm)
    db.commit()
    db.refresh(db_dm)
    return db_dm

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
    current_user: models.User = Depends(get_current_user),
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # actor_id が指定されている場合はそのユーザーを返す（Score Backend からの中継用）
    user = db.query(models.User).filter(models.User.id == actor_id).first()
    return user

@router.get("/me/tasks", response_model=List[schemas.TaskResponse])
def get_my_tasks(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    return db.query(models.Task).filter(models.Task.assigned_to == actor_id).all()

@router.get("/me/shots", response_model=List[schemas.ShotResponse])
def get_my_shots(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # タスクがアサインされているショットを抽出
    return db.query(models.Shot).join(models.Task).filter(models.Task.assigned_to == actor_id).distinct().all()

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
    # タスクがアサインされているプロジェクト
    return db.query(models.Project).join(models.Task).filter(models.Task.assigned_to == actor_id).distinct().all()

@router.get("/me/retakes", response_model=List[schemas.Retake])
def get_my_retakes(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # 自分が発行した、または自分の担当ショットに対するリテイク
    query = db.query(
        models.Retake,
        models.Shot.shot_code,
        models.Project.name.label("project_name")
    ).join(models.Shot, models.Retake.shot_id == models.Shot.id)\
     .join(models.Project, models.Shot.project_id == models.Project.id)\
     .join(models.Task, models.Task.shot_id == models.Shot.id, isouter=True)\
     .filter(
        (models.Retake.created_by == actor_id) | (models.Task.assigned_to == actor_id)
    ).distinct()
    
    results = query.options(selectinload(models.Retake.timecodes)).all()
    
    for r, sc, pn in results:
        r.shot_code = sc
        r.project_name = pn
    return [r for r, sc, pn in results]

@router.get("/me/troubles", response_model=List[schemas.Trouble])
def get_my_troubles(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # 自分が報告した、または自分にアサインされたトラブル
    query = db.query(
        models.Trouble,
        models.Shot.shot_code,
        models.Project.name.label("project_name"),
        models.User.full_name.label("reporter_name")
    ).join(models.Shot, models.Trouble.shot_id == models.Shot.id)\
     .join(models.Project, models.Shot.project_id == models.Project.id)\
     .join(models.User, models.Trouble.created_by == models.User.id)\
     .filter(
        (models.Trouble.created_by == actor_id) | (models.Trouble.assigned_to == actor_id)
    )
    
    results = query.all()
    
    for t, sc, pn, rn in results:
        t.shot_code = sc
        t.project_name = pn
        t.reporter_name = rn
    return [t for t, sc, pn, rn in results]

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
            "tasks": shot_tasks_map.get(s.id, {})
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
    query = db.query(
        models.Retake,
        models.Shot.shot_code,
        models.Project.name.label("project_name")
    ).join(models.Shot, models.Retake.shot_id == models.Shot.id)\
     .join(models.Project, models.Shot.project_id == models.Project.id)\
     .filter(models.Project.display_status == 'online')\
     .options(selectinload(models.Retake.timecodes))
    
    if shot_id:
        query = query.filter(models.Retake.shot_id == shot_id)
    if project_id:
        query = query.filter(models.Shot.project_id == project_id)
        
    results = query.order_by(models.Retake.created_at.desc()).all()
    
    # マッピング
    for r, sc, pn in results:
        r.shot_code = sc
        r.project_name = pn
    return [r for r, sc, pn in results]

@router.get("/troubles", response_model=List[schemas.Trouble])
def list_troubles(
    shot_id: Optional[int] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    query = db.query(
        models.Trouble,
        models.Shot.shot_code,
        models.Project.name.label("project_name"),
        models.User.full_name.label("reporter_name")
    ).join(models.Shot, models.Trouble.shot_id == models.Shot.id)\
     .join(models.Project, models.Shot.project_id == models.Project.id)\
     .join(models.User, models.Trouble.created_by == models.User.id)\
     .filter(models.Project.display_status == 'online')
     
    if shot_id:
        query = query.filter(models.Trouble.shot_id == shot_id)
    if project_id:
        query = query.filter(models.Shot.project_id == project_id)
        
    results = query.order_by(models.Trouble.created_at.desc()).all()
    
    for t, sc, pn, rn in results:
        t.shot_code = sc
        t.project_name = pn
        t.reporter_name = rn
    return [t for t, sc, pn, rn in results]

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
    query = db.query(models.LookDistribution)
    results = query.order_by(models.LookDistribution.created_at.desc()).all()
    
    if project_id:
        # プロジェクトに属するショットのIDを取得
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
    query = db.query(models.Notification)
    if recipient_id:
        query = query.filter(models.Notification.recipient_id == recipient_id)
    if project_id:
        # 通知にプロジェクトIDがないため、本文にプロジェクト名が含まれるか、
        # またはプロジェクトに属するショットコードが含まれるかで簡易的にフィルタリング
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if project:
            query = query.filter(models.Notification.body.contains(project.name))
            
    return query.order_by(models.Notification.created_at.desc()).all()

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
        
    return query.order_by(models.UserMessage.created_at.desc()).all()

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
        
    return query.order_by(models.UserMessage.created_at.desc()).limit(100).all()

@router.get("/me/dm/threads")
def get_my_dm_threads(
    db: Session = Depends(get_db),
    actor_id: int = Depends(get_actor_user_id)
):
    dms = db.query(models.DirectMessage).filter(
        or_(
            models.DirectMessage.sender_id == actor_id,
            models.DirectMessage.recipient_id == actor_id
        )
    ).order_by(models.DirectMessage.created_at.desc()).all()
    
    threads = {}
    for dm in dms:
        tid = dm.thread_id
        if tid not in threads:
            other_id = dm.recipient_id if dm.sender_id == actor_id else dm.sender_id
            other_user = db.query(models.User).filter(models.User.id == other_id).first()
            threads[tid] = {
                "thread_id": tid,
                "participants": [{"user_id": actor_id, "name": "Me"}, {"user_id": other_id, "name": other_user.full_name or other_user.username if other_user else "Unknown"}],
                "last_message": dm.body,
                "updated_at": dm.created_at.isoformat()
            }
    return list(threads.values())

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

@router.get("/score_user_roles", response_model=List[schemas.ScoreUserRole])
def list_score_user_roles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """全てのScore制作ロールを取得"""
    return db.query(models.ScoreUserRole).all()

