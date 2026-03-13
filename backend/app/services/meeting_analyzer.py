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
        
        # ステータスを「解析中」に更新
        crud.update_meeting(db, db_meeting, {"status": "processing"})
        db.commit()

        # 1. Geminiで直接解析 (文字起こし+要約)
        self.llm_client.model_name = "models/gemini-2.0-flash"
        
        # JSONが壊れないよう、内容を整理して出力させる
        query = """
あなたは、会議音声を詳細に分析し、内容を書き起こす専門のAIアシスタントです。
提供された音声ファイルを分析し、以下の情報を正確に抽出してください。
出力文字数の上限によるエラーを防ぐため、必ず以下の指定された順序と区切り文字（===セクション名===）を用いて出力してください。JSONは使用しないでください。

===DECISIONS===
(会議で決定された事項を箇条書きで記載。ない場合は「なし」)

===TASKS===
(会議から発生した課題やネクストアクションを箇条書きで記載。ない場合は「なし」)

===DISCUSSION_POINTS===
(会議で議論された主要な論点や話題を箇条書きで記載。ない場合は「なし」)

===DEADLINES===
(期限や日程候補として言及されたスケジュールのリストを箇条書きで記載。ない場合は「なし」)

===TRANSCRIPT===
(ここから最後に、音声の全文文字起こしを記載してください。要約ではなく、誰が何を話したか、詳細に一語一句書き起こしてください。長文になっても構いませんが、途中で途切れても問題ありません。)
"""
        inputs = {
            "mode": "admin",
            "attachments": [audio_path]
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
                
                for line in content.split('\n'):
                    line_stripped = line.strip()
                    if line_stripped.startswith('===DECISIONS==='):
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
                    elif line_stripped.startswith('===TRANSCRIPT==='):
                        current_section = 'transcript'
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
                
                crud.update_meeting(db, db_meeting, updates)
                logger.info(f"Meeting {meeting_id} analysis completed successfully")
                return
            except Exception as e:
                logger.error(f"Failed to parse Gemini response: {e}")
                logger.debug(f"Response was: {accumulated_response}")

        # 失敗時のクリーンアップ
        self.llm_client.config.response_mime_type = original_mime_type
        crud.update_meeting(db, db_meeting, {"status": "failed"})
        logger.error("Meeting analysis process finished with failure.")
