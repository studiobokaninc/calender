import os
from google import genai
from google.genai import types
import json
import logging
from typing import AsyncGenerator, Optional, Dict, Any, List
from fastapi import HTTPException
from ..timezone import now_jst_naive

# Ensure logs are visible
# logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 会話履歴をメモリに保持 (再起動で消える)
# 構造: { conversation_id: [ { role: "user" | "model", parts: [...] }, ... ] }
_chat_history_memory: Dict[str, List[Dict[str, Any]]] = {}

class LLMClient:
    def __init__(self, api_key: str):
        if not api_key:
            logger.warning("GOOGLE_API_KEY is not set.")
        
        self.client = genai.Client(api_key=api_key)
        
        # モデル設定
        # ユーザー指定により gemini-2.5-pro を使用
        self.model_name = "gemini-2.5-pro"
        self.config = types.GenerateContentConfig(
            temperature=0.7,
            top_p=0.95,
            top_k=64,
            max_output_tokens=8192,
            response_mime_type="text/plain",
            safety_settings=[
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
            ],
            # Explicitly disable tools to prevent AFC from interfering
            tools=[], 
        )

    def _get_history(self, conversation_id: str) -> List[types.Content]:
        raw_history = _chat_history_memory.get(conversation_id, [])
        # Convert to google.genai.types.Content
        contents = []
        for h in raw_history:
            role = h.get("role")
            parts_text = h.get("parts", [])
            # google.genai expects parts as list of Part objects or strings
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=p) for p in parts_text]))
        return contents

    def _update_history(self, conversation_id: str, role: str, text: str):
        if conversation_id not in _chat_history_memory:
            _chat_history_memory[conversation_id] = []
        
        # Gemini format: role="user" or "model"
        gemini_role = "user" if role == "user" else "model"
        _chat_history_memory[conversation_id].append({
            "role": gemini_role,
            "parts": [text],
        })
        
    def generate_system_prompt(self, inputs: Dict[str, Any]) -> str:
        """
        コンテキスト情報（タスク、プロジェクト、ユーザー、現在日時）からシステムプロンプトを生成
        """
        now_str = now_jst_naive().strftime('%Y-%m-%d %H:%M:%S')
        
        task_csv = inputs.get("csv", "")
        project_list = inputs.get("proj", "")
        user_list = inputs.get("user_list", "")

        system_prompt = f"""
あなたはプロジェクト管理ツールのAIアシスタントです。
現在日時: {now_str}

**あなたの役割**
ユーザーの質問に対して、提供されたタスク・プロジェクト・スケジュール情報を元に回答してください。
また、ユーザーがタスクの作成・更新・削除を依頼した場合は、必ず特定のJSONフォーマットを出力して、フロントエンドにアクションを促してください。

**重要: 回答の完結性について**
- 回答は必ず**完全な文章**で終わらせてください。途中で言葉を切ってはいけません。
- ユーザーに追加の質問がある場合も、「〜しますか？」と明確に尋ねて文章を閉じてください。
- 決して中途半端な状態で出力を停止しないでください。

**タスク操作のルール (重要)**
ユーザーがタスクの変更（作成、更新、削除）を意図している場合、回答の最後に以下のJSONフォーマット(Markdownコードブロック)を含めてください。
これをフロントエンドが検知して確認ダイアログを表示します。

1. **タスク作成**
```json
{{
  "action_type": "create_task",
  "task_data": {{
    "name": "タスク名",
    "project_id": 123, // プロジェクトID (不明な場合は省略可だが、文脈から推測推奨)
    "due_date": "YYYY-MM-DD",
    "assigned_to": 456, // ユーザーID
    "description": "説明...",
    "status": "todo" // todo, in-progress, review, completed, delayed
  }}
}}
```

2. **タスク更新**
```json
{{
  "action_type": "update_task",
  "task_id": 789,
  "task_data": {{
    "status": "completed" // 変更するフィールドのみ
  }}
}}
```

3. **タスク削除**
```json
{{
  "action_type": "delete_task",
  "task_id": 789
}}
```
※ 複数のアクションが必要な場合は JSON の配列 `[...]` で返してください。

**コンテキスト情報**

【プロジェクト一覧】
{project_list}

【ユーザー一覧】
{user_list}

【タスク一覧 (CSV形式)】
id, name, project_id, assigned_to, due_date, status, priority
{task_csv}

**回答のガイドライン**
- タスク一覧にある情報は正確に答えてください。
- IDやステータスなどの内部的な値ではなく、なるべく名前や「完了」「進行中」などの言葉で説明してください。
- 文脈から推測できない場合は確認してください。
- ユーザーに親切で簡潔な日本語で答えてください。
"""
        return system_prompt

    async def stream_chat(
        self,
        query: str,
        conversation_id: str,
        inputs: Dict[str, Any] = {},
        user: str = "default_user"
    ) -> AsyncGenerator[Dict[str, Any], None]:
        
        system_prompt = self.generate_system_prompt(inputs)
        
        # 履歴の取得
        history_contents = self._get_history(conversation_id)
        
        # System Prompt Injection (Turn 0 injection or config injection)
        # 2.0 Client uses config.system_instruction
        current_config = self.config
        current_config.system_instruction = [types.Part.from_text(text=system_prompt)]

        try:
            # google-genai 1.0+ async chat structure
            chat = self.client.chats.create(
                model=self.model_name,
                config=current_config,
                history=history_contents
            )
            
            # google-genai library streaming (synchronous iterator)
            # To avoid blocking the event loop, run the blocking iteration in a separate thread
            # and push chunks to an asyncio Queue.
            
            import asyncio
            queue = asyncio.Queue()
            loop = asyncio.get_running_loop()
            
            def blocking_iteration():
                try:
                    # Sync call
                    response_stream = chat.send_message_stream(query)
                    for chunk in response_stream:
                        loop.call_soon_threadsafe(queue.put_nowait, chunk)
                    # Sentinel for end
                    loop.call_soon_threadsafe(queue.put_nowait, None)
                except Exception as e:
                    loop.call_soon_threadsafe(queue.put_nowait, e)

            # Start thread
            import threading
            threading.Thread(target=blocking_iteration, daemon=True).start()
            
            accumulated_text = ""
            
            while True:
                item = await queue.get()
                if item is None:
                    break
                if isinstance(item, Exception):
                    raise item
                
                chunk = item
                
                # new chunk object structure
                text_chunk = chunk.text
                if text_chunk:
                    # logger.info(f"[LLM] Received chunk: {text_chunk[:20]}...") # Log start of chunk (INFO)
                    accumulated_text += text_chunk
                    
                    yield {
                        "event": "message",
                        "answer": text_chunk,
                        "conversation_id": conversation_id,
                        "message_id": "gemini-msg-" + conversation_id
                    }
                else:
                    # logger.info("[LLM] Received empty text chunk")
                    pass
                
                # Check for finish reason
                if hasattr(chunk, 'candidates') and chunk.candidates:
                    for cand in chunk.candidates:
                        if cand.finish_reason:
                            # logger.info(f"Gemini Finish Reason: {cand.finish_reason}")
                            if cand.finish_reason != "STOP":
                                logger.warning(f"Stream ended with non-STOP reason: {cand.finish_reason}")
            
            # logger.info(f"[LLM] Full accumulated text length: {len(accumulated_text)}")
            # logger.info(f"[LLM] Full text: {accumulated_text}") # INFO level for full text

            # Workaround: manually update history
            self._update_history(conversation_id, "user", query)
            self._update_history(conversation_id, "model", accumulated_text)
            
            # Completion event
            yield {
                "event": "message_end",
                "conversation_id": conversation_id,
                "message_id": "gemini-msg-" + conversation_id
            }
            
        except Exception as e:
            logger.error(f"Gemini API Error: {e}")
            yield {
                "event": "error",
                "status": 500,
                "code": "gemini_error",
                "message": str(e)
            }
