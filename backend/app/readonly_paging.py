"""読取専用の一覧に共通の「続きから取る頁送り」(cursor / next_cursor)。

cursor を付けぬ呼出は従来どおり(並び・offset/limit は口ごとの既定のまま)。
cursor を付けた呼出は id 降順一本で、直前の頁の最後の id より小さい行を limit 件返す。
cursor の中身は不透明な文字列で、呼び手に解釈させない。
"""
import base64
import binascii
from typing import Any, List, Optional, Sequence, Tuple

from fastapi import HTTPException

CURSOR_START = "start"
_PREFIX = "v1:"
_MAX_ID = 2 ** 63 - 1  # SQLite の符号付き64bit整数の上限


def encode_cursor(last_id: int) -> str:
    return base64.urlsafe_b64encode(f"{_PREFIX}{last_id}".encode("ascii")).decode("ascii")


def decode_cursor(cursor: str) -> Optional[int]:
    """start なら None(先頭から)、それ以外は直前の頁の最後の id。壊れた値は 400。"""
    if cursor == CURSOR_START:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("ascii")
        if not raw.startswith(_PREFIX):
            raise ValueError
        last_id = int(raw[len(_PREFIX):])
        if not 0 < last_id <= _MAX_ID:
            raise ValueError
    except (ValueError, UnicodeError, binascii.Error):
        raise HTTPException(status_code=400, detail="cursor が不正です。next_cursor の値をそのまま指定してください。")
    return last_id


def reject_cursor_with_offset(cursor: Optional[str], offset: int) -> None:
    if cursor is not None and offset > 0:
        raise HTTPException(status_code=400, detail="cursor と offset は併用できません。")


def page_rows(
    q,
    id_col,
    legacy_order: Sequence[Any],
    limit: int,
    offset: int,
    cursor: Optional[str],
) -> Tuple[int, List[Any], Optional[str]]:
    """(total, rows, next_cursor) を返す。total は絞り込み後の、その時点の総件数。"""
    total = q.count()
    if cursor is None:
        rows = q.order_by(*legacy_order).offset(offset).limit(limit).all()
        return total, rows, None
    reject_cursor_with_offset(cursor, offset)
    last_id = decode_cursor(cursor)
    if last_id is not None:
        q = q.filter(id_col < last_id)
    rows = q.order_by(id_col.desc()).limit(limit + 1).all()
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = encode_cursor(rows[-1].id)
    return total, rows, next_cursor
