"""
Google Calendar 連携: OAuth2 とカレンダーイベントの作成・更新・削除。
ユーザー個人の Google カレンダーにタスクを 1 件ずつ表示するかどうかを切り替え可能にする。
"""
import os
import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

# スコープ: カレンダー全体の読み書き（専用カレンダー作成や取得に必要）
SCOPE = "https://www.googleapis.com/auth/calendar"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API = "https://www.googleapis.com/calendar/v3"


def get_google_config() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """環境変数から Google OAuth 設定を取得。 (client_id, client_secret, redirect_uri)"""
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/google/callback")
    return (client_id, client_secret, redirect_uri)


def is_google_configured() -> bool:
    """Google 連携が設定されているか"""
    client_id, client_secret, _ = get_google_config()
    return bool(client_id and client_secret)


def get_authorize_url(state: Optional[str] = None) -> Optional[str]:
    """Google 認証ページへの URL を生成。未設定なら None。"""
    client_id, _, redirect_uri = get_google_config()
    if not client_id or not redirect_uri:
        return None
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "hd": "studiobokan.com", # Workspace domain 制限
    }
    if state:
        params["state"] = state
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code_for_tokens(code: str) -> Optional[dict]:
    """認証コードをトークンに交換。成功時は { access_token, refresh_token?, expires_in } を返す。"""
    client_id, client_secret, redirect_uri = get_google_config()
    if not all([client_id, client_secret, redirect_uri]):
        return None
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "code": code,
        "grant_type": "authorization_code",
    }
    try:
        with httpx.Client() as client:
            r = client.post(TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=15.0)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.exception("Google token exchange failed: %s", e)
        return None


def refresh_access_token(refresh_token: str) -> Optional[dict]:
    """refresh_token で新しい access_token を取得。成功時はレスポンス全体を返す。"""
    client_id, client_secret, _ = get_google_config()
    if not all([client_id, client_secret]):
        return None
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    try:
        with httpx.Client() as client:
            r = client.post(TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=15.0)
            if r.status_code != 200:
                logger.error(f"Google token refresh failed. Status: {r.status_code}, Body: {r.text}")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error("Google token refresh failed with exception: %s", e)
        return None


def _ensure_valid_token(access_token: str, refresh_token: Optional[str], expires_at: Optional[datetime]) -> Optional[str]:
    """有効な access_token を返す（期限切れなら refresh）。"""
    if expires_at and datetime.utcnow() < expires_at - timedelta(minutes=5):
        return access_token
    if refresh_token:
        tokens = refresh_access_token(refresh_token)
        return tokens.get("access_token") if tokens else None
    return access_token

def get_or_create_app_calendar(
    access_token: str,
    refresh_token: Optional[str],
    expires_at: Optional[datetime],
) -> Optional[str]:
    """アプリ用のカレンダーを取得するか作成して、その ID を返す"""
    token = _ensure_valid_token(access_token, refresh_token, expires_at)
    if not token:
        return None
    
    calendar_name = "Calendar App Tasks"
    try:
        with httpx.Client() as client:
            r = client.get(
                f"{CALENDAR_API}/users/me/calendarList",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0,
            )
            r.raise_for_status()
            calendars = r.json().get("items", [])
            for cal in calendars:
                if cal.get("summary") == calendar_name:
                    return cal.get("id")
            
            body = {
                "summary": calendar_name,
                "description": "カレンダーアプリからのタスク・プロジェクト・イベント"
            }
            res = client.post(
                f"{CALENDAR_API}/calendars",
                json=body,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=15.0,
            )
            res.raise_for_status()
            return res.json().get("id")
    except Exception as e:
        logger.exception("Google Calendar get/create app calendar failed: %s", e)
        return None


def create_calendar_event(
    access_token: str,
    refresh_token: Optional[str],
    expires_at: Optional[datetime],
    task_name: str,
    start_date: Optional[datetime],
    end_date: Optional[datetime],
    description: Optional[str] = None,
    calendar_id: Optional[str] = None,
    is_all_day: bool = False,
    sync_id: Optional[str] = None,
) -> Optional[str]:
    """
    ユーザーのカレンダーにイベントを作成。
    成功時は Google のイベント ID を返す。失敗時は None。
    """
    token = _ensure_valid_token(access_token, refresh_token, expires_at)
    if not token:
        return None
    def _to_dt(d):
        if isinstance(d, str):
            try:
                return datetime.fromisoformat(d.replace('Z', '+00:00'))
            except:
                return None
        return d

    start_date = _to_dt(start_date)
    end_date = _to_dt(end_date)

    if not start_date:
        start_date = datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=microsecond) if 'microsecond' in locals() else datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=0)
    if not end_date:
        end_date = start_date + timedelta(hours=1)
        
    if is_all_day:
        from pytz import timezone
        jst = timezone("Asia/Tokyo")
        # Ensure we are in JST before taking the date component to avoid UTC day shifts
        start_date_jst = start_date.astimezone(jst) if start_date.tzinfo else start_date
        end_date_jst = end_date.astimezone(jst) if end_date.tzinfo else end_date
        
        start_date_obj = start_date_jst.date()
        end_date_obj = end_date_jst.date()
            
        body = {
            "summary": task_name[:1024],
            "description": (description or "")[:8192],
            "start": {"date": start_date_obj.strftime("%Y-%m-%d")},
            "end": {"date": end_date_obj.strftime("%Y-%m-%d")},
        }
    else:
        # start_date are JST naive. We will format them as JST.
        body = {
            "summary": task_name[:1024],
            "description": (description or "")[:8192],
            "start": {"dateTime": start_date.isoformat(), "timeZone": "Asia/Tokyo"},
            "end": {"dateTime": end_date.isoformat(), "timeZone": "Asia/Tokyo"},
        }
    
    if sync_id:
        safe_id = sync_id.replace("_", "").replace("-", "").lower()
        if len(safe_id) < 5:
            safe_id = "syncevent" + safe_id
        body["id"] = safe_id

    target_calendar = calendar_id or "primary"
    
    try:
        with httpx.Client() as client:
            r = client.post(
                f"{CALENDAR_API}/calendars/{target_calendar}/events",
                headers={"Authorization": f"Bearer {token}"},
                json=body,
                timeout=15.0,
            )
            if r.status_code == 409: # すでに存在
                logger.warning(f"Event ID {body.get('id')} already exists. Try updating instead.")
                return body.get("id")
            
            try:
                r.raise_for_status()
            except httpx.HTTPStatusError as e:
                logger.error(f"Google Calendar API 400 error body: {r.text}")
                logger.error(f"Request body was: {body}")
                raise e
                
            res = r.json()
            return res.get("id")
    except Exception as e:
        logger.error(f"Google Calendar create event failed: {e}")
        return None


