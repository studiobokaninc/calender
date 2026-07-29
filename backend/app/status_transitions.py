"""タスクステータス(canonical9値)の合法遷移グラフ・役職ルール。

出典: queue/reports/gunshi_report.yaml (worker_id: gunshi, task_id: subtask_681a,
review_verdict: 条件付き承認)。TRANSITIONS/UNCONFIRMED_TRANSITIONS/ROLE_RULES の各行は
すべて同ファイルの transition_graph / role_rules セクションの根拠(Casper依頼書§02の
確定5行、またはSTATUS_PROGRESS_WEIGHTの工程順)にひもづく。表を変更する場合は
その根拠(依頼書の確定 or 制作部の新確定)を伴うこと — 推測での追加は捏造にあたる(CON-1)。

このモジュールは status_meta.py の定数のみに依存する純関数モジュール。DBアクセスは
行わない(呼び出し側が ScoreUserRole を引いて actor_role / who_can_do_this を渡す)。

★遷移表の引きは呼び出し側で必ず schemas.canonicalize_task_status() 通過後の値を渡すこと。
status_meta._canonicalize は表示専用であり、ここでは使わない(CON-5 / F-2 / F-6)。
"""
from __future__ import annotations

import os
import re
import unicodedata
from collections import deque
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
# 1. 合法遷移グラフ (gunshi_report.yaml transition_graph.edges)
# ============================================================
TRANSITIONS: dict[str, frozenset[str]] = {
    "wt": frozenset({"mk", "omit"}),
    "mk": frozenset({"wip", "wt", "omit"}),
    "wip": frozenset({"qc", "mk", "wt", "omit"}),
    "qc": frozenset({"ap", "qc_fb", "client_ap", "wip", "omit"}),
    "qc_fb": frozenset({"wip", "qc", "omit"}),
    "ap": frozenset({"client_ap", "deliver", "omit"}),
    "client_ap": frozenset({"deliver", "omit", "qc_fb"}),
    "deliver": frozenset({"omit"}),
    "omit": frozenset(),
}

# ============================================================
# 2. §03「逆行・復帰」制作部確定待ち (gunshi_report.yaml unconfirmed_edges_policy)
#    既定は拒否だが、illegal_transition とは別のエラーコードで区別する。
#    client_ap→qc_fb は殿裁可⑥(役職オーナー表)により確定へ昇格したためここから除く。
# ============================================================
UNCONFIRMED_TRANSITIONS: dict[str, frozenset[str]] = {
    "ap": frozenset({"qc_fb", "qc"}),
    "client_ap": frozenset({"ap"}),
    "deliver": frozenset({"wt", "mk", "wip", "qc", "qc_fb", "ap", "client_ap"}),
    "omit": frozenset({"wt", "mk", "wip", "qc", "qc_fb", "ap", "client_ap", "deliver"}),
}

# ============================================================
# 3. 役職ルール (Casper依頼書§02 + 殿裁可⑥ 役職オーナー表(2026-07-29)確定分。
#    「アサイン(wt/mk→担当設定)」「日程変更」は status 遷移ではなく別ゲート = ここに含めない)
#    ★COND-1(critical): アーティスト帯の遷移(mk→wip/qc→wip/qc_fb→wip/wip→qc/qc_fb→qc/
#    ap→deliver/client_ap→deliver)は score_user_roles の実登録がほぼ無いため
#    絶対に role_required を課さない(ROLE_RULES に載せない=無制約)。owner フィールドで
#    「アーティストの作業」と表示するに留める(TRANSITION_OWNER参照)。
# ============================================================
ROLE_RANK: dict[str, int] = {"director": 40, "pm": 30, "lead": 20, "compositor": 10, "artist": 10}

ROLE_RULES: dict[tuple[str, str], str] = {
    ("wt", "mk"): "pm_or_above",
    ("wip", "mk"): "pm_or_above",
    ("qc", "qc_fb"): "director_or_above",
    ("client_ap", "qc_fb"): "pm_or_above",
    ("qc", "ap"): "director_or_above",
    ("qc", "client_ap"): "pm_or_above",
    ("ap", "client_ap"): "pm_or_above",
    ("wt", "omit"): "pm_or_above",
    ("mk", "omit"): "pm_or_above",
    ("wip", "omit"): "pm_or_above",
    ("qc", "omit"): "pm_or_above",
    ("qc_fb", "omit"): "pm_or_above",
    ("ap", "omit"): "pm_or_above",
    ("client_ap", "omit"): "pm_or_above",
    ("deliver", "omit"): "pm_or_above",
}

