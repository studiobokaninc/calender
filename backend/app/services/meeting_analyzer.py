import os
import logging
import json
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from .. import crud, models, schemas
from .llm import LLMClient
import pathlib

logger = logging.getLogger(__name__)

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

        # Gemini 1.5 prompt for meeting summary
        # we ask for JSON explicitly
        query = """
あなたは、会議音声を詳細に分析し、内容をまとめる専門のAIアシスタントです。
提供された音声ファイルを文字起こしし、以下の情報を正確に抽出してください。
回答は必ず日本語で、指定されたJSONフォーマットに従ってください。

1. **transcript**: 会議の要約または重要な発言部分の文字起こし（文字数制限のため、全編ではなく重要部分を中心にまとめてください）
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
        
        # Enable JSON response mode if supported by LLMClient config
        original_mime_type = self.llm_client.config.response_mime_type
        self.llm_client.config.response_mime_type = "application/json"
        
        accumulated_response = ""
        try:
            async for chunk in self.llm_client.stream_chat(query, f"meeting_{meeting_id}", inputs):
                if chunk.get("event") == "message":
                    accumulated_response += chunk.get("answer", "")
                elif chunk.get("event") == "error":
                    logger.error(f"LLM Error during analysis: {chunk.get('message')}")
                    raise Exception(f"LLM Error: {chunk.get('message')}")
            
            if not accumulated_response.strip():
                logger.error("LLM returned an empty response for meeting analysis")
                raise Exception("LLM returned an empty response")

            logger.info(f"Received response from LLM (length: {len(accumulated_response)})")
            
            # Restore original config
            self.llm_client.config.response_mime_type = original_mime_type
            
            # Parse JSON
            # Sometimes Gemini returns JSON inside markdown code blocks, although application/json should avoid that.
            clean_json = accumulated_response.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json.split("```json", 1)[1]
            if "```" in clean_json:
                clean_json = clean_json.split("```", 1)[0]
            clean_json = clean_json.strip()

            analysis = json.loads(clean_json)
            
            # Apply updates via CRUD
            updates = {
                "transcript": analysis.get("transcript", ""),
                "decisions": analysis.get("decisions", []),
                "tasks": analysis.get("tasks", []),
                "discussion_points": analysis.get("discussion_points", []),
                "deadlines": analysis.get("deadlines", [])
            }
            
            crud.update_meeting(db, db_meeting, updates)
            logger.info(f"Meeting {meeting_id} analysis completed successfully")
            
        except Exception as e:
            logger.error(f"Meeting analysis failed: {str(e)}")
            logger.debug(f"Response snippet: {accumulated_response[:200]}")
            # Restore original config on error
            self.llm_client.config.response_mime_type = original_mime_type
            raise e
