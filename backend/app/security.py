import os
import logging
from typing import Annotated, Optional, Union
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .database import get_db, engine
from . import models
from .timezone import now_jst_aware

logger = logging.getLogger(__name__)

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
# トークンの有効期限を24時間に設定（5:00でのみログアウトするため）
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))  # 24時間 = 1440分

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

    # CLIバイパストークンの検証
    # 案A(本番無効化): CLI_BYPASS_TOKEN が env に未設定/空文字の場合、`bypass_token and ...` が
    #   False となりこの分岐には入らない（= 本番で env 未設定なら自動的に無効）。
    # ※ この経路は通常のメール+パスワードログイン(JWT発行・検証)には一切関与しない。
    bypass_token = os.getenv("CLI_BYPASS_TOKEN")
    if bypass_token and token == bypass_token:
        # データベースから最初の管理者ユーザーを取得して返却
        admin_user = db.query(models.User).filter(models.User.role == "admin").first()
        if admin_user:
            # 案B(成りすまし回避/警告化): bypass は共有 admin(.first()) を返すため、
            #   そのまま per-user 用途に使うと「別ユーザー(=その admin)」化する。
            #   (1) 監査用に警告ログを残す。(2) bypass 由来であることを印付けし、
            #       中継系(get_actor_user_id)で X-Actor-User-Id 必須化を強制する。
            logger.debug(
                "AUTH bypass: CLI_BYPASS_TOKEN used; principal resolved to admin user_id=%s. "
                "X-Actor-User-Id is required for per-user relay (enforced by get_actor_user_id).", admin_user.id
            )
            try:
                setattr(admin_user, "_auth_via_bypass", True)
            except Exception:
                pass
            return admin_user
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="バイパス認証に成功しましたが、管理者ユーザーがデータベースに見つかりません。"
        )

    # ▼ 通常ログイン経路（メール+パスワードで発行された JWT の検証）— 本修正では一切変更していない。
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: Optional[str] = payload.get("sub")  # email を想定
        if not username:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    from . import crud
    user = crud.get_user_by_email(db, email=username)
    if user is None:
        raise credentials_exception

    if not getattr(user, "is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このアカウントは無効化されています。管理者にお問い合わせください。",
        )

    # 軽量監査ログ(③): 通常JWT本人解決。高頻度のため debug レベル。
    logger.debug("AUTH jwt: principal resolved to user_id=%s (sub=email).", user.id)
    return user


async def get_current_active_admin(
    current_user: Annotated[models.User, Depends(get_current_user)],
) -> models.User:
    """管理者のみ許可"""
    if getattr(current_user, "role", None) != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="管理者権限が必要です",
        )
    return current_user


def authenticate_user(db: Session, username: str, password: str) -> Union[models.User, bool]:
    """ユーザー名とパスワードで認証し、成功すれば User オブジェクトを返す。

    verify_and_update を使用し、旧 argon2/bcrypt ハッシュも検証可能とする。
    検証成功かつ現行方式へ移行が必要な場合は自動再ハッシュして DB を更新する
    （deprecated="auto" 設定による後方互換移行）。
    """
    from . import crud
    db_user = crud.get_user_by_email(db, email=username)
    if not db_user:
        return False
    if not getattr(db_user, "is_active", True):
        return False
    try:
        is_valid, new_hash = pwd_context.verify_and_update(password, db_user.hashed_password)
    except Exception:
        return False
    if not is_valid:
        return False
    if new_hash:
        db_user.hashed_password = new_hash
        db.add(db_user)
        db.commit()
    return db_user


async def verify_readonly_token(
    x_readonly_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
) -> None:
    """Score向け read-only トークン検証。CLI_BYPASS_TOKEN とは完全別系統。"""
    readonly_token = os.getenv("SCORE_READONLY_TOKEN")
    if not readonly_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SCORE_READONLY_TOKEN がサーバーに設定されていません。",
        )
    bearer_token = None
    if authorization and authorization.startswith("Bearer "):
        bearer_token = authorization.split("Bearer ", 1)[1].strip()
    candidate = x_readonly_token or bearer_token
    if not candidate or candidate != readonly_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="有効な read-only トークンが必要です。X-Readonly-Token ヘッダまたは Authorization: Bearer を使用してください。",
        )


async def verify_casper_write_token(
    authorization: Optional[str] = Header(None),
    x_actor_user_id: Optional[int] = Header(None),
) -> int:
    """CASPER_WRITE_TOKEN 専用検証。get_current_user() を呼ばないため他EPでは自動的に401。"""
    casper_write_token = os.getenv("CASPER_WRITE_TOKEN")
    if not casper_write_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CASPER_WRITE_TOKEN がサーバーに設定されていません。",
        )
    bearer_token = None
    if authorization and authorization.startswith("Bearer "):
        bearer_token = authorization.split("Bearer ", 1)[1].strip()
    if not bearer_token or bearer_token != casper_write_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="有効な CASPER_WRITE_TOKEN が必要です。Authorization: Bearer を使用してください。",
        )
    if not x_actor_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Actor-User-Id ヘッダーは CASPER_WRITE_TOKEN 使用時に必須です。",
        )
    return x_actor_user_id


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """
    JWTアクセストークンを作成。
    期限は「次の午前5時 (JST)」に設定。
    """
    to_encode = data.copy()
    
    # 日本時間 (JST) での現在時刻を取得
    now_jst = now_jst_aware()
    
    # 「次の午前5時」を計算
    # 5時前なら今日の5時、5時過ぎなら明日の5時
    if now_jst.hour < 5:
        target_5am_jst = now_jst.replace(hour=5, minute=0, second=0, microsecond=0)
    else:
        target_5am_jst = (now_jst + timedelta(days=1)).replace(hour=5, minute=0, second=0, microsecond=0)
    
    # JWT の exp クレーム用には UTC 形式の datetime を渡す (python-jose が処理)
    expire = target_5am_jst.astimezone(timezone.utc).replace(tzinfo=None)
    
    # 開発用などの明示的な期限指定がある場合はそちらを優先
    if expires_delta:
        expire = datetime.utcnow() + expires_delta

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
