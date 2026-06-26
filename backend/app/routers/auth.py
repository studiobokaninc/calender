import json
import urllib.parse
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from .. import schemas, models
from ..database import get_db
from ..security import (
    authenticate_user,
    create_access_token,
    get_current_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)

router = APIRouter(tags=["Auth & Users"])

@router.post("/api/auth/token")
async def login_for_access_token(
    request: Request,
    db: Session = Depends(get_db)
):
    """ユーザー名とパスワードで認証し、アクセストークンを返す。
    application/x-www-form-urlencoded・application/json の両形式を受け付ける。
    nginx が Content-Type を剥奪した場合もフォームパース優先で動作する。
    """
    username: str | None = None
    password: str | None = None

    content_type = request.headers.get("content-type", "")
    body_bytes = await request.body()
    body_str = body_bytes.decode("utf-8", errors="replace") if body_bytes else ""

    if "application/json" in content_type:
        try:
            data = json.loads(body_str)
            username = data.get("username")
            password = data.get("password")
        except (json.JSONDecodeError, AttributeError):
            pass

    if not username or not password:
        try:
            parsed = urllib.parse.parse_qs(body_str, keep_blank_values=False)
            username = (parsed.get("username") or [None])[0]
            password = (parsed.get("password") or [None])[0]
        except Exception:
            pass

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[{"loc": ["body", "username"], "msg": "username and password are required"}],
        )

    user = authenticate_user(db, username=username, password=password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/api/users/me", response_model=schemas.UserResponse)
async def read_users_me(
    response: Response,
    current_user: Annotated[models.User, Depends(get_current_user)],
):
    """現在認証されているユーザーの情報を返す"""
    response.headers["Cache-Control"] = "no-store, private"
    user_data = schemas.UserResponse.from_orm(current_user)
    if not user_data.avatar_url:
        user_data.avatar_url = f"/api/users/{current_user.id}/avatar"
    return user_data
