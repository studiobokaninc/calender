import logging
from typing import List, Annotated

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
import shutil
import uuid
import os
from pathlib import Path

from .. import crud, models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/users", tags=["Users"])

@router.get("", response_model=List[schemas.UserResponse])
async def get_users_endpoint(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    skip: int = 0,
    limit: int = 10000
):
    """ユーザーのリストを取得"""
    try:
        users = crud.get_users(db=db, skip=skip, limit=limit)
        
        # バリデーション & アバター fallback
        response_users = []
        for u in users:
            if u.email and '@' in u.email:
                u_data = schemas.UserResponse.from_orm(u)
                if not u_data.avatar_url:
                    u_data.avatar_url = f"/api/users/{u.id}/avatar"
                response_users.append(u_data)
        return response_users
    except Exception:
        logger.exception("ユーザー情報の取得に失敗しました")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="ユーザー情報の取得に失敗しました。")


@router.post("", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user_endpoint(
    user_data: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin)
):
    """新規ユーザーを作成 (管理者のみ)"""
    existing_user = crud.get_user_by_email(db, email=user_data.email)
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="このメールアドレスは既に使用されています")
    
    created_user = crud.create_user(db=db, user=user_data)
    return created_user


@router.put("/{user_id}", response_model=schemas.UserResponse)
async def update_user_endpoint(
    user_id: int,
    user_data: schemas.UserUpdate,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    db: Session = Depends(get_db) 
):
    """ユーザー情報を更新"""
    db_user = crud.get_user(db=db, user_id=user_id)
    if db_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ユーザーが見つかりません")

    # 権限チェック (管理者 or 自分自身)
    if not (current_user.role == 'admin' or current_user.id == user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="このユーザーを編集する権限がありません")

    updated_user = crud.update_user(db=db, db_user=db_user, user_in=user_data)
    return updated_user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_endpoint(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin)
):
    """ユーザーを削除 (管理者のみ)"""
    if current_user.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自分自身を削除することはできません")
    
    db_user = crud.get_user(db=db, user_id=user_id)
    if db_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ユーザーが見つかりません")
    
    crud.delete_user(db=db, db_user=db_user)
    return None