# ============================================================
# 3a. 役職オーナー表 (殿裁可⑥ 2026-07-29・制作部確定) — 権限とは切り離し
#    「誰の仕事か」を表示のみで伝える。role_required=null の辺でも
#    誰の作業かをUI/Casperが示せるようにする(F681c-3の半分の解消)。
# ============================================================
TRANSITION_OWNER: dict[tuple[str, str], str] = {
    ("wt", "mk"): "pm",
    ("wt", "omit"): "pm",
    ("mk", "wip"): "artist",
    ("mk", "wt"): "auto",
    ("mk", "omit"): "pm",
    ("wip", "qc"): "artist",
    ("wip", "mk"): "pm",
    ("wip", "wt"): "auto",
    ("wip", "omit"): "pm",
    ("qc", "ap"): "director",
    ("qc", "qc_fb"): "director",
    ("qc", "client_ap"): "pm",
    ("qc", "wip"): "artist",
    ("qc", "omit"): "pm",
    ("qc_fb", "wip"): "artist",
    ("qc_fb", "qc"): "artist",
    ("qc_fb", "omit"): "pm",
    ("ap", "client_ap"): "pm",
    ("ap", "deliver"): "artist",
    ("ap", "omit"): "pm",
    ("client_ap", "deliver"): "artist",
    ("client_ap", "omit"): "pm",
    ("client_ap", "qc_fb"): "pm",
    ("deliver", "omit"): "pm",
}

OWNER_LABEL: dict[str, str] = {
    "auto": "オート",
    "pm": "制作",
    "artist": "アーティスト",
    "director": "ディレクター",
}

# ============================================================
# 3b. 役職文字列の正規化 (殿裁可③ 2026-07-29)
#    表記ゆれ(全角/半角/大文字小文字/空白/記号)を吸収する。DBの実値確認を前提条件から
#    外し、未知値でも None を返して安全側(承認系のみ拒否)に倒す設計。
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
    """TASK_TRANSITION_ENFORCE の実効値。未設定/不正値は既定の 'warn' (CON-2)。"""
    mode = (os.getenv("TASK_TRANSITION_ENFORCE") or "warn").strip().lower()
    return mode if mode in ("off", "warn", "on") else "warn"


def roles_meeting_requirement(required_role: Optional[str]) -> list[str]:
    """'pm_or_above' 等の要求ランクを満たす role 文字列一覧(rank降順)。未知requiredは空。"""
    threshold = _ROLE_MIN_RANK.get(required_role or "")
    if threshold is None:
        return []
    return sorted((r for r, rank in ROLE_RANK.items() if rank >= threshold), key=lambda r: -ROLE_RANK[r])


def _rank_meets_requirement(actor_role: Optional[str], required: str) -> bool:
    """actor_role が required('xxx_or_above')ランクを満たすか。F-7: 未設定/未知roleは拒否側。
    F682a: 表記ゆれの吸収は normalize_role() に一本化(NFKC正規化+ROLE_ALIASES)。
    これが唯一のゲート判定経路である(殿裁可③)。"""
    if actor_role is None:
        return False  # F-7: 役職未設定は拒否側(親切エラーは呼び出し側で組む)
    canonical = normalize_role(actor_role)
    if canonical is None:
        return False  # F-7: 未知role値も拒否側(全員拒否ではなくエラー文言で誘導)
    rank = ROLE_RANK.get(canonical)
    if rank is None:
        return False
    return rank >= _ROLE_MIN_RANK[required]


def _role_permitted(from_status: str, to_status: str, actor_role: Optional[str]) -> bool:
    required = ROLE_RULES.get((from_status, to_status))
    if required is None:
        return True  # CON-1: 未確定領域(role_required=null)は無制約
    return _rank_meets_requirement(actor_role, required)


