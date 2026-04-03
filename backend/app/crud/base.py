import logging
import json
from datetime import datetime, date
from typing import Optional, Any
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

def _parse_datetime(date_val: str | datetime | date | None) -> Optional[datetime]:
    """日付文字列、date、またはdatetimeオブジェクトをdatetimeオブジェクトに変換"""
    if date_val is None or date_val == '':
        return None
    
    if isinstance(date_val, datetime):
        return date_val
        
    if isinstance(date_val, date):
        # date を datetime に変換 (00:00:00)
        return datetime(date_val.year, date_val.month, date_val.day)
        
    if not isinstance(date_val, str):
        logger.debug("[_parse_datetime] Unsupported type: %s", type(date_val))
        return None
        
    try:
        # ISO形式をパース
        return datetime.fromisoformat(date_val.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None

def _parse_int_safe(value: Any) -> Optional[int]:
    """値を安全に整数に変換"""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

def _safe_json_load(value: Any) -> list:
    """JSON文字列（または既にリスト）を安全にパースしてリストを返す"""
    if not value: return []
    if isinstance(value, list): return value
    try:
        return json.loads(value)
    except:
        return []
