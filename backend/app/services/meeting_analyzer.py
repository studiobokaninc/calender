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

    async def analyze_meeting(self, db: Session, meeting_id: int, audio_path: str):
        db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
        if not db_meeting:
            logger.error(f"Meeting {meeting_id} not found in DB")
            return

        logger.info(f"Starting analysis for meeting {meeting_id} using {audio_path}")
        
        # 1. Geminiで直接解析 (文字起こし+要約)
        self.llm_client.model_name = "models/gemini-2.0-flash"
        
        # JSONが壊れないよう、内容を整理して出力させる
        query = """
あなたは、会議音声を詳細に分析し、内容をまとめる専門のAIアシスタントです。
提供された音声ファイルを分析し、以下の情報を正確に抽出してください。
回答は必ず日本語で、指定されたJSONフォーマットに従ってください。

1. **transcript**: 会議の主要な流れと重要な発言をまとめた詳細な要約（全編一語一句ではなく、内容が把握できる詳細な記述）
2. **decisions**: 会議で決定された事項のリスト
3. **tasks**: 会議から発生した課題やネクストアクションのリスト
4. **discussion_points**: 会議で議論された論点や主な話題のリスト
5. **deadlines**: 期限やマイルストーンとして言及された日程候補のリスト

【JSONフォーマット】
{
  "transcript": "...",
  "decisions": ["...", "..."],
  "tasks": ["...", "..."],
  "discussion_points": ["...", "..."],
  "deadlines": ["...", "..."]
}
"""
        inputs = {
            "mode": "admin",
            "attachments": [audio_path]
        }
        
        original_mime_type = self.llm_client.config.response_mime_type
        self.llm_client.config.response_mime_type = "application/json"
        
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
                         if "429" in err_msg:
                             logger.warning("Rate limit hit (429).")
                             raise Exception(f"429: {err_msg}")
                         raise Exception(f"AI Error: {err_msg}")
                
                if accumulated_response.strip():
                    analysis_success = True
                    break

            except Exception as e:
                logger.warning(f"Attempt {attempt+1} failed: {e}")
                if attempt < max_attempts - 1:
                    wait_time = 30 if "429" in str(e) else 10
                    logger.info(f"Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.error("All attempts for Gemini analysis failed.")

        # 2. 結果の処理
        if analysis_success:
            try:
                self.llm_client.config.response_mime_type = original_mime_type
                
                # JSONの抽出（Markdownタグの除去など）
                clean_json = accumulated_response.strip()
                if "```json" in clean_json:
                    clean_json = clean_json.split("```json")[1].split("```")[0].strip()
                elif "```" in clean_json:
                    clean_json = clean_json.split("```")[1].split("```")[0].strip()
                
                analysis = json.loads(clean_json)
                
                updates = {
                    "transcript": analysis.get("transcript", ""),
                    "decisions": analysis.get("decisions", []),
                    "tasks": analysis.get("tasks", []),
                    "discussion_points": analysis.get("discussion_points", []),
                    "deadlines": analysis.get("deadlines", [])
                }
                
                crud.update_meeting(db, db_meeting, updates)
                logger.info(f"Meeting {meeting_id} analysis completed successfully")
                return
            except Exception as e:
                logger.error(f"Failed to parse Gemini response: {e}")
                logger.debug(f"Response was: {accumulated_response}")

        # 失敗時のクリーンアップ
        self.llm_client.config.response_mime_type = original_mime_type
        logger.error("Meeting analysis process finished with failure.")
