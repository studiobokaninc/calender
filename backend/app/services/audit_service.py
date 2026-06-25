"""構造化イベント記録ユーティリティ。記録失敗が本処理を巻き込まぬよう分離。"""
import json
import logging
from typing import Optional
from sqlalchemy.orm import Session
from ..models import AuditLog

logger = logging.getLogger(__name__)


def record_event(
    db: Session,
    action: str,
    actor_uid: Optional[int] = None,
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    detail: Optional[dict] = None,
    level: str = "info",
) -> None:
    """構造化イベントをaudit_logsに記録する。
    記録失敗は例外を呑み込みログに残すのみ — 本処理をロールバックしない。
    detail はメタ情報のみ (フィールド名・ステータス値等)。PII/本文/トークン禁止。
    """
    try:
        entry = AuditLog(
            actor_uid=actor_uid,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=json.dumps(detail, ensure_ascii=False) if detail else None,
            level=level,
        )
        db.add(entry)
        db.commit()
    except Exception as exc:
        logger.warning("audit record failed (non-fatal): %s", exc)
