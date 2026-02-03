from passlib.context import CryptContext

import os
from typing import Annotated, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .database import get_db
from . import crud, models

# main.py から pwd_context の定義を移動
pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")

# パスワードハッシュ化関数を追加
def get_password_hash(password: str) -> str:
    """パスワードをハッシュ化する"""
    return pwd_context.hash(password)

# パスワード検証関数（本番では詳細ログを出さない）
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """平文パスワードとハッシュ化パスワードを比較"""
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False

# --- Token / Auth helpers ---
# NOTE: router から import されるため、このファイル単体で循環 import なく使えるように定義する。
_SECRET_DEFAULT = "your_very_secret_key_that_is_long_and_secure"
SECRET_KEY = os.getenv("SECRET_KEY", _SECRET_DEFAULT)
ALGORITHM = "HS256"

# docs 用の tokenUrl。実際の通信は Vite proxy の設定に依存する。
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/token")


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Session = Depends(get_db),
) -> models.User:
    """JWT トークンを検証し、対応するユーザーを DB から取得"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="認証の有効期限が切れました。再度ログインしてください。",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: Optional[str] = payload.get("sub")  # email を想定
        if not username:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = crud.get_user_by_email(db, email=username)
    if user is None:
        raise credentials_exception

    return user


async def get_current_active_admin(
    current_user: Annotated[models.User, Depends(get_current_user)],
) -> models.User:
    """管理者のみ許可"""
    if getattr(current_user, "role", None) != "admin":
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return current_user