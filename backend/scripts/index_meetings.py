"""
index_meetings.py — 解析済み議事録を現在のRAGインデックスに一括投入する

使い方:
  cd /mnt/e/calender/backend
  python scripts/index_meetings.py [--dry-run] [--meeting-id N]

必須 env 変数 (backend/.env から自動読込):
  ANTHROPIC_API_KEY  (Claude使用時) → data/rag_index_anthropic に索引
  OPENAI_API_KEY     (OpenAI使用時) → data/rag_index_openai に索引
  GOOGLE_API_KEY     (Gemini使用時) → data/rag_index に索引

注意:
  - 本スクリプトはプロバイダ切替後の再索引を想定。
    既存インデックス内に重複ノードが生じる可能性があるが、
    搭索精度には影響しない（同内容なのでランキングに影響なし）。
  - 本番 DB は読み取り専用。RAG インデックス（ファイル）のみ書き換える。
  - Claude(Anthropic)移行後に実行すると bge-m3 embeddings で再索引される。
    旧 Gemini/OpenAI インデックスは別 persist_dir のため影響なし。
"""

import sys
import os
import asyncio
import argparse
from pathlib import Path

# backend/ を sys.path に追加して app パッケージを解決
backend_dir = Path(__file__).resolve().parent.parent  # backend/scripts/ → backend/
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(dotenv_path=backend_dir / ".env", override=True)

from app.database import SessionLocal
from app import models
from app.services.rag import rag_service
from llama_index.core import Document


def build_documents_from_meeting(meeting: models.Meeting) -> list:
    """meeting_analyzer._add_meeting_data_to_rag と同じフォーマットでDocumentリストを生成"""
    ref_date = meeting.date
    if ref_date is None:
        from datetime import datetime
        ref_date = meeting.created_at or datetime.now()

    date_str = ref_date.strftime("%Y-%m-%d")
    project_name = meeting.project.name if meeting.project else "不明"

    rag_metadata = {
        "meeting_id": meeting.id,
        "title": meeting.title,
        "project_id": meeting.project_id,
        "version_group": meeting.version_group,
        "type": "meeting",
        "date": ref_date.isoformat(),
    }

    docs = []

    # 1. transcript チャンク
    transcript = meeting.transcript or ""
    if transcript.strip():
        chunk_size = 4000
        overlap = 500
        chunks = []
        start = 0
        while start < len(transcript):
            end = start + chunk_size
            chunks.append(transcript[start:end])
            if end >= len(transcript):
                break
            start += chunk_size - overlap

        for idx, chunk in enumerate(chunks):
            meta = rag_metadata.copy()
            meta["type"] = "meeting_transcript_chunk"
            meta["content_type"] = "transcript_chunk"
            meta["chunk_index"] = idx
            text = (
                f"【会議発言録チャンク {idx+1}/{len(chunks)}】"
                f" 会議: {meeting.title} ({date_str}), 内容:\n{chunk}"
            )
            docs.append(Document(text=text, metadata=meta))

    # 2. decisions
    for dec in (meeting.decisions or []):
        if dec and dec.strip():
            meta = rag_metadata.copy()
            meta["type"] = "meeting_decision"
            meta["content_type"] = "decision"
            text = (
                f"【決定事項】 会議: {meeting.title} ({date_str}),"
                f" プロジェクト: {project_name}, 内容: {dec}"
            )
            docs.append(Document(text=text, metadata=meta))

    # 3. tasks
    for tsk in (meeting.tasks or []):
        if tsk and tsk.strip():
            meta = rag_metadata.copy()
            meta["type"] = "meeting_task"
            meta["content_type"] = "task"
            text = (
                f"【タスク】 会議: {meeting.title} ({date_str}),"
                f" プロジェクト: {project_name}, 内容: {tsk}"
            )
            docs.append(Document(text=text, metadata=meta))

    # 4. discussion_points
    for dp in (meeting.discussion_points or []):
        if dp and dp.strip():
            meta = rag_metadata.copy()
            meta["type"] = "meeting_discussion_point"
            meta["content_type"] = "discussion_point"
            text = (
                f"【論点・議論】 会議: {meeting.title} ({date_str}),"
                f" プロジェクト: {project_name}, 内容: {dp}"
            )
            docs.append(Document(text=text, metadata=meta))

    # 5. deadlines
    for dl in (meeting.deadlines or []):
        if dl and dl.strip():
            meta = rag_metadata.copy()
            meta["type"] = "meeting_deadline"
            meta["content_type"] = "deadline"
            text = (
                f"【期限・日程】 会議: {meeting.title} ({date_str}),"
                f" プロジェクト: {project_name}, 内容: {dl}"
            )
            docs.append(Document(text=text, metadata=meta))

    return docs


async def run(dry_run: bool, target_meeting_id: int | None):
    db = SessionLocal()
    try:
        query = db.query(models.Meeting).filter(models.Meeting.status == "completed")
        if target_meeting_id is not None:
            query = query.filter(models.Meeting.id == target_meeting_id)

        # project relationship を eager load
        from sqlalchemy.orm import joinedload
        query = query.options(joinedload(models.Meeting.project))
        meetings = query.order_by(models.Meeting.date).all()

        print(f"\n対象会議数: {len(meetings)} 件 (status=completed)")
        if not meetings:
            print("索引対象の会議がありません。")
            return

        if dry_run:
            print("\n[DRY RUN] 以下を索引予定 (実際には書き込まない):")
            for m in meetings:
                docs = build_documents_from_meeting(m)
                print(f"  - [{m.id}] {m.title} ({m.date}) → {len(docs)} documents")
            return

        # rag_service を初期化（どのプロバイダか確認）
        await rag_service._ensure_initialized()
        print(f"\nプロバイダ: {rag_service.provider}")
        print(f"persist_dir: {rag_service.persist_dir}\n")

        total_docs = 0
        for i, meeting in enumerate(meetings, 1):
            docs = build_documents_from_meeting(meeting)
            if not docs:
                print(f"[{i}/{len(meetings)}] SKIP [{meeting.id}] {meeting.title} — ドキュメント生成なし (transcript/decisions が空)")
                continue

            print(f"[{i}/{len(meetings)}] 索引中 [{meeting.id}] {meeting.title} ({meeting.date}) — {len(docs)} docs", end=" ... ", flush=True)
            ok = await rag_service.add_documents(docs)
            if ok:
                total_docs += len(docs)
                print("OK")
            else:
                print("FAILED")

        print(f"\n完了: {total_docs} documents を {rag_service.persist_dir} に索引")
        print("\n確認手順 (殿サーバ):")
        print("  1. /api/ask に POST { \"question\": \"直近の会議の決定事項は?\" }")
        print("  2. レスポンスの sources に会議名が含まれることを確認")

    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="解析済み議事録をRAGインデックスに一括投入")
    parser.add_argument("--dry-run", action="store_true", help="実際に書き込まず対象一覧を表示")
    parser.add_argument("--meeting-id", type=int, default=None, help="特定の会議IDのみ索引")
    args = parser.parse_args()

    asyncio.run(run(dry_run=args.dry_run, target_meeting_id=args.meeting_id))


if __name__ == "__main__":
    main()
