import os
import mimetypes
import pathlib
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
        inputs['mode'] により "personal" / "admin" を切り替え
        """
        now_str = now_jst_naive().strftime('%Y-%m-%d %H:%M:%S')
        mode = inputs.get("mode", "admin")
        
        task_csv = inputs.get("csv", "")
        project_list = inputs.get("proj", "")
        user_list = inputs.get("user_list", "")
        events_csv = inputs.get("events", "")
        notes_text = inputs.get("notes", "")

        common_instructions = f"""
現在日時: {now_str}

**共通ガイドライン**
- 回答は必ず**完全な文章**で終わらせてください。
- ユーザーに追加の質問がある場合も、「〜しますか？」と明確に尋ねて文章を閉じてください。
- タスク操作（作成・更新・削除）が必要な場合は、以下のJSONフォーマット(Markdownコードブロック)を回答の最後に出力してください。

**タスク操作JSONフォーマット**
```json
{{
  "action_type": "create_task" | "update_task" | "delete_task",
  "task_id": 123, // 更新/削除時など
  "task_data": {{
    "name": "...",
    "status": "...",
    "due_date": "YYYY-MM-DD",
    "assigned_to": 123,
    "project_id": 456
  }}
}}
```
※ 複数アクションは配列 `[...]` で可。
"""

        if mode == "personal":
            role_instruction = f"""
あなたはユーザー {inputs.get("user_name", "User")} の専属AIアシスタントです。
ユーザー自身のタスク管理、スケジュール調整、業務効率化をサポートします。

**あなたの行動指針**
- **ユーザー中心**: ユーザー自身のタスク（「担当」となっているもの）やスケジュールに焦点を当ててください。
- **スケジュール考慮**: カレンダーイベント情報がある場合、タスクの期限や作業時間と照らし合わせて無理のない計画を提案してください。
- **他言無用**: ユーザーに関係のない他人のプライベートなタスク詳細には深入りしないでください（共有プロジェクトの文脈はOK）。
- **推論と提案**: 「〇〇のタスクが遅れていますが、来週の会議（△△）までに間に合いますか？」のように、スケジュールとタスクを関連付けたアドバイスを行ってください。
- **メモ活用**: ユーザーのメモ情報も参照し、質問に対するコンテキストとして活用してください。
- **操作制限**: あなたは一般ユーザー向けのサポートモードのため、タスクの作成・更新・削除などの直接的な操作権限を持っていません。ユーザーから依頼があった場合は「申し訳ありませんが、タスクの直接操作はできません。必要であれば管理者に依頼するか、ダッシュボードから操作してください」と回答してください。

**コンテキスト情報**
【ユーザーのスケジュール (直近)】
{events_csv}

【担当タスク一覧】
id, name, project_id, assigned_to, due_date, status, priority
{task_csv}

【関連プロジェクト】
{project_list}

【ユーザーのメモ】
{notes_text}
"""
        else: # admin / dashboard
            role_instruction = f"""
あなたはプロジェクト全体の管理者（PM）を補佐するAIアシスタントです。
プロジェクトの健全性、リソース配分、進捗管理をサポートします。

**あなたの行動指針**
- **全体俯瞰**: 提供された全データを分析し、プロジェクト全体の遅延、リスク、リソース不足、または順調な進捗を報告してください。
- **データに基づく回答**: タスクリストやイベント情報を網羅的に確認し、根拠のある回答を提示してください。
- **管理支援**: 管理者が「何をすべきか」を判断するための明確なタスクリストやサマリを提供してください。
- **積極的な編集**: 管理者が会話の中で「タスクを変更して」「完了にして」と言った場合、**確認を求めすぎず**に、即座にアクションJSONを出力して実行を促してください。管理者の決定は即時の指令とみなします。

**コンテキスト情報**
【全タスク一覧 (未完了のみ)】
{task_csv}

【全プロジェクトのイベント・スケジュール】
{events_csv}

【プロジェクト一覧】
{project_list}

【ユーザー一覧】
{user_list}
"""

        system_prompt = f"""
あなたはプロジェクト管理ツールのAIアシスタントです。
{common_instructions}

{role_instruction}

**回答のルール**
- フレンドリーかつプロフェッショナルな日本語で答えてください。
- タスクIDやステータスコードではなく、人間が読める名前や状態名を使ってください。
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
        
        # System Prompt Injection
        # テキストパート作成
        system_parts = [types.Part.from_text(text=system_prompt)]
        
        # 添付ファイル(PDF/画像)があればシステムプロンプトに追加 (最大10件程度)
        attachments = inputs.get("attachments", [])
        if attachments:
            logger.info(f"Processing {len(attachments)} attachments for system context.")
            for file_path in attachments:
                try:
                    p = pathlib.Path(file_path)
                    if not p.exists():
                        continue
                        
                    mime_type, _ = mimetypes.guess_type(file_path)
                    if not mime_type:
                        # 拡張子から推測
                        if file_path.lower().endswith(".pdf"):
                            mime_type = "application/pdf"
                        elif file_path.lower().endswith(".jpg") or file_path.lower().endswith(".jpeg"):
                            mime_type = "image/jpeg"
                        elif file_path.lower().endswith(".png"):
                            mime_type = "image/png"
                        elif file_path.lower().endswith(".mp3"):
                            mime_type = "audio/mp3"
                        elif file_path.lower().endswith(".m4a"):
                            mime_type = "audio/mp4"  # For Gemini, m4a is audio/mp4 or audio/x-m4a
                        elif file_path.lower().endswith(".mp4"):
                            mime_type = "video/mp4"
                        else:
                            continue # 未知のタイプはスキップ
                            
                    # Some systems incorrectly guess m4a audio types, force to audio/mp4
                    if mime_type == "audio/x-m4a" or file_path.lower().endswith(".m4a"):
                         mime_type = "audio/mp4"
                            
                    with open(file_path, "rb") as f:
                        file_data = f.read()
                        
                    # Gemini API (0.1+) Part format
                    part = types.Part.from_bytes(data=file_data, mime_type=mime_type)
                    system_parts.append(part)
                    
                except Exception as e:
                    logger.warning(f"Failed to load attachment {file_path}: {e}")

        current_config = self.config
        current_config.system_instruction = system_parts

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
