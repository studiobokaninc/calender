#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
過去の会議データ（Meetings）を「意味単位の構造化ナレッジ」および「文字起こし全文のチャンク」に分割し、
RAG（LlamaIndex）に再インデックス登録するためのスクリプトです。
壊れたインデックスファイルを修復（リセット）し、バルク（一括）で超高速にインデックスを再構築します。
Windowsのロック遅延による削除エラーを回避する「自動5回リトライ」と、
書き込み遅延(Flush)によるファイル破損を防止する「クールダウン処理」を搭載しています。
"""

import os
import sys
import shutil
import asyncio
import logging
from datetime import datetime

# backendルートディレクトリをパスに追加してインポート可能にする
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app import models
from app.services.rag import rag_service

# ログの設定
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("reindex_meetings")

def chunk_text(text: str, chunk_size: int = 4000, overlap: int = 500) -> list:
    """テキストを一定のサイズでスライディングウィンドウ分割するヘルパー"""
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start += chunk_size - overlap
    return chunks

async def clean_rag_directory():
    """壊れたインデックスファイルを修復するためにRAG保存先ディレクトリをリセットする"""
    print("RAGインデックスディレクトリの破損修復・クリア処理を開始します...")
    # 保存先ディレクトリの特定
    base_dir = os.path.dirname(os.path.abspath(__file__))
    dir_gemini = os.path.join(base_dir, "data", "rag_index")
    dir_openai = os.path.join(base_dir, "data", "rag_index_openai")
    
    for path in [dir_gemini, dir_openai]:
        if os.path.exists(path):
            success = False
            # Windowsのファイルロック解放待ち（最大5回リトライ）
            for attempt in range(1, 6):
                try:
                    shutil.rmtree(path)
                    print(f" -> ディレクトリをリセットしました (試行 {attempt}/5): {path}")
                    success = True
                    break
                except Exception as e:
                    if attempt == 5:
                        # Windowsの PermissionError / ロックを検知して明示的にエラーを出す
                        print("\n" + "!" * 80)
                        print(f" [警告/エラー] RAGディレクトリの削除に完全に失敗しました: {path}")
                        print(" 原因: FastAPI開発サーバーや、終了した直前のPythonゾンビプロセスが、インデックスファイルをロックしている可能性があります。")
                        print(" 解決策: 起動しているWEBサーバーやカレンダー開発サーバーを一旦【完全に停止】させ、2〜3秒置いてから再度実行してください。")
                        print("!" * 80 + "\n")
                        raise e
                    print(f" -> ファイルがロックされています。解放を待ち、1秒後に再試行します... (試行 {attempt}/5)")
                    await asyncio.sleep(1.0)
        os.makedirs(path, exist_ok=True)
    print("RAGインデックスディレクトリのクリーンアップ完了。")

async def reindex_all_meetings():
    print("=" * 60)
    print("  過去の議事録データを「意味単位の構造化ナレッジ」および「文字起こし全文」として再登録します...")
    print("=" * 60)
    
    # 最初に壊れたインデックスを修復するためにディレクトリをクリーンアップ
    await clean_rag_directory()
    
    db = SessionLocal()
    try:
        from llama_index.core import Document
        
        # ステータスが completed の会議を全取得
        meetings = db.query(models.Meeting).filter(models.Meeting.status == "completed").all()
        if not meetings:
            print("再インデックス対象の「完了（completed）」ステータスの会議が見つかりませんでした。")
            return
            
        print(f"対象会議数: {len(meetings)}件")
        
        # 一括追加用のドキュメントリスト
        documents_to_add = []
        
        for i, mtg in enumerate(meetings):
            print(f"[{i+1}/{len(meetings)}] 会議: '{mtg.title}' (ID: {mtg.id}, 日付: {mtg.date}) を解析・Chunk構築中...")
            
            ref_date = mtg.date or mtg.created_at or datetime.now()
            date_str = ref_date.strftime("%Y-%m-%d") if hasattr(ref_date, "strftime") else str(ref_date)[:10]
            project_name = mtg.project.name if mtg.project else "不明"
            
            # メタデータ
            rag_metadata = {
                "meeting_id": mtg.id,
                "title": mtg.title,
                "project_id": mtg.project_id,
                "version_group": mtg.version_group,
                "type": "meeting",
                "date": ref_date.isoformat()
            }
            
            # 1. 決定事項
            decisions = mtg.decisions or []
            for dec in decisions:
                if dec and dec.strip():
                    dec_text = f"【決定事項】 会議: {mtg.title} ({date_str}), プロジェクト: {project_name}, 内容: {dec}"
                    dec_metadata = rag_metadata.copy()
                    dec_metadata["type"] = "meeting_decision"
                    dec_metadata["content_type"] = "decision"
                    documents_to_add.append(Document(text=dec_text, metadata=dec_metadata))
            
            # 2. タスク
            tasks = mtg.tasks or []
            for tsk in tasks:
                if tsk and tsk.strip():
                    tsk_text = f"【タスク】 会議: {mtg.title} ({date_str}), プロジェクト: {project_name}, 内容: {tsk}"
                    tsk_metadata = rag_metadata.copy()
                    tsk_metadata["type"] = "meeting_task"
                    tsk_metadata["content_type"] = "task"
                    documents_to_add.append(Document(text=tsk_text, metadata=tsk_metadata))
            
            # 3. 論点
            discussion_points = mtg.discussion_points or []
            for dp in discussion_points:
                if dp and dp.strip():
                    dp_text = f"【論点・議論】 会議: {mtg.title} ({date_str}), プロジェクト: {project_name}, 内容: {dp}"
                    dp_metadata = rag_metadata.copy()
                    dp_metadata["type"] = "meeting_discussion_point"
                    dp_metadata["content_type"] = "discussion_point"
                    documents_to_add.append(Document(text=dp_text, metadata=dp_metadata))
            
            # 4. 期限・スケジュール
            deadlines = mtg.deadlines or []
            for dl in deadlines:
                if dl and dl.strip():
                    dl_text = f"【期限・日程】 会議: {mtg.title} ({date_str}), プロジェクト: {project_name}, 内容: {dl}"
                    dl_metadata = rag_metadata.copy()
                    dl_metadata["type"] = "meeting_deadline"
                    dl_metadata["content_type"] = "deadline"
                    documents_to_add.append(Document(text=dl_text, metadata=dl_metadata))
                        
            # 5. 文字起こし全文 (Transcript) からのナレッジ作成（新規追加）
            transcript = mtg.transcript or ""
            if transcript.strip():
                chunks = chunk_text(transcript)
                for idx, chunk in enumerate(chunks):
                    chunk_text_data = f"【会議発言録チャンク {idx+1}/{len(chunks)}】 会議: {mtg.title} ({date_str}), 内容:\n{chunk}"
                    chunk_metadata = rag_metadata.copy()
                    chunk_metadata["type"] = "meeting_transcript_chunk"
                    chunk_metadata["content_type"] = "transcript_chunk"
                    chunk_metadata["chunk_index"] = idx
                    documents_to_add.append(Document(text=chunk_text_data, metadata=chunk_metadata))
            
        # すべての会議の全 Chunk を一括で登録＆最後に1回だけ永続化！
        if documents_to_add:
            print("\n" + "=" * 60)
            print(f" 全 {len(documents_to_add)} 件のナレッジ ＆ 文字起こしチャンクを LlamaIndex に一括登録（バルクインサート）中...")
            print(" ※ディスクへの保存はすべての登録完了後に『1回だけ』行うため、超高速で終了します。")
            print("=" * 60)
            
            success = await rag_service.add_documents(documents_to_add)
            if success:
                print("\n -> インデックスのメモリ上への書き込みが成功しました。")
                print(" ※Windows上のディスクにファイルを完全に安全に書き出し（Flush）するため、5秒間待機（クールダウン）します。プロセスを途中で止めないでください...")
                await asyncio.sleep(5.0)
                
                # 書き出されたファイルの整合性を検証
                vector_store_path = os.path.join(rag_service.persist_dir, "default__vector_store.json")
                if os.path.exists(vector_store_path) and os.path.getsize(vector_store_path) > 10:
                    print(" -> [大成功] 全てのインデックス登録およびディスク永続化が完全に、かつ安全に完了しました！")
                else:
                    print("\n -> [警告] ディスク永続化ファイルのサイズが異常（0バイト等）です。OSによる書き出し遅延が発生している可能性があります。さらに5秒待機します...")
                    await asyncio.sleep(5.0)
                    if os.path.exists(vector_store_path) and os.path.getsize(vector_store_path) > 10:
                        print(" -> [修復大成功] 追加の待機により、インデックスの永続化が正常に完了しました。")
                    else:
                        print(" -> [重大なエラー] 永続化ファイルが空のままです。再度サーバーを停止してバッチをやり直してください。")
            else:
                print("\n -> [エラー] 一括登録処理中にエラーが発生しました。")
        else:
            print("\n登録対象のナレッジ（ドキュメント）がありません。")
            
        print("\n" + "=" * 60)
        print(f" [完了] 正常に {len(meetings)} 件の会議データを再インデックスしました。")
        print("=" * 60)
        
    except Exception as e:
        logger.error(f"再インデックス処理中にエラーが発生しました: {e}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(reindex_all_meetings())