def update_calendar_event(
    access_token: str,
    refresh_token: Optional[str],
    expires_at: Optional[datetime],
    event_id: str,
    task_name: str,
    start_date: Optional[datetime],
    end_date: Optional[datetime],
    description: Optional[str] = None,
    calendar_id: Optional[str] = None,
    is_all_day: bool = False,
    sync_id: Optional[str] = None,
) -> bool:
    """既存イベントを更新。"""
    token = _ensure_valid_token(access_token, refresh_token, expires_at)
    if not token:
        return False
    def _to_dt(d):
        if isinstance(d, str):
            try:
                return datetime.fromisoformat(d.replace('Z', '+00:00'))
            except:
                return None
        return d

    start_date = _to_dt(start_date)
    end_date = _to_dt(end_date)

    if not start_date:
        start_date = datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=0)
    if not end_date:
        end_date = start_date + timedelta(hours=1)
        
    if is_all_day:
        from pytz import timezone
        jst = timezone("Asia/Tokyo")
        # Ensure we are in JST before taking the date component to avoid UTC day shifts
        start_date_jst = start_date.astimezone(jst) if start_date.tzinfo else start_date
        end_date_jst = end_date.astimezone(jst) if end_date.tzinfo else end_date
        
        start_date_obj = start_date_jst.date()
        end_date_obj = end_date_jst.date()
            
        body = {
            "summary": task_name[:1024],
            "description": (description or "")[:8192],
            "start": {"date": start_date_obj.strftime("%Y-%m-%d")},
            "end": {"date": end_date_obj.strftime("%Y-%m-%d")},
        }
    else:
        body = {
            "summary": task_name[:1024],
            "description": (description or "")[:8192],
            "start": {"dateTime": start_date.isoformat(), "timeZone": "Asia/Tokyo"},
            "end": {"dateTime": end_date.isoformat(), "timeZone": "Asia/Tokyo"},
        }
    
    if sync_id:
        body["extendedProperties"] = {"private": {"app_sync_id": sync_id}}
        
    target_calendar = calendar_id or "primary"
    
    try:
        with httpx.Client() as client:
            r = client.patch(
                f"{CALENDAR_API}/calendars/{target_calendar}/events/{event_id}",
                json=body,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=15.0,
            )
            r.raise_for_status()
            return True
    except Exception as e:
        logger.exception("Google Calendar update event failed: %s", e)
        return False


def delete_calendar_event(
    access_token: str,
    refresh_token: Optional[str],
    expires_at: Optional[datetime],
    event_id: str,
    calendar_id: Optional[str] = None,
) -> bool:
    """カレンダーからイベントを削除。"""
    token = _ensure_valid_token(access_token, refresh_token, expires_at)
    if not token:
        return False
        
    target_calendar = calendar_id or "primary"
    
    try:
        with httpx.Client() as client:
            r = client.delete(
                f"{CALENDAR_API}/calendars/{target_calendar}/events/{event_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0,
            )
            # 204, 404 (Not Found), 410 (Gone) は既に削除済みなので成功扱い
            if r.status_code in (204, 404, 410):
                return True
            # 403 は権限不足などのため、削除不可として失敗を返す（トレースバックは出さない）
            if r.status_code == 403:
                logger.error(f"Google Calendar delete event 403 Forbidden: {event_id} in {target_calendar}")
                return False
            r.raise_for_status()
            return True
    except Exception as e:
        # その他の予期せぬエラー
        logger.error(f"Google Calendar delete event failed: {e}")
        return False

def find_event_by_sync_id(
    access_token: str,
    refresh_token: Optional[str],
    expires_at: Optional[datetime],
    sync_id: str,
    calendar_id: Optional[str] = None,
) -> Optional[str]:
    """sync_id (extendedProperties) を使って既存のイベントを検索し、最初に見つかった ID を返す。"""
    token = _ensure_valid_token(access_token, refresh_token, expires_at)
    if not token:
        return None
    
    target_calendar = calendar_id or "primary"
    try:
        with httpx.Client() as client:
            r = client.get(
                f"{CALENDAR_API}/calendars/{target_calendar}/events",
                headers={"Authorization": f"Bearer {token}"},
                params={"privateExtendedProperty": f"app_sync_id={sync_id}"},
                timeout=15.0,
            )
            r.raise_for_status()
            items = r.json().get("items", [])
            if items:
                return items[0].get("id")
    except Exception as e:
        logger.exception("Google Calendar find event by sync_id failed: %s", e)
    return None