# ============================================================
# 4. assigned_to(担当者)変更ゲート (F681-3・取りこぼし防止)
#    Casper依頼書§02の1行目「アサイン wt/mk→担当設定 Lead以上」はstatus遷移ではないため
#    ROLE_RULES(status遷移検証)には含めない。status遷移検証と混同しない独立ゲートとして
#    ここに実装する(design原文「status遷移検証とは別ゲートとして実装すること(混同禁止)」)。
# ============================================================
ASSIGNEE_CHANGE_ROLE_REQUIRED = "lead_or_above"
ASSIGNEE_CHANGE_ROLE_SOURCE = (
    "Casper依頼書§02(2026-07-24, casper/2026-07-24/"
    "tasuku-19-suteetasu-teigi-sen-i-x-yakushoku-kakutei-noo-nega) "
    "1行目「アサイン(wt/mk→担当設定) Lead以上」"
)


def explain_assignee_change(actor_role: Optional[str]) -> Optional[dict]:
    """F681-3: assigned_to(担当者)変更が許可されるか。lead_or_above満たせばNone、
    満たさなければ role_not_permitted 形式のbody(explain_transitionの役職エラーと同形)を返す。
    who_can_do_this はDB問合せが要るため空配列(呼び出し側が充填すること、他エラーと同方針)。"""
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


def is_transition_allowed(from_status: Optional[str], to_status: Optional[str]) -> bool:
    """役職を問わず、グラフ上合法かどうかのみを判定する。
    from/to は呼び出し側で canonicalize_task_status 済みであること(CON-5)。
    same→same (no-op) は常に許可(§ self_transition)。
    from_status が未設定(None)の場合は 'mk' とみなす(F681-1: _task_row_to_dict の
    読取時既定'mk'と単一の真実源として一貫させる。status未設定タスクを
    最も助けが要る状態で不親切に拒否する事故を防ぐ)。"""
    if not to_status or to_status not in ACTIVE_STATUSES:
        return False
    from_status = from_status or "mk"
    if from_status == to_status:
        return True
    return to_status in TRANSITIONS.get(from_status, frozenset())


def get_allowed_transitions(status: Optional[str], *, actor_role: Optional[str] = None) -> list[dict]:
    """status から遷移可能な次状態一覧(確定グラフ=TRANSITIONSのみ。unconfirmedは含めない
    = F-9「そもそも選ばせない」の思想)。permitted_for_actor は actor_role を渡した文脈での
    参考値であり、一覧APIで使わない場合は呼び出し側でキーを間引くこと。
    status が未設定(None)の場合は 'mk' とみなす(F681-1、is_transition_allowedと同じ理由)。"""
    status = status or "mk"
    if status not in ACTIVE_STATUSES:
        return []
    # F682c-1(軍師QC指摘): FEはallowed-transitions応答のactor_role_recognized/recognized_rolesを
    # 見て「未知役職です」の親切文言を出す設計のため、role_not_permitted body だけでなく
    # ここ(各エントリ)にも同名2フィールドを載せる。
    actor_role_recognized = normalize_role(actor_role) is not None
    recognized_roles = sorted(ROLE_RANK.keys())
    result = []
    for to_status in sorted(TRANSITIONS.get(status, frozenset())):
        role_required = ROLE_RULES.get((status, to_status))
        owner = TRANSITION_OWNER.get((status, to_status), "auto")
        result.append({
            "status": to_status,
            "label": STATUS_LABEL.get(to_status, to_status),
            "color": STATUS_COLOR.get(to_status, "#BDBDBD"),
            "category": STATUS_CATEGORY.get(to_status),
            "role_required": role_required,
            "role_source": ROLE_RULE_SOURCE if role_required else "unconfirmed",
            "hint": f"{STATUS_LABEL.get(to_status, to_status)}へ進める",
            "owner": owner,
            "owner_label": OWNER_LABEL.get(owner, owner),
            "permitted_for_actor": _role_permitted(status, to_status, actor_role),
            "actor_role_recognized": actor_role_recognized,
            "recognized_roles": recognized_roles,
        })
    return result


