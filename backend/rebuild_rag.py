import asyncio
import os
import sys

# パスを追加
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.database import SessionLocal
from app.models import Meeting
from app.services.rag import rag_service
from llama_index.core import Document

import shutil

async def rebuild_rag():
    print("既存のRAGインデックスをクリアしています...")
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    for d in ["rag_index_openai", "rag_index_gemini", "rag_index_anthropic"]:
        target_dir = os.path.join(data_dir, d)
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir, ignore_errors=True)
            print(f" -> {target_dir} を削除しました。")
            
    print("RAGサービスを初期化しています...")
    await rag_service._ensure_initialized()
    
    db = SessionLocal()
    try:
        # 全会議を取得
        meetings = db.query(Meeting).all()
        print(f"全 {len(meetings)} 件の会議データをRAGに登録します...")
        
        for mtg in meetings:
            print(f"会議ID: {mtg.id} ({mtg.title}) の登録処理...")
            
            ref_date = mtg.date or mtg.created_at
            date_str = ref_date.strftime("%Y-%m-%d") if ref_date else ""
            project_name = mtg.project.name if mtg.project else "不明"
            
            rag_metadata = {
                "meeting_id": mtg.id,
                "title": mtg.title,
                "project_id": mtg.project_id,
                "version_group": mtg.version_group,
                "type": "meeting",
                "date": ref_date.isoformat() if ref_date else ""
            }
            
            docs_to_add = []
            
            # 1. 文字起こしの登録
            transcript = mtg.transcript or ""
            if transcript.strip():
                chunks = []
                start = 0
                chunk_size = 1000
                overlap = 200
                while start < len(transcript):
                    end = start + chunk_size
                    chunks.append(transcript[start:end])
                    if end >= len(transcript):
                        break
                    start += chunk_size - overlap
                    
                for idx, chunk in enumerate(chunks):
                    chunk_text_data = f"【会議発言録チャンク {idx+1}/{len(chunks)}】 会議: {mtg.title} ({date_str}), 内容:\n{chunk}"
                    chunk_metadata = rag_metadata.copy()
                    chunk_metadata["type"] = "meeting_transcript_chunk"
                    chunk_metadata["content_type"] = "transcript_chunk"
                    chunk_metadata["chunk_index"] = idx
                    docs_to_add.append(Document(text=chunk_text_data, metadata=chunk_metadata))
            
            # 2. 決定事項の登録
            decisions = mtg.decisions or []
            for dec in decisions:
                if dec and dec.strip():
                    dec_text = f"【決定事項】 会議: {mtg.title} ({date_str}), プロジェクト: {project_name}, 内容: {dec}"
                    dec_metadata = rag_metadata.copy()
                    dec_metadata["type"] = "meeting_decision"
                    dec_metadata["content_type"] = "decision"
                    docs_to_add.append(Document(text=dec_text, metadata=dec_metadata))

            # 3. タスクの登録
            tasks = mtg.tasks or []
            for tsk in tasks:
                if tsk and tsk.strip():
                    tsk_text = f"【タスク】 会議: {mtg.title} ({date_str}), プロジェクト: {project_name}, 内容: {tsk}"
                    tsk_metadata = rag_metadata.copy()
                    tsk_metadata["type"] = "meeting_task"
                    tsk_metadata["content_type"] = "task"
                    docs_to_add.append(Document(text=tsk_text, metadata=tsk_metadata))

            # 4. 論点の登録
            points = mtg.discussion_points or []
            for dp in points:
                if dp and dp.strip():
                    dp_text = f"【論点・議論】 会議: {mtg.title} ({date_str}), プロジェクト: {project_name}, 内容: {dp}"
                    dp_metadata = rag_metadata.copy()
                    dp_metadata["type"] = "meeting_discussion_point"
                    dp_metadata["content_type"] = "discussion_point"
                    docs_to_add.append(Document(text=dp_text, metadata=dp_metadata))

            # 5. 期限の登録
            deadlines = mtg.deadlines or []
            for dl in deadlines:
                if dl and dl.strip():
                    dl_text = f"【期限・日程】 会議: {mtg.title} ({date_str}), プロジェクト: {project_name}, 内容: {dl}"
                    dl_metadata = rag_metadata.copy()
                    dl_metadata["type"] = "meeting_deadline"
                    dl_metadata["content_type"] = "deadline"
                    docs_to_add.append(Document(text=dl_text, metadata=dl_metadata))
                    
            if docs_to_add:
                print(f" -> {len(docs_to_add)} 件のナレッジをまとめてインデックスに追加中...")
                await rag_service.add_documents(docs_to_add)
                print(f" -> 登録完了！")
            else:
                print(f" -> 登録するナレッジがありませんでした。")
                    
        print("すべての文字起こしデータのRAG登録が完了しました。")
        
    except Exception as e:
        print(f"エラーが発生しました: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(rebuild_rag())
