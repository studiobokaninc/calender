import os
import logging
import asyncio
import shutil
import uuid
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from .. import crud, models, schemas
from .llm import LLMClient
from .rag import rag_service
from .meeting_analyzer import MeetingAnalyzer
from ..database import SessionLocal
from ..timezone import now_jst_naive
from pathlib import Path

# Paths
BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
STATIC_DIR = BACKEND_ROOT / "static"
KNOWLEDGE_DIR = STATIC_DIR / "knowledge"

logger = logging.getLogger(__name__)

class KnowledgeProcessor:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.llm_client = LLMClient(api_key=api_key)
        self.meeting_analyzer = MeetingAnalyzer(api_key=api_key)

    async def process_knowledge_item(self, item_id: int):
        """Process a knowledge item based on its file type. Creating its own session for background safety."""
        db = SessionLocal()
        try:
            db_item = crud.get_knowledge_item(db, item_id=item_id)
            if not db_item:
                logger.error(f"KnowledgeItem {item_id} not found.")
                return

            crud.update_knowledge_item(db, db_item, {"status": "processing"})
            
            file_path = db_item.file_path
            # Resolve relative/virtual paths
            if file_path.startswith("/"):
                file_path = str(BACKEND_ROOT / file_path.lstrip("/"))
            elif not os.path.isabs(file_path):
                file_path = str(BACKEND_ROOT / file_path)

            content_text = ""
            summary = ""
            metadata = {}

            # Determine processor based on extension if not explicitly set correctly
            ext = os.path.splitext(db_item.file_name)[1].lower().rstrip(".")
            file_type = db_item.file_type
            if ext in ["pdf"]: file_type = "pdf"
            elif ext in ["xlsx", "xls", "csv"]: file_type = "excel"
            elif ext in ["pptx", "ppt"]: file_type = "ppt"
            elif ext in ["png", "jpg", "jpeg", "webp"]: file_type = "image"
            elif ext in ["mp3", "m4a", "wav"]: file_type = "audio"

            if file_type == "pdf":
                # LlamaIndex handles PDF directly
                success = rag_service.add_document(file_path, metadata={"item_id": item_id, "title": db_item.title})
                if success:
                    content_text = "PDF indexed in RAG."
                    summary = await self._generate_summary_from_file_content(file_path, "pdf")
                else:
                    raise Exception("Failed to index PDF in RAG.")

            elif file_type in ["excel", "ppt"]:
                # Custom processing for Excel/PPT (Summarization)
                summary = await self._process_complex_doc(file_path, file_type)
                content_text = summary # For now, use summary as content
                # Also add to RAG as text
                temp_text_path = KNOWLEDGE_DIR / f"tmp_{uuid.uuid4()}.txt"
                with open(temp_text_path, "w", encoding="utf-8") as f:
                    f.write(summary)
                rag_service.add_document(temp_text_path, metadata={"item_id": item_id, "title": db_item.title})
                if os.path.exists(temp_text_path):
                    os.remove(temp_text_path)

            elif file_type == "image":
                # OCR via Gemini
                content_text = await self._ocr_image(file_path)
                summary = await self._generate_summary_from_text(content_text)
                # Add to RAG
                temp_text_path = KNOWLEDGE_DIR / f"tmp_{uuid.uuid4()}.txt"
                with open(temp_text_path, "w", encoding="utf-8") as f:
                    f.write(content_text)
                rag_service.add_document(temp_text_path, metadata={"item_id": item_id, "title": db_item.title})
                if os.path.exists(temp_text_path):
                    os.remove(temp_text_path)

            elif file_type == "audio":
                # Use MeetingAnalyzer logic
                res = await self.meeting_analyzer._process_segment_with_retry(file_path, 1, 1, 0) # 0 is dummy id
                if res:
                    content_text = res.get("transcript", "")
                    summary = f"Decisions: {res.get('decisions')}\nTasks: {res.get('tasks')}"
                    # Add to RAG
                    temp_text_path = KNOWLEDGE_DIR / f"tmp_{uuid.uuid4()}.txt"
                    with open(temp_text_path, "w", encoding="utf-8") as f:
                        f.write(content_text)
                    rag_service.add_document(temp_text_path, metadata={"item_id": item_id, "title": db_item.title})
                    if os.path.exists(temp_text_path):
                        os.remove(temp_text_path)

            # Auto-tagging
            tags = await self._generate_tags(content_text or summary)
            for tag_name in tags:
                crud.add_knowledge_tag(db, item_id, tag_name)

            crud.update_knowledge_item(db, db_item, {
                "status": "completed",
                "content_text": content_text,
                "summary": summary,
                "metadata_json": metadata
            })
            logger.info(f"KnowledgeItem {item_id} processed successfully.")

        except Exception as e:
            logger.error(f"Failed to process KnowledgeItem {item_id}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            try:
                # Refresh db_item since it might be detached if error was DB-related
                db_item = crud.get_knowledge_item(db, item_id)
                if db_item:
                    crud.update_knowledge_item(db, db_item, {"status": "failed"})
            except:
                pass
        finally:
            db.close()

    async def _process_complex_doc(self, file_path: str, file_type: str) -> str:
        """Local text extraction for Excel and PPTX to avoid Gemini MIME type 400 errors."""
        extracted_text = ""
        try:
            if file_type == "excel":
                import pandas as pd
                # Read all sheets
                df_dict = pd.read_excel(file_path, sheet_name=None)
                for sheet_name, df in df_dict.items():
                    extracted_text += f"\nSheet: {sheet_name}\n"
                    extracted_text += df.to_markdown() + "\n"
            elif file_type == "ppt":
                from pptx import Presentation
                prs = Presentation(file_path)
                for i, slide in enumerate(prs.slides):
                    extracted_text += f"\nSlide {i+1}\n"
                    for shape in slide.shapes:
                        if hasattr(shape, "text"):
                            extracted_text += shape.text + "\n"
        except Exception as e:
            logger.error(f"Failed to locally extract text from {file_type}: {e}")
            extracted_text = f"Error extracting text from {file_type}."

        if not extracted_text or len(extracted_text) < 10:
             return f"The {file_type} file appears to be empty or unreadable."

        prompt = f"Analyze the following content extracted from a {file_type} file and provide a structured summary emphasizing key points and data structures.\n\n{extracted_text[:30000]}" # Limit to 30k chars
        inputs = {"mode": "admin", "no_actions": True}
        response_text = ""
        async for chunk in self.llm_client.stream_chat(prompt, f"kb_proc_{uuid.uuid4()}", inputs):
            if chunk.get("event") == "message":
                response_text += chunk.get("answer", "")
        return response_text

    async def _ocr_image(self, file_path: str) -> str:
        prompt = "Transcribe all text from this image accurately. If there are tables or structures, represent them as Markdown."
        inputs = {"mode": "admin", "attachments": [file_path], "no_actions": True}
        response_text = ""
        async for chunk in self.llm_client.stream_chat(prompt, f"kb_ocr_{uuid.uuid4()}", inputs):
            if chunk.get("event") == "message":
                response_text += chunk.get("answer", "")
        return response_text

    async def _generate_summary_from_text(self, text: str) -> str:
        prompt = f"Summarize the following text concisely:\n\n{text}"
        inputs = {"mode": "admin", "no_actions": True}
        response_text = ""
        async for chunk in self.llm_client.stream_chat(prompt, f"kb_sum_{uuid.uuid4()}", inputs):
            if chunk.get("event") == "message":
                response_text += chunk.get("answer", "")
        return response_text

    async def _generate_summary_from_file_content(self, file_path: str, file_type: str) -> str:
        prompt = f"Summarize the content of this {file_type} file."
        inputs = {"mode": "admin", "attachments": [file_path], "no_actions": True}
        response_text = ""
        async for chunk in self.llm_client.stream_chat(prompt, f"kb_sum_file_{uuid.uuid4()}", inputs):
            if chunk.get("event") == "message":
                response_text += chunk.get("answer", "")
        return response_text

    async def _generate_tags(self, text: str) -> List[str]:
        if not text: return []
        prompt = f"Extract 3-5 relevant keywords (tags) for the following content. Output as a comma-separated list only.\n\n{text}"
        inputs = {"mode": "admin", "no_actions": True}
        response_text = ""
        async for chunk in self.llm_client.stream_chat(prompt, f"kb_tags_{uuid.uuid4()}", inputs):
            if chunk.get("event") == "message":
                response_text += chunk.get("answer", "")
        return [t.strip() for t in response_text.split(",") if t.strip()]