@router.get("/{user_id}/avatar")
async def get_user_avatar(
    user_id: int,
    db: Session = Depends(get_db)
):
    """
    ユーザーのアバター画像を返します。
    アバター画像がない場合、頭文字入りの美麗なプレースホルダーSVG画像を動的に返却します。
    """
    import hashlib
    import os
    from fastapi.responses import Response, FileResponse, RedirectResponse

    db_user = crud.get_user(db=db, user_id=user_id)
    if db_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ユーザーが見つかりません")

    # もしモデルの avatar_url があってファイルが存在すればそれを返却
    if db_user.avatar_url:
        if db_user.avatar_url.startswith("http://") or db_user.avatar_url.startswith("https://"):
            return RedirectResponse(url=db_user.avatar_url)
        elif os.path.exists(db_user.avatar_url):
            return FileResponse(db_user.avatar_url)
        else:
            # staticディレクトリからの相対パスなどの場合
            BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) # backend
            relative_path = db_user.avatar_url.lstrip("/")
            full_path = os.path.join(BASE_DIR, relative_path)
            if os.path.exists(full_path):
                return FileResponse(full_path)

    # アバターがない、またはファイルが見つからない場合は動的SVGを生成して返却
    display_name = db_user.full_name or db_user.name or db_user.username or "User"
    initial = display_name[0].upper() if display_name else "?"
    
    bg_colors = ["#4A90E2", "#50E3C2", "#F5A623", "#D0021B", "#BD10E0", "#9013FE", "#417505", "#7ED321", "#F8E71C"]
    color_idx = int(hashlib.md5(display_name.encode('utf-8')).hexdigest(), 16) % len(bg_colors)
    bg_color = bg_colors[color_idx]
    
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect width="100" height="100" rx="50" fill="{bg_color}"/>
        <text x="50" y="55" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="45" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">{initial}</text>
    </svg>"""
    
    return Response(content=svg, media_type="image/svg+xml")


# Static uploads directory for avatars
AVATAR_UPLOAD_DIR = Path("static") / "uploads" / "avatars"

@router.post("/{user_id}/avatar", response_model=dict)
async def upload_user_avatar(
    user_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """ユーザーのアバター画像をアップロードする (本人または管理者のみ)"""
    if current_user.role != 'admin' and current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="他のユーザーのアバターを更新する権限がありません"
        )
        
    db_user = crud.get_user(db=db, user_id=user_id)
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ユーザーが見つかりません")
        
    allowed_extensions = {".png", ".jpg", ".jpeg", ".webp"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="許可されていないファイル形式です。PNG, JPEG, WebP のみをサポートしています"
        )
        
    MAX_SIZE = 5 * 1024 * 1024  # 5MB
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    if file_size > MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ファイルサイズが大きすぎます。最大 5MB までです"
        )

    AVATAR_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    dest_path = AVATAR_UPLOAD_DIR / unique_filename
    
    try:
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save avatar upload: {e}")
        raise HTTPException(status_code=500, detail="アバター画像の保存に失敗しました")
        
    relative_path = f"/static/uploads/avatars/{unique_filename}"
    db_user.avatar_url = relative_path
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    return {"avatar_url": f"/api/users/{user_id}/avatar"}


# --- User Profile Expansion APIs (§5-bis) ---

me_router = APIRouter(prefix="/api/me", tags=["My Profile"])

@me_router.get("/profile", response_model=schemas.UserProfileResponse)
async def get_my_profile(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """自身のプロフィールを取得 (全フィールド表示)"""
    profile_data = schemas.UserProfileResponse.from_orm(current_user)
    if not profile_data.avatar_url:
        profile_data.avatar_url = f"/api/users/{current_user.id}/avatar"
    return profile_data


@me_router.patch("/avatar")
async def update_my_avatar(
    avatar_in: schemas.AvatarUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """自身のアバターURLを設定する"""
    current_user.avatar_url = avatar_in.avatar_url
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return {"avatar_url": current_user.avatar_url}


@me_router.patch("/profile", response_model=schemas.UserProfileResponse)
async def update_my_profile(
    profile_in: schemas.UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """自身のプロフィールを更新"""
    update_data = profile_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)
    
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    
    profile_data = schemas.UserProfileResponse.from_orm(current_user)
    if not profile_data.avatar_url:
        profile_data.avatar_url = f"/api/users/{current_user.id}/avatar"
    return profile_data


@me_router.post("/avatar", response_model=dict)
async def upload_my_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """ログインユーザー自身のアバター画像をアップロードする"""
    return await upload_user_avatar(
        user_id=current_user.id,
        file=file,
        db=db,
        current_user=current_user
    )


@router.get("/birthdays_today", response_model=List[dict])
async def get_birthdays_today(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """
    当日誕生日の同僚リストを取得 (月日のみ一致するアクティブユーザー、公開部分のみ)
    """
    # 指定プロジェクトに所属するユーザーID一覧を取得
    project_user_ids = [
        r.user_id for r in db.query(models.ScoreUserRole).filter(models.ScoreUserRole.project_id == project_id).all()
    ]
    if not project_user_ids:
        return []
        
    # 今日（JST）の月日を取得
    from datetime import datetime, date
    import pytz
    today_jst = datetime.now(pytz.timezone('Asia/Tokyo')).date()
    today_month = today_jst.month
    today_day = today_jst.day
    
    # 対象プロジェクトのアクティブな全ユーザー
    users = db.query(models.User).filter(
        models.User.id.in_(project_user_ids),
        models.User.is_active == True,
        models.User.birthday.isnot(None)
    ).all()
    
    birthday_buddies = []
    for u in users:
        bday = u.birthday
        if isinstance(bday, str):
            try:
                bday = datetime.strptime(bday.split(" ")[0], "%Y-%m-%d").date()
            except ValueError:
                continue
        
        if bday and bday.month == today_month and bday.day == today_day:
            birthday_buddies.append({
                "user_id": u.id,
                "name": u.full_name or u.name or u.username,
                "avatar_url": f"/api/users/{u.id}/avatar"
            })
            
    return birthday_buddies


@router.get("/{user_id}/profile", response_model=schemas.UserProfileResponse)
async def get_other_user_profile(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """
    他者のプロフィールを取得 (公開範囲アクセス制御付き)
    """
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
        
    # 自分自身の場合は全フィールドを開示
    if current_user.id == target_user.id:
        return target_user

    # 1. 🌐 全員公開フィールドの構成
    profile_data = {
        "id": target_user.id,
        "username": target_user.username,
        "full_name": target_user.full_name or target_user.name,
        "email": target_user.email,
        "role": target_user.role,
        "is_active": target_user.is_active,
        "avatar_url": f"/api/users/{target_user.id}/avatar",
        "bio": target_user.bio,
        "skills": target_user.skills,
        # 制限されるフィールドの初期化
        "birthday": None,
        "phone": None,
        "line_id": None,
        "work_start_time": None,
        "work_end_time": None,
        "settings_json": None,
        "google_linked": False,
        "google_email": None
    }

    # 2. 🔓 同プロジェクトのメンバーであるか確認 ➔ birthday, line_id, work_start/end_time を開示
    my_projects = {r.project_id for r in db.query(models.ScoreUserRole).filter(models.ScoreUserRole.user_id == current_user.id).all()}
    target_projects = {r.project_id for r in db.query(models.ScoreUserRole).filter(models.ScoreUserRole.user_id == target_user.id).all()}
    common_projects = my_projects.intersection(target_projects)
    
    if common_projects:
        profile_data["birthday"] = target_user.birthday
        profile_data["line_id"] = target_user.line_id
        profile_data["work_start_time"] = target_user.work_start_time
        profile_data["work_end_time"] = target_user.work_end_time

    # 3. 🔒 管理者 (PM / admin) であるか確認 ➔ phone 開示
    if current_user.role in ("admin", "pm"):
        profile_data["phone"] = target_user.phone

    return schemas.UserProfileResponse(**profile_data)