def shortest_path(from_status: Optional[str], to_status: Optional[str]) -> list[str]:
    """確定グラフ(TRANSITIONS)上のBFS最短路。到達不能なら空配列。"""
    if not from_status or not to_status:
        return []
    if from_status == to_status:
        return [from_status] if from_status in ACTIVE_STATUSES else []
    if from_status not in TRANSITIONS:
        return []
    visited = {from_status}
    queue = deque([[from_status]])
    while queue:
        path = queue.popleft()
        node = path[-1]
        for nxt in sorted(TRANSITIONS.get(node, frozenset())):
            if nxt in visited:
                continue
            new_path = path + [nxt]
            if nxt == to_status:
                return new_path
            visited.add(nxt)
            queue.append(new_path)
    return []


def explain_transition(
    from_status: Optional[str], to_status: Optional[str], actor_role: Optional[str] = None
) -> Optional[dict]:
    """違反時にエラーbody(dict, http_statusキー込み)を返す。合法かつ役職も可ならNone。
    from/to は呼び出し側で canonicalize_task_status 済みであること(CON-5)。
    who_can_do_this は DB問合せが要るためこのモジュールでは空配列を返す
    (呼び出し側が roles_meeting_requirement(required_role) を使って ScoreUserRole を引き、
    role_not_permitted 応答の who_can_do_this を上書きすること)。"""
    if to_status is None or to_status not in ACTIVE_STATUSES:
        return {
            "http_status": 422,
            "error": "invalid_status",
            "detail": f"status='{to_status}' は無効。有効値: {sorted(ACTIVE_STATUSES)}",
            "allowed_next": get_allowed_transitions(from_status),
        }

    from_label = STATUS_LABEL.get(from_status, from_status) if from_status else "(未設定)"
    to_label = STATUS_LABEL.get(to_status, to_status)
    # F681-1: from_status未設定は'mk'とみなす(is_transition_allowed/get_allowed_transitionsと
    # 同じ単一の真実源)。表示用ラベル(from_label)のみ元のNoneを保持し「(未設定)」と出す。
    effective_from = from_status or "mk"

    if is_transition_allowed(from_status, to_status):
        if from_status == to_status:
            return None
        required = ROLE_RULES.get((effective_from, to_status))
        if required is None or _role_permitted(effective_from, to_status, actor_role):
            return None
        allowed_all = get_allowed_transitions(effective_from, actor_role=actor_role)
        return {
            "http_status": 403,
            "error": "role_not_permitted",
            "detail": (
                f"『{from_label}』から『{to_label}』への遷移は"
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
            "allowed_next_for_you": [e for e in allowed_all if e["permitted_for_actor"]],
            "allowed_next_all": [{k: v for k, v in e.items() if k != "permitted_for_actor"} for e in allowed_all],
            "who_can_do_this": [],
        }

    if to_status in UNCONFIRMED_TRANSITIONS.get(effective_from, frozenset()):
        return {
            "http_status": 409,
            "error": "transition_pending_confirmation",
            "detail": (
                f"『{from_label}』から『{to_label}』へ戻す遷移（承認の取消・復帰）は、"
                "現在 制作部にて確定待ちです（出典: Casper依頼書§03「逆行・復帰」）。"
                "確定までは実行できません。"
            ),
            "from": from_status,
            "to": to_status,
        }

    path = shortest_path(effective_from, to_status)
    return {
        "http_status": 409,
        "error": "illegal_transition",
        "detail": f"現在のステータス『{from_label}』から『{to_label}』へは直接進めません。",
        "reason": "この遷移は現在の合法遷移グラフ(status_transitions.TRANSITIONS)に定義されていません。",
        "from": from_status,
        "to": to_status,
        "allowed_next": get_allowed_transitions(from_status),
        "suggested_path": path,
        "suggested_path_hint": (
            " → ".join(STATUS_LABEL.get(s, s) for s in path) + " の順で進めてください。"
            if path else "合法な到達経路がありません。"
        ),
    }


def validate_transition(
    from_status: Optional[str], to_status: Optional[str], actor_role: Optional[str] = None
) -> Optional[dict]:
    """explain_transition の別名。crud/router層の検証呼び出しエントリポイント
    (gunshi_report.yaml BC-1 fix節がこの名で言及しているため用意)。"""
    return explain_transition(from_status, to_status, actor_role)
