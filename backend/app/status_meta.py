"""
Status metadata: single source of truth for status color/label/category.
Mirrors frontend/src/utils/taskStatus.ts — keep in sync when adding statuses.
"""
from typing import Optional

LEGACY_STATUS_MAP: dict[str, str] = {
    "todo": "mk",
    "in-progress": "wip",
    "in_progress": "wip",
    "review": "qc",
    "approved": "ap",
    "completed": "deliver",
    "delayed": "wip",
    "retake": "qc_fb",
    "cashing": "caching",
    "qc-fb": "qc_fb",
    "ap-fb": "ap_fb",
    "dir-wt": "dir_wt",
    "dir-ap": "dir_ap",
    "dir-fb": "dir_fb",
}

STATUS_COLOR: dict[str, str] = {
    "mk": "#1E88E5",
    "wt": "#E53935",
    "wip": "#FFA726",
    "modeling": "#FB8C00",
    "lookdev": "#F57C00",
    "caching": "#E65100",
    "rig": "#FFB300",
    "facial": "#FDD835",
    "qc_fb": "#E91E63",
    "ap_fb": "#D81B60",
    "dir_fb": "#C2185B",
    "v1qc": "#BA68C8",
    "qc": "#8E24AA",
    "dir_wt": "#26A69A",
    "ap": "#81C784",
    "dir_ap": "#4CAF50",
    "fix": "#2E7D32",
    "deliver": "#757575",
    "omit": "#E0E0E0",
}

STATUS_LABEL: dict[str, str] = {
    "mk": "MK",
    "wip": "WIP",
    "modeling": "Modeling",
    "lookdev": "LookDev",
    "caching": "Caching",
    "rig": "Rig",
    "facial": "Facial",
    "v1qc": "V1QC",
    "qc": "QC",
    "qc_fb": "QC_FB",
    "ap": "AP",
    "ap_fb": "AP_FB",
    "dir_wt": "Dir_WT",
    "dir_ap": "Dir_AP",
    "dir_fb": "Dir_FB",
    "fix": "FIX",
    "deliver": "Deliver",
    "omit": "Omit",
    "wt": "WT",
}

STATUS_CATEGORY: dict[str, str] = {
    "mk": "todo",
    "wip": "in_progress",
    "modeling": "in_progress",
    "lookdev": "in_progress",
    "caching": "in_progress",
    "rig": "in_progress",
    "facial": "in_progress",
    "v1qc": "review",
    "qc": "review",
    "qc_fb": "review",
    "ap": "review",
    "ap_fb": "review",
    "dir_wt": "review",
    "dir_ap": "review",
    "dir_fb": "review",
    "fix": "review",
    "deliver": "completed",
    "omit": "held",
    "wt": "held",
}


def _canonicalize(status: Optional[str]) -> Optional[str]:
    if not status:
        return None
    s = str(status).strip().lower()
    return LEGACY_STATUS_MAP.get(s, s)


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


STATUS_META_LIST = [
    {
        "value": k,
        "label": STATUS_LABEL.get(k, k),
        "color": STATUS_COLOR.get(k, "#BDBDBD"),
        "category": STATUS_CATEGORY.get(k),
    }
    for k in STATUS_COLOR
]
