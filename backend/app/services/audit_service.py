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


# --- 旧ステータス値の変換記録 (cmd_731 五) ---
STATUS_CONVERTED_ACTION = "task.status_converted"
_SENT_MAX_LEN = 40  # 送られた値の記録上限。地図に載る語彙のみ記録するので通常は数文字


def record_status_conversion(
    db: Session,
    sent: Optional[str],
    *,
    task_id: Optional[int],
    actor_uid: Optional[int],
    source: str,
) -> bool:
    """旧い/別名の status が畳み込まれた時だけ監査行を一つ立てる。立てたら True。
    呼び出しは本処理の commit の後に行うこと(記録の失敗を本処理へ波及させぬ為)。
    detail(JSON): sent=送られた値 / stored=刻まれた値 / maps=通った畳み込み地図 / source=経路。
    「どのタスク」=target_id、「誰が」=actor_uid。
    畳み込み地図に載った語彙(固定の語)に限り記録する=自由入力の本文・PII・トークンは入らぬ。
    ここから例外は出さぬ(record_event 同様に握り潰す)。
    """
    try:
        if sent is None:
            return False
        from .. import schemas
        stored, maps = schemas.canonicalize_task_status_traced(sent)
        if stored is None or not maps:
            return False
        record_event(
            db,
            STATUS_CONVERTED_ACTION,
            actor_uid=actor_uid,
            target_type="task",
            target_id=task_id,
            detail={
                "sent": str(sent).strip()[:_SENT_MAX_LEN],
                "stored": stored,
                "maps": maps,
                "source": source,
            },
        )
        if not db.is_active:
            # 記録の commit が失敗するとセッションが inactive で残る。後続処理を道連れにせぬよう戻す。
            db.rollback()
        return True
    except Exception as exc:
        logger.warning("status conversion audit failed (non-fatal): %s", exc)
        try:
            if not db.is_active:
                db.rollback()
        except Exception:
            pass
        return False
