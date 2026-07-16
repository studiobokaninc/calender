"""Status metadata: single source of truth for status color/label/category.
Mirrors frontend/src/utils/taskStatus.ts — keep in sync when adding statuses.

task_status_redesign_v2: 有効ステータスは9種。
    wt / mk / wip / qc / qc_fb / ap / client_ap / deliver / omit
旧19体系の値は LEGACY_STATUS_MAP で新9値へ畳み込む（表示・集計とも）。
"""
from typing import Optional

# --- 旧値 → 新9値 への畳み込み（表記揺れ + 旧19体系の集約） ---
LEGACY_STATUS_MAP: dict[str, str] = {
    # 旧7体系 / API 表記
    "todo": "mk",
    "in-progress": "wip",
    "in_progress": "wip",
    "review": "qc",
    "approved": "ap",
    "completed": "deliver",
    "delayed": "wip",
    "retake": "qc_fb",
    "cashing": "caching",
    # ハイフン表記揺れ
    "qc-fb": "qc_fb",
    "ap-fb": "qc_fb",
    "dir-wt": "qc",
    "dir-ap": "ap",
    "dir-fb": "qc_fb",
    "client-ap": "client_ap",
    # 旧19体系の工程別 → wip
    "modeling": "wip",
    "lookdev": "wip",
    "caching": "wip",
    "rig": "wip",
    "facial": "wip",
    # 旧19体系のチェック/FB系 → 新体系へ集約
    "v1qc": "qc",
    "dir_wt": "qc",
    "ap_fb": "qc_fb",
    "dir_fb": "qc_fb",
    "fix": "qc_fb",
    "dir_ap": "ap",
}

# --- 有効9ステータスのメタ (§7) ---
STATUS_COLOR: dict[str, str] = {
    "wt": "#BDBDBD",         # グレー (待機/初期)
    "mk": "#2196F3",         # ブルー (未着手)
    "wip": "#FF9800",        # オレンジ (進行中)
    "qc": "#9C27B0",         # パープル (社内チェック)
    "qc_fb": "#E91E63",      # ピンク (FB修正)
    "ap": "#4CAF50",         # グリーン (社内承認済)
    "client_ap": "#2E7D32",  # 濃グリーン (クライアント承認済)
    "deliver": "#757575",    # ダークグレー (納品完了)
    "omit": "#E0E0E0",       # 薄グレー / 取消線 (対象外)
}

STATUS_LABEL: dict[str, str] = {
    "wt": "WT",
    "mk": "MK",
    "wip": "WIP",
    "qc": "QC",
    "qc_fb": "QC_FB",
    "ap": "AP",
    "client_ap": "CLIENT_AP",
    "deliver": "DELIVER",
    "omit": "OMIT",
}

# --- ロジック用カテゴリ (§2 の5分類) ---
STATUS_CATEGORY: dict[str, str] = {
    "wt": "held",
    "mk": "todo",
    "wip": "in_progress",
    "qc": "review",
    "qc_fb": "review",
    "ap": "completed",
    "client_ap": "completed",
    "deliver": "completed",
    "omit": "held",
}

# --- カテゴリ集合（集計・判定ロジックの単一の真実） ---
COMPLETED_STATUSES = frozenset({"ap", "client_ap", "deliver"})
REVIEW_STATUSES = frozenset({"qc", "qc_fb"})
IN_PROGRESS_STATUSES = frozenset({"wip"})
TODO_STATUSES = frozenset({"mk"})
HELD_STATUSES = frozenset({"wt", "omit"})  # 遅延・オンスケ統計から除外
ACTIVE_STATUSES = frozenset(STATUS_COLOR.keys())  # 有効9ステータス

# --- プロジェクト全体進捗のウェイト (§4) / omit は除外(None) ---
STATUS_PROGRESS_WEIGHT: dict[str, Optional[float]] = {
    "ap": 1.0,
    "client_ap": 1.0,
    "deliver": 1.0,
    "qc": 0.7,
    "wip": 0.4,
    "qc_fb": 0.4,
    "mk": 0.0,
    "wt": 0.0,
    "omit": None,
}


def _canonicalize(status: Optional[str]) -> Optional[str]:
    if not status:
        return None
    s = str(status).strip().lower()
    if not s:
        return None
    # 二段畳み込み（例: 'dir-fb' → 'dir_fb' 相当が無くても直接命中する）
    mapped = LEGACY_STATUS_MAP.get(s, s)
    return LEGACY_STATUS_MAP.get(mapped, mapped)


def get_status_color(status: Optional[str]) -> str:
    canonical = _canonicalize(status)
    if not canonical:
        return "#BDBDBD"
    return STATUS_COLOR.get(canonical, "#BDBDBD")


def get_status_label(status: Optional[str]) -> str:
    canonical = _canonicalize(status)
    if not canonical:
        return "未定"
    return STATUS_LABEL.get(canonical, str(status))


def get_status_category(status: Optional[str]) -> Optional[str]:
    canonical = _canonicalize(status)
    if not canonical:
        return None
    return STATUS_CATEGORY.get(canonical)


def get_status_progress_weight(status: Optional[str]) -> Optional[float]:
    canonical = _canonicalize(status)
    if not canonical:
        return None
    return STATUS_PROGRESS_WEIGHT.get(canonical)


def is_completed_status(status: Optional[str]) -> bool:
    return _canonicalize(status) in COMPLETED_STATUSES


STATUS_META_LIST = [
    {
        "value": k,
        "label": STATUS_LABEL.get(k, k),
        "color": STATUS_COLOR.get(k, "#BDBDBD"),
        "category": STATUS_CATEGORY.get(k),
    }
    for k in STATUS_COLOR
]
