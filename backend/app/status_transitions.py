"""タスクステータスの役職ルール検証（遷移グラフ撤去版）。

出典: 殿御裁定 2026-08-03「Casperに全面追従・グラフは捨てる」
「遷移はユーザーが指示すべきもの。定めが無い場合は、都度確認せよ。」
「ゆえに強制するのは【役職ゲートのみ】」

このモジュールは status_meta.py の定数のみに依存する純関数モジュール。
"""
from __future__ import annotations

import os
import re
import unicodedata
from typing import Optional

from .status_meta import ACTIVE_STATUSES, STATUS_CATEGORY, STATUS_COLOR, STATUS_LABEL


class TransitionError(Exception):
    """TASK_TRANSITION_ENFORCE=on 時、違反した遷移で送出する。
    body は explain_transition() と同じ形(http_status キー込み)。呼び出し側(router層)で
    HTTPException(status_code=body['http_status'], detail=body) に変換する。"""

    def __init__(self, body: dict):
        self.body = body
        super().__init__(body.get("error", "transition_error"))


# ============================================================
# 1. 役職ルール (to_status 単独キー)
# ============================================================
ROLE_RANK: dict[str, int] = {"director": 40, "pm": 30, "lead": 20, "compositor": 10, "artist": 10}

ROLE_RULES: dict[str, str] = {
    "wt": "pm_or_above",
    "mk": "pm_or_above",
    "qc_fb": "pm_or_above",
    "ap": "pm_or_above",
    "client_ap": "pm_or_above",
    "completed": "pm_or_above",
}

# ============================================================
# 2. 役職オーナー表 (to_status 単独キー)
# ============================================================
TRANSITION_OWNER: dict[str, str] = {
    "wt": "pm",
    "mk": "pm",
    "wip": "artist",
    "qc": "artist",
    "qc_fb": "director",
    "ap": "director",
    "client_ap": "pm",
    "deliver": "artist",
    "completed": "pm",
}

OWNER_LABEL: dict[str, str] = {
    "auto": "オート",
    "pm": "制作",
    "artist": "アーティスト",
    "director": "ディレクター",
}

# ============================================================
# 3. 役職文字列の正規化
# ============================================================
ROLE_ALIASES: dict[str, str] = {
    "director": "director",
    "ディレクター": "director",
    "pm": "pm",
    "制作": "pm",
    "lead": "lead",
    "lightinglead": "lead",
    "compositor": "compositor",
    "artist": "artist",
    "アーティスト": "artist",
}


def normalize_role(raw: Optional[str]) -> Optional[str]:
    """役職文字列を正準形(ROLE_RANKのキー)へ正規化する。未知値はNone(素通しさせない)。"""
    if raw is None:
        return None
    s = unicodedata.normalize("NFKC", str(raw))
    s = s.strip().lower()
    s = re.sub(r"[\s_\-・]+", "", s)
    if not s:
        return None
    return ROLE_ALIASES.get(s)


_ROLE_MIN_RANK: dict[str, int] = {
    "lead_or_above": ROLE_RANK["lead"],
    "pm_or_above": ROLE_RANK["pm"],
    "director_or_above": ROLE_RANK["director"],
}

_ROLE_REQUIRED_JP: dict[str, str] = {
    "lead_or_above": "Lead以上",
    "pm_or_above": "PM以上",
    "director_or_above": "Director以上",
}

ROLE_RULE_SOURCE = 'Casper依頼書§02(2026-07-24, casper/2026-07-24/tasuku-19-suteetasu-teigi-sen-i-x-yakushoku-kakutei-noo-nega)'


def get_enforce_mode() -> str:
    """TASK_TRANSITION_ENFORCE の実効値。未設定/不正値は既定 of 'on' (fail-closed)。"""
    mode = (os.getenv("TASK_TRANSITION_ENFORCE") or "on").strip().lower()
    return mode if mode in ("off", "warn", "on") else "on"


