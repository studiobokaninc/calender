import logging
from typing import List, Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

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
        
        # バリデーション
        valid_users = [u for u in users if u.email and '@' in u.email]
        return valid_users
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

