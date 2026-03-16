import os
import logging
import json
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from .. import crud, models, schemas
from .llm import LLMClient
import pathlib

logger = logging.getLogger(__name__)

# Whisperモデルをグローバルにキャッシュ
_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        logger.info("Loading Whisper model 'tiny' into memory (minimal load)...")
        from faster_whisper import WhisperModel
        # cpu_threads=1 に制限して、メインプロセスのイベントループ用リソースを確実に残す
        _whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8", cpu_threads=1)
    return _whisper_model

class MeetingAnalyzer:
    def __init__(self, api_key: str):
        if not api_key:
            logger.warning("GOOGLE_API_KEY is not set for MeetingAnalyzer")
        self.llm_client = LLMClient(api_key=api_key)
        # Use flash for general cases, gemini-1.5-flash is highly stable
        self.llm_client.model_name = "gemini-1.5-flash" 

    async def analyze_meeting(self, meeting_id: int, audio_path: str):
        from ..database import SessionLocal
        db = SessionLocal()
        try:
            db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
            if not db_meeting:
                logger.error(f"Meeting {meeting_id} not found in DB")
                return

            logger.info(f"Starting analysis for meeting {meeting_id} using {audio_path}")
            
            # ステータスを「解析中」に更新
            crud.update_meeting(db, db_meeting, {"status": "processing"})
        finally:
            db.close()

        # 1. まず whisper で文字起こしを行う（バックエンドを止めないように非同期スレッドで実行）
        logger.info("Step 1: Transcribing audio with Whisper in background thread...")
        transcript_text = ""
        try:
            import asyncio
            # CPU処理でメインスレッド(FastAPI)がブロックされるのを防ぐため、別スレッドで実行する
            def run_whisper():
                whisper_model = get_whisper_model()
                # VAD (無音カット) を有効にして、無駄な処理を減らす
                segments_generator, info = whisper_model.transcribe(audio_path, beam_size=5, vad_filter=True, language="ja")
                # ジェネレータをリスト化して全セグメントを展開（ここで実際の推論が走る）
                return list(segments_generator), info

            segments, info = await asyncio.to_thread(run_whisper)
            logger.info(f"Detected language '{info.language}' with probability {info.language_probability}")
            
            transcript_texts = []
            for segment in segments:
                start_fmt = f"[{segment.start:.1f}s]"
                transcript_texts.append(f"{start_fmt} {segment.text.strip()}")
                
            transcript_text = "\n".join(transcript_texts)
            logger.info(f"Transcription completed. Total length: {len(transcript_text)} characters.")
            
            if not transcript_text:
                raise Exception("文字起こしの結果が空でした。")
                
        except Exception as e:
            logger.error(f"Whisper transcription failed: {e}")
            db = SessionLocal()
            try:
                db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
                if db_meeting:
                    crud.update_meeting(db, db_meeting, {"status": "failed"})
            finally:
                db.close()
            return

        # 2. Geminiでテキストベースの解析 (構造化と分類)
        logger.info("Step 2: Semantic analysis and extraction with Gemini...")
        self.llm_client.model_name = "gemini-2.0-flash"
        
        # Whisperの出力を元に、Geminiへプロンプトを投げる（音声ファイルは送らない）
        query = f"""
あなたは、会議の文字起こしテキストを解析し、「行動情報が欠落しない、実用的な議事録」を作成するAIです。
以下の【処理ステップ】に必ず従って、会議の内容を構造化してから抽出してください。

【対象の文字起こしデータ】
{transcript_text}

【処理ステップ】
1. テキストの整形: Whisperの文字起こしから、相槌（「あー」「うん」など）、無意味な繰り返し、言い直しを削除してスッキリとしたテキストにする。必要に応じて文脈から発言者を推測してA, B, Cと付与してください。
2. トピック分割と会話ターン分割: 話題（トピック）が変わるごとに区切り、各発言のターンごとに分割する。
3. 意味分類タグの付与: 各発言に対して、以下のいずれかの分類タグを先頭に必ず付ける。
   [議題] [提案] [決定] [タスク] [質問] [雑談]
4. 集約と抽出: 付与されたタグを元に、タスク（誰が何をするか）や決定事項を一つも漏らさずに抽出する。

出力文字数の制限によるエラーを防ぐため、必ず以下の指定された順序と区切り文字（===セクション名===）を用いて出力してください。JSONは使用しないでください。

===TRANSCRIPT===
（ステップ1〜3を適用した、トピックごとの全文文字起こしをここに記載してください。
例：
【トピック1：〇〇について】
A [議題]: 〇〇はどうしますか？
B [提案]: 〇〇が良いと思います。
C [質問]: 理由は？
A [決定]: では〇〇で進めましょう。
B [タスク]: 私が〇〇さんに連絡し、試作します。
）

===DECISIONS===
（===TRANSCRIPT=== の [決定] タグの内容から、決定事項を箇条書きで記載。ない場合は「なし」）

===TASKS===
（===TRANSCRIPT=== の [タスク] タグの内容から、誰が何をするかのタスク情報を具体的に箇条書きで記載。ない場合は「なし」）

===DISCUSSION_POINTS===
（===TRANSCRIPT=== の [議題] [提案] [質問] タグの内容から、主要な論点を箇条書きで記載。ない場合は「なし」）

===DEADLINES===
（期限や日程候補として言及されたスケジュールのリストを箇条書きで記載。ない場合は「なし」）
"""
        # アタッチメントとして音声はもう送らない。テキストで送ることでAPIリソースの枯渇（Resource Exhausted）を回避
        inputs = {
            "mode": "admin",
            "attachments": []
        }
        
        original_mime_type = self.llm_client.config.response_mime_type
        self.llm_client.config.response_mime_type = "text/plain"  # JSONからテキストに変更
        
        accumulated_response = ""
        analysis_success = False

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                accumulated_response = ""
                import asyncio
                logger.info(f"Gemini analysis attempt {attempt+1}/{max_attempts}...")
                async for chunk in self.llm_client.stream_chat(query, f"meeting_audio_{meeting_id}", inputs):
                    if chunk.get("event") == "message":
                        accumulated_response += chunk.get("answer", "")
                    elif chunk.get("event") == "error":
                         err_msg = str(chunk.get('message', ''))
                         if "429" in err_msg or "Too Many Requests" in err_msg or "RESOURCE_EXHAUSTED" in err_msg:
                             logger.warning("Rate limit hit (429).")
                             raise Exception(f"429: {err_msg}")
                         raise Exception(f"AI Error: {err_msg}")
                
                if accumulated_response.strip():
                    analysis_success = True
                    break

            except Exception as e:
                logger.warning(f"Attempt {attempt+1} failed: {e}")
                if attempt < max_attempts - 1:
                    is_429 = "429" in str(e) or "Too Many Requests" in str(e) or "RESOURCE_EXHAUSTED" in str(e)
                    wait_time = (30 * (attempt + 1)) if is_429 else 15
                    logger.info(f"Retrying in {wait_time}s due to errors...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.error("All attempts for Gemini analysis failed.")

        # 3. 結果の処理
        if analysis_success:
            try:
                self.llm_client.config.response_mime_type = original_mime_type
                
                content = accumulated_response.strip()
                
                analysis = {
                    "decisions": [],
                    "tasks": [],
                    "discussion_points": [],
                    "deadlines": [],
                    "transcript": ""
                }
                
                current_section = None
                transcript_lines = []
                
                # TRANSCRIPTが一番上に来るため、パースを対応させる
                for line in content.split('\n'):
                    line_stripped = line.strip()
                    if line_stripped.startswith('===TRANSCRIPT==='):
                        current_section = 'transcript'
                        continue
                    elif line_stripped.startswith('===DECISIONS==='):
                        current_section = 'decisions'
                        continue
                    elif line_stripped.startswith('===TASKS==='):
                        current_section = 'tasks'
                        continue
                    elif line_stripped.startswith('===DISCUSSION_POINTS==='):
                        current_section = 'discussion_points'
                        continue
                    elif line_stripped.startswith('===DEADLINES==='):
                        current_section = 'deadlines'
                        continue
                        
                    if current_section == 'transcript':
                        transcript_lines.append(line)
                    elif current_section and line_stripped:
                        # "- 項目" や "* 項目" の形式から抽出、またはそのまま追加
                        item = line_stripped.lstrip('-*• ').strip()
                        if item and item != 'なし':
                            analysis[current_section].append(item)
                            
                analysis['transcript'] = '\n'.join(transcript_lines).strip()
                
                updates = {
                    "transcript": analysis["transcript"],
                    "decisions": analysis["decisions"],
                    "tasks": analysis["tasks"],
                    "discussion_points": analysis["discussion_points"],
                    "deadlines": analysis["deadlines"],
                    "status": "completed"
                }
                
                db = SessionLocal()
                try:
                    db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
                    if db_meeting:
                        crud.update_meeting(db, db_meeting, updates)
                finally:
                    db.close()
                logger.info(f"Meeting {meeting_id} analysis completed successfully")
                return
            except Exception as e:
                logger.error(f"Failed to parse Gemini response: {e}")
                logger.debug(f"Response was: {accumulated_response}")

        # 失敗時のクリーンアップ
        self.llm_client.config.response_mime_type = original_mime_type
        db = SessionLocal()
        try:
            db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
            if db_meeting:
                crud.update_meeting(db, db_meeting, {"status": "failed"})
        finally:
            db.close()
        logger.error("Meeting analysis process finished with failure.")