def roles_meeting_requirement(required_role: Optional[str]) -> list[str]:
    """'pm_or_above' 等の要求ランクを満たす role 文字列一覧(rank降順)。未知requiredは空。"""
    threshold = _ROLE_MIN_RANK.get(required_role or "")
    if threshold is None:
        return []
    return sorted((r for r, rank in ROLE_RANK.items() if rank >= threshold), key=lambda r: -ROLE_RANK[r])


def _rank_meets_requirement(actor_role: Optional[str], required: str) -> bool:
    """actor_role が required('xxx_or_above')ランクを満たすか。F-7: 未設定/未知roleは拒否側。"""
    if actor_role is None:
        return False
    canonical = normalize_role(actor_role)
    if canonical is None:
        return False
    rank = ROLE_RANK.get(canonical)
    if rank is None:
        return False
    return rank >= _ROLE_MIN_RANK[required]


def _role_permitted(to_status: str, actor_role: Optional[str]) -> bool:
    required = ROLE_RULES.get(to_status)
    if required is None:
        return True  # 無制約
    return _rank_meets_requirement(actor_role, required)


# ============================================================
# 4. assigned_to(担当者)変更ゲート
# ============================================================
ASSIGNEE_CHANGE_ROLE_REQUIRED = "lead_or_above"
ASSIGNEE_CHANGE_ROLE_SOURCE = (
    "Casper依頼書§02(2026-07-24, casper/2026-07-24/"
    "tasuku-19-suteetasu-teigi-sen-i-x-yakushoku-kakutei-noo-nega) "
    "1行目「アサイン(wt/mk→担当設定) Lead以上」"
)


def explain_assignee_change(actor_role: Optional[str]) -> Optional[dict]:
    """F681-3: assigned_to(担当者)変更が許可されるか。"""
    if _rank_meets_requirement(actor_role, ASSIGNEE_CHANGE_ROLE_REQUIRED):
        return None
    return {
        "http_status": 403,
        "error": "role_not_permitted",
        "action": "assignee_change",
        "detail": (
            f"担当者(アサイン)の変更には{_ROLE_REQUIRED_JP[ASSIGNEE_CHANGE_ROLE_REQUIRED]}の役職が必要です。"
            f"あなたの役職は{actor_role or '未設定'}です。"
        ),
        "required_role": ASSIGNEE_CHANGE_ROLE_REQUIRED,
        "required_role_source": ASSIGNEE_CHANGE_ROLE_SOURCE,
        "actor_role": actor_role,
        "who_can_do_this": [],
    }


def explain_transition(
    from_status: Optional[str], to_status: Optional[str], actor_role: Optional[str] = None
) -> Optional[dict]:
    """違反時にエラーbody(dict, http_statusキー込み)を返す。役職が可ならNone。
    グラフは撤去されたため、有効な status かどうか、および役職の制約のみを判定します。"""
    if to_status is None or to_status not in ACTIVE_STATUSES:
        return {
            "http_status": 422,
            "error": "invalid_status",
            "detail": f"status='{to_status}' は無効。有効値: {sorted(ACTIVE_STATUSES)}",
        }

    to_label = STATUS_LABEL.get(to_status, to_status)

    required = ROLE_RULES.get(to_status)
    if required is None or _role_permitted(to_status, actor_role):
        return None

    return {
        "http_status": 403,
        "error": "role_not_permitted",
        "detail": (
            f"『{to_label}』への遷移は"
            f"{_ROLE_REQUIRED_JP.get(required, required)}の役職が必要です。"
            f"あなたの役職は{actor_role or '未設定'}です。"
        ),
        "from": from_status,
        "to": to_status,
        "required_role": required,
        "required_role_source": ROLE_RULE_SOURCE,
        "actor_role": actor_role,
        "actor_role_recognized": normalize_role(actor_role) is not None,
        "recognized_roles": sorted(ROLE_RANK.keys()),
        "who_can_do_this": [],
    }


def validate_transition(
    from_status: Optional[str], to_status: Optional[str], actor_role: Optional[str] = None
) -> Optional[dict]:
    """explain_transition の別名。"""
    return explain_transition(from_status, to_status, actor_role)
