from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional
from .. import models, schemas, database, security
from ..database import get_db
from ..security import get_current_user
from datetime import datetime
from ..timezone import now_jst_naive

router = APIRouter(prefix="/api", tags=["score"])

# --- Helpers ---

def get_actor_user_id(
    x_actor_user_id: Optional[int] = Header(None),
    current_user: models.User = Depends(get_current_user)
) -> int:
    """
    ヘッダーから実操作者のIDを取得します。
    ヘッダーがない場合は、認証されたユーザーのIDを使用します。
    """
    if x_actor_user_id:
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
            comment=tc.comment
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
    return db.query(models.Retake).options(selectinload(models.Retake.timecodes)).join(models.Shot).join(models.Task, isouter=True).filter(
        (models.Retake.created_by == actor_id) | (models.Task.assigned_to == actor_id)
    ).distinct().all()

@router.get("/me/troubles", response_model=List[schemas.Trouble])
def get_my_troubles(
    actor_id: int = Depends(get_actor_user_id),
    db: Session = Depends(get_db)
):
    # 自分が報告した、または自分にアサインされたトラブル
    return db.query(models.Trouble).filter(
        (models.Trouble.created_by == actor_id) | (models.Trouble.assigned_to == actor_id)
    ).all()

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
    query = db.query(models.LookDistribution)
    if project_id:
        # look_distributions には shot_ids (JSON) があるが、紐付けが複雑なので
        # 今回は単純に全件または作成者などでフィルタリングする想定
        # 本来は shot_ids を展開して project_id を確認する必要がある
        pass
    return query.order_by(models.LookDistribution.created_at.desc()).all()

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
    db: Session = Depends(get_db)
):
    query = db.query(models.Notification)
    if recipient_id:
        query = query.filter(models.Notification.recipient_id == recipient_id)
    return query.order_by(models.Notification.created_at.desc()).all()

@router.get("/user_messages", response_model=List[schemas.UserMessage])
def list_user_messages(
    shot_id: Optional[int] = None,
    author_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    query = db.query(models.UserMessage)
    if shot_id:
        query = query.filter(models.UserMessage.shot_id == shot_id)
    if author_id:
        query = query.filter(models.UserMessage.author_id == author_id)
    return query.order_by(models.UserMessage.created_at.desc()).all()
