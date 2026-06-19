"""
AIスマート取り込み (cmd_529 / MVP) — 抽出専用エンドポイント。

設計書正本: docs/ai_smart_import_design_2026-06-18.md

役割:
  テキストを受け取り、Claude API で「Task / Event / unknown」の種別判定 +
  フィールド抽出を行い、構造化JSON を返す。
  ★ 本EPは抽出のみ。DB へ一切保存しない（保存は FE 確認後に既存
     POST /api/tasks ・ /api/events で行う）。

安全方針:
  - ANTHROPIC_API_KEY は環境変数からのみ取得（実値はコード/コメントに残さない）。
  - 入力テキストは max_chars で上限を設けて保護。
  - anthropic SDK はハンドラ内で遅延 import（未導入環境でもアプリ起動を壊さない）。
  - 認証は通常ログインの get_current_user を利用（通常認証経路は変更しない）。
"""
import os
import json
import logging
from typing import Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import models
from ..security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-import", tags=["ai_import"])

# 既定モデルは精度優先で Opus 4.8。量産時は環境変数 AI_IMPORT_MODEL で
# claude-sonnet-4-6 等へ切替可能（claude-api スキル 2026-06 準拠の正式モデルID）。
DEFAULT_MODEL = "claude-opus-4-8"
MAX_CHARS_HARD_LIMIT = 8000  # max_chars 指定がこれを超えても強制的に抑える上限

# structured outputs (output_config.format) 用の JSON Schema。
# additionalProperties:false / enum / null 型のみ使用（数値・文字長制約は非対応のため使わない）。
EXTRACTION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["kind", "confidence", "notes", "payload"],
    "properties": {
        "kind": {"type": "string", "enum": ["task", "event", "unknown"]},
        "confidence": {"type": "number"},
        "notes": {"type": "string"},
        "payload": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "title_or_name",
                "description",
                "event_type",
                "task_priority",
                "start",
                "end_or_due",
                "location",
            ],
            "properties": {
                "title_or_name": {"type": ["string", "null"]},
                "description": {"type": ["string", "null"]},
                "event_type": {
                    "type": ["string", "null"],
                    "enum": ["Meeting", "Deadline", "Milestone", "Workshop", "Generic", "Task", None],
                },
                "task_priority": {
                    "type": ["string", "null"],
                    "enum": ["HIGH", "MEDIUM", "LOW", None],
                },
                "start": {"type": ["string", "null"]},
                "end_or_due": {"type": ["string", "null"]},
                "location": {"type": ["string", "null"]},
            },
        },
    },
}

SYSTEM_PROMPT = (
    "あなたはスケジュール管理アプリの取り込みアシスタントです。"
    "ユーザーが貼り付けた自由形式テキストを読み、それが『タスク(task)』か『予定(event)』か"
    "『判別不能(unknown)』かを判定し、該当フィールドを抽出します。"
    "規則: (1)不明な項目は必ず null にし、推測で埋めない。"
    "(2)event_type は Meeting/Deadline/Milestone/Workshop/Generic/Task のいずれか、"
    "task_priority は HIGH/MEDIUM/LOW のいずれか、判断できなければ null。"
    "(3)title_or_name は最も中心的な件名/タスク名。"
    "(4)日付・時刻は分かる範囲で start / end_or_due に ISO8601 風文字列で入れる(不明なら null)。"
    "(5)confidence は判定の確信度を 0〜1 で返す。"
    "(6)notes に判断根拠や曖昧な点を簡潔に記す。"
)


class AIImportRequest(BaseModel):
    text: str = Field(..., description="取り込み対象の自由形式テキスト")
    max_chars: int = Field(default=2000, description="入力テキストの文字数上限（保護用）")


@router.post("/parse")
def parse_import_text(
    body: AIImportRequest,
    current_user: models.User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    テキストから種別判定+フィールド抽出を行い、構造化JSON を返す（保存しない）。
    """
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text は必須です。")

    # 入力上限で保護（大量テキスト対策）。max_chars はハード上限でさらに抑制。
    limit = min(max(body.max_chars, 1), MAX_CHARS_HARD_LIMIT)
    clipped = text[:limit]

    # anthropic SDK は遅延 import（未導入環境でもアプリ起動・他EPを壊さない）
    try:
        import anthropic  # type: ignore
    except Exception:
        logger.error("anthropic SDK 未導入: pip install anthropic が必要です。")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI取り込み機能は未設定です（anthropic SDK が導入されていません）。",
        )

    if not os.getenv("ANTHROPIC_API_KEY"):
        logger.error("ANTHROPIC_API_KEY 未設定。")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI取り込み機能は未設定です（APIキー未設定）。",
        )

    model = os.getenv("AI_IMPORT_MODEL", DEFAULT_MODEL)

    try:
        client = anthropic.Anthropic()  # APIキーは環境変数から自動解決
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": clipped}],
            output_config={
                "effort": "low",  # 分類+抽出は軽量タスク。レイテンシ優先。
                "format": {"type": "json_schema", "schema": EXTRACTION_SCHEMA},
            },
        )
    except Exception as e:  # noqa: BLE001 — 外部API障害をユーザー向けに変換
        logger.error("AI取り込み呼び出し失敗: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI取り込みの実行に失敗しました。時間をおいて再試行してください。",
        )

    # output_config.format により最初の text ブロックは スキーマ準拠 JSON
    raw: Optional[str] = None
    for block in response.content:
        if getattr(block, "type", None) == "text":
            raw = block.text
            break
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI応答の解析に失敗しました（空応答）。",
        )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("AI応答のJSONパース失敗。")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI応答の解析に失敗しました（JSON不正）。",
        )

    # 抽出結果のみ返す。保存は行わない。
    return data
