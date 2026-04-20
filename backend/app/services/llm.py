import asyncio
import time
import mimetypes
import pathlib
import json
import logging
import base64
import os
import re
from typing import AsyncGenerator, Optional, Dict, Any, List
from fastapi import HTTPException
from ..timezone import now_jst_naive

# Providers
try:
    from google import genai
    from google.genai import types
    HAS_GOOGLE = True
except ImportError:
    HAS_GOOGLE = False

try:
    import openai
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

logger = logging.getLogger(__name__)

class LLMClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        if not api_key:
            logger.warning("No API Key provided to LLMClient.")
        
        # Decide provider based on key format or presence
        if api_key and api_key.startswith("sk-"):
            self.provider = "openai"
            self.model_name = os.getenv("OPENAI_MODEL", "gpt-4o")
            self.client = openai.AsyncOpenAI(api_key=self.api_key)
            logger.info(f"LLMClient initialized with OpenAI (Model: {self.model_name})")
        else:
            self.provider = "google"
            if HAS_GOOGLE:
                self.model_name = os.getenv("GEMINI_MODEL", "models/gemini-2.0-flash")
                self.client = genai.Client(api_key=self.api_key, http_options={'api_version': 'v1alpha'})
                logger.info(f"LLMClient initialized with Gemini (Model: {self.model_name})")
                
                self.config = types.GenerateContentConfig(
                    temperature=0.7,
                    top_p=0.95,
                    top_k=64,
                    max_output_tokens=16384,
                    response_mime_type="text/plain",
                    safety_settings=[
                        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                    ],
                    tools=[], 
                )
            else:
                raise ImportError("google-genai is not installed but requested.")

    def _convert_history(self, raw_history: List[Dict[str, Any]]) -> List[Any]:
        if self.provider == "google":
            contents = []
            for h in raw_history:
                role = "user" if h.get("role") == "user" else "model"
                contents.append(types.Content(role=role, parts=[types.Part.from_text(text=h.get("content", ""))]))
            return contents
        else:
            # OpenAI format
            contents = []
            for h in raw_history:
                role = "user" if h.get("role") == "user" else "assistant"
                contents.append({"role": role, "content": h.get("content", "")})
            return contents

    def generate_system_prompt(self, inputs: Dict[str, Any]) -> str:
        now_str = now_jst_naive().strftime('%Y-%m-%d %H:%M:%S')
        mode = inputs.get("mode", "admin")
        no_actions = inputs.get("no_actions", False)
        
        task_csv = inputs.get("csv", "")
        project_list = inputs.get("proj", "")
        user_list = inputs.get("user_list", "")
        notes_text = inputs.get("notes", "")
        project_summary = inputs.get("project_summary", "")

        common_instructions = f"""
現在日時: {now_str}
回答は必ず**完全な文章**で終わらせてください。ユーザーへの問いかけも文章の最後に行ってください。
データベース内のキーワードと完全一致しなくても、文脈が近ければ情報を提示してください。
"""
        if not no_actions:
            common_instructions += """
タスク操作が必要な場合は、回答の最後に以下のJSON(Markdown)を出力してください。
```json
{ "action_type": "create_task" | "update_task" | "delete_task", "task_id": 123, "task_data": { "name": "...", "status": "...", "due_date": "YYYY-MM-DD" } }
```
"""
        kb_summaries = inputs.get("kb_summaries", "")
        kb_instruction = ""
        if kb_summaries:
            kb_instruction = (
                f"\n【知識ベース】\n{kb_summaries}\n"
                "※重要：知識ベースの情報は `--- [TYPE: TITLE] (DATE) ---` という形式でラベル付けされています。"
                "回答の際は、質問された対象（特定の会議名など）とこのラベルが一致しているかを確認し、関係のない情報の混同を避けてください。"
                "最新の日付の情報を真実として扱ってください。"
            )

        if mode == "personal":
            role_msg = f"あなたはユーザー {inputs.get('user_name', 'User')} の専属AIアシスタントです。フレンドリーに応対してください。"
        elif mode == "utility":
            return "あなたは実務的なデータ処理ツールです。挨拶や装飾なしで、求められた情報を簡潔に出力してください。"
        else:
            role_msg = "あなたはプロジェクト管理者の戦略的パートナーです。タスク、決定事項、議事録を元に高度な洞察を提示してください。"

        system_prompt = f"{role_msg}\n{common_instructions}\n{kb_instruction}\n\n【コンテキスト】\nタスク:\n{task_csv}\nプロジェクト:\n{project_list}\nメモ:\n{notes_text}"
        return system_prompt

    async def stream_chat(
        self,
        query: str,
        conversation_id: str,
        inputs: Dict[str, Any] = {},
        user: str = "default_user",
        history: List[Dict[str, Any]] = []
    ) -> AsyncGenerator[Dict[str, Any], None]:
        if self.provider == "google":
            async for chunk in self._stream_gemini(query, conversation_id, inputs, history):
                yield chunk
        else:
            async for chunk in self._stream_openai(query, conversation_id, inputs, history):
                yield chunk

    async def oneshot_chat(
        self,
        query: str,
        inputs: Dict[str, Any] = {},
        history: List[Dict[str, Any]] = []
    ) -> str:
        """ストリーミングなしで一括で応答を取得する（内部処理用）"""
        response_text = ""
        # 履歴と入力を元にストリームを回して結合する
        async for chunk in self.stream_chat(query, "internal_oneshot", inputs, history=history):
            if chunk.get("event") == "message":
                response_text += chunk.get("answer", "")
            elif chunk.get("event") == "error":
                raise Exception(chunk.get("message"))
        return response_text

    async def _stream_gemini(self, query: str, conversation_id: str, inputs: Dict[str, Any], history: List[Dict[str, Any]]):
        system_prompt = self.generate_system_prompt(inputs)
        history_contents = self._convert_history(history)
        self.config.system_instruction = [types.Part.from_text(text=system_prompt)]
        
        query_parts = [query]
        attachments_to_clean = []
        
        attachments = inputs.get("attachments", [])
        for file_path in attachments:
            try:
                p = pathlib.Path(file_path)
                if not p.exists(): continue
                mime_type, _ = mimetypes.guess_type(file_path)
                if not mime_type: mime_type = "application/pdf" if file_path.lower().endswith(".pdf") else "application/octet-stream"
                
                if mime_type.startswith("audio/") or mime_type == "application/pdf":
                    file_obj = await self.client.aio.files.upload(file=str(file_path), config={"mime_type": mime_type})
                    # Poll for ACTIVE
                    while file_obj.state == "PROCESSING":
                        await asyncio.sleep(2)
                        file_obj = await self.client.aio.files.get(name=file_obj.name)
                    query_parts.append(types.Part.from_uri(file_uri=file_obj.uri, mime_type=mime_type))
                    attachments_to_clean.append(file_obj.name)
                else:
                    with open(file_path, "rb") as f: data = f.read()
                    query_parts.append(types.Part.from_bytes(data=data, mime_type=mime_type))
            except Exception as e:
                logger.warning(f"Gemini attachment failed: {e}")

        try:
            chat = self.client.aio.chats.create(model=self.model_name, config=self.config, history=history_contents)
            response_stream = await chat.send_message_stream(query_parts)
            full_text = ""
            async for chunk in response_stream:
                if chunk and hasattr(chunk, "text") and chunk.text:
                    full_text += chunk.text
                    yield {"event": "message", "answer": chunk.text, "conversation_id": conversation_id}
            
            action = self.detect_action_from_text(full_text)
            if action: yield {"event": "task_action", "action": action, "conversation_id": conversation_id}
            yield {"event": "message_end", "conversation_id": conversation_id}
        finally:
            for fn in attachments_to_clean:
                try: await self.client.aio.files.delete(name=fn)
                except: pass

    async def _stream_openai(self, query: str, conversation_id: str, inputs: Dict[str, Any], history: List[Dict[str, Any]]):
        system_prompt = self.generate_system_prompt(inputs)
        
        messages = [{"role": "system", "content": system_prompt}]
        # History
        for h in history:
            role = "user" if h.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": h.get("content", "")})
        
        # Multimodal content for user message
        all_text_parts = []
        has_images = False
        user_content = []
        
        attachments = inputs.get("attachments", [])
        for file_path in attachments:
            try:
                p = pathlib.Path(file_path)
                if not p.exists(): continue
                ext = p.suffix.lower()
                
                if ext in [".jpg", ".jpeg", ".png", ".webp"]:
                    with open(file_path, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode("utf-8")
                    user_content.append({"type": "image_url", "image_url": {"url": f"data:image/{ext[1:]};base64,{b64}"}})
                    has_images = True
                elif ext == ".pdf":
                    from pypdf import PdfReader
                    reader = PdfReader(file_path)
                    text = ""
                    for page in reader.pages: text += page.extract_text() + "\n"
                    all_text_parts.append(f"\n【資料内容: {p.name}】\n{text}")
                elif ext in [".mp3", ".wav", ".m4a", ".mp4"]:
                    # Whisper Transcription
                    logger.info(f"LLMClient: Transcribing {p.name} via Whisper...")
                    with open(file_path, "rb") as audio_file:
                        # promptを指定することでハルシネーション（繰り返しや言語の誤解）を大幅に抑制
                        transcript = await self.client.audio.transcriptions.create(
                            model="whisper-1", 
                            file=audio_file,
                            prompt="これは日本語の会議の文字起こしです。句読点を適切に使用し、意味不明な繰り返しや関係のない挨拶を省いてください。",
                            language="ja"
                        )
                    
                    t_text = transcript.text.strip()
                    logger.info(f"LLMClient: Transcription complete for {p.name} (Length: {len(t_text)})")
                    
                    if t_text:
                        all_text_parts.append(f"\n【会議の文字起こしデータ: {p.name}】\n{t_text}")
                    else:
                        all_text_parts.append(f"\n【会議の文字起こしデータ: {p.name}】\n(このセグメントには音声や発言が含まれていないようです。)")
                        logger.warning(f"Whisper transcription is empty for {p.name}")
            except Exception as e:
                logger.warning(f"OpenAI multimodal failed: {e}")

        # Instruction/query goes last for better recency bias
        all_text_parts.append(f"\n【指示】\n{query}")
        combined_text = "\n".join(all_text_parts)

        if has_images:
            user_content.insert(0, {"type": "text", "text": combined_text})
            messages.append({"role": "user", "content": user_content})
        else:
            messages.append({"role": "user", "content": combined_text})

        try:
            stream = await self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                stream=True,
                temperature=0.7
            )
            full_text = ""
            async for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    full_text += content
                    yield {"event": "message", "answer": content, "conversation_id": conversation_id}
            
            action = self.detect_action_from_text(full_text)
            if action: yield {"event": "task_action", "action": action, "conversation_id": conversation_id}
            yield {"event": "message_end", "conversation_id": conversation_id}
        except Exception as e:
            logger.error(f"OpenAI error: {e}")
            yield {"event": "error", "message": str(e)}

    def detect_action_from_text(self, text: str) -> Optional[Dict[str, Any]]:
        try:
            import re
            match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
            if not match: match = re.search(r"(\{.*?\})", text, re.DOTALL)
            if match: return json.loads(match.group(1).strip())
        except: pass
        return None
