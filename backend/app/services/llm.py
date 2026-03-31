import asyncio
import time
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

# Note: In-memory history is replaced by DB persistence in routers.

class LLMClient:
    def __init__(self, api_key: str):
        if not api_key:
            logger.warning("GOOGLE_API_KEY is not set.")
        
        self.client = genai.Client(api_key=api_key)
        
        # モデル設定
        # 確実に存在する models/gemini-2.0-flash を使用
        self.model_name = "models/gemini-2.0-flash"
        self.config = types.GenerateContentConfig(
            temperature=0.7,
            top_p=0.95,
            top_k=64,
            max_output_tokens=16384, # 出力上限を引き上げて途切れを防ぐ
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

    def _convert_history(self, raw_history: List[Dict[str, Any]]) -> List[types.Content]:
        # Convert to google.genai.types.Content
        contents = []
        for h in raw_history:
            role = h.get("role")
            # Gemini expects 'user' or 'model'
            gemini_role = "user" if role == "user" else "model"
            content = h.get("content", "")
            contents.append(types.Content(role=gemini_role, parts=[types.Part.from_text(text=content)]))
        return contents
        
    def generate_system_prompt(self, inputs: Dict[str, Any]) -> str:
        """
        コンテキスト情報（タスク、プロジェクト、ユーザー、現在日時）からシステムプロンプトを生成
        inputs['mode'] により "personal" / "admin" を切り替え
        """
        now_str = now_jst_naive().strftime('%Y-%m-%d %H:%M:%S')
        mode = inputs.get("mode", "admin")
        no_actions = inputs.get("no_actions", False)
        
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
- **表記揺れと情報の網羅**: ユーザーの質問とデータベース内のキーワードが完全に一致しなくても、文脈や意味が近い場合は積極的に情報を提示してください（例：「A社」と「取引先A」、「MTG」と「打ち合わせ」など）。
- **情報の取りこぼし防止**: アプリ内のデータベース（議事録、タスク、決定事項）に存在する情報は、キーワードが多少異なっても「関連する可能性がある」と判断した場合は積極的に回答に含めてください。「情報がありません」と早期に判断せず、周辺情報を探ってください。
"""

        if not no_actions:
            common_instructions += """
- タスク操作（作成・更新・削除）が必要な場合は、以下のJSONフォーマット(Markdownコードブロック)を回答の最後に出力してください。

**タスク操作JSONフォーマット**
```json
{
  "action_type": "create_task" | "update_task" | "delete_task",
  "task_id": 123, // 更新/削除時など
  "task_data": {
    "name": "...",
    "status": "...",
    "due_date": "YYYY-MM-DD",
    "assigned_to": 123,
    "project_id": 456
  }
}
```
※ 複数アクションは配列 `[...]` で可。
"""

        kb_summaries = inputs.get("kb_summaries", "")
        kb_instruction = ""
        if kb_summaries:
            kb_instruction = f"""
【知識ベース（ナレッジ基盤）の資料目次】
{kb_summaries}

**時系列（Time-Series）解釈の重要ルール**
- 議事録には日付（Date: YYYY-MM-DD）が付与されています。**常に日付の新しい情報を最終的な正信（Source of Truth）として扱ってください。**
- 過去の決定事項（DECISIONS）と新しい会議の決定事項が矛盾する場合、新しい方が「上書き」したものとみなしてください。
- 知識ベース（Knowledge Base）内の資料と会議議事録の内容が異なる場合は、原則として**会議議事録の最新の合意**を優先してください。
- 「最新の状況は？」と聞かれた場合は、まず直近の会議（LATEST MEETING）を確認し、それ以前の経緯を時系列で遡って説明してください。

**引用のルール**
- 知識ベースの情報を使用する場合は、必ずどの資料に基づいているかを明記してください。
- 形式： 「〜です（引用元：[資料：資料名]）」「[資料：資料名] によれば、〜」
- 複数の資料を横断して回答する場合は、それぞれの該当箇所で引用元を示してください。
"""

        if mode == "personal":
            role_instruction = f"""
あなたはユーザー {inputs.get("user_name", "User")} の専属AIアシスタントであり、良き話し相手です。
ユーザー個人を常に認識し、業務のサポートだけでなく、日常的な会話や個人の悩みにもフレンドリーに寄り添って応じてください。

{kb_instruction}

**あなたの行動指針**
- **話し相手として**: ユーザーからの個人的な話や日常の雑談などに対しても、共感を持って親身に話し相手になってください。
- **知識の活用**: 知識ベースにユーザーに関連する情報（過去のメモや共有資料）がある場合は、積極的に引用してアドバイスに活かしてください。
- **ユーザー中心**: 業務に関する質問では、ユーザー自身のタスク（「担当」となっているもの）に焦点を当ててください。
- **推論と提案**: タスクの進捗状況や優先度を元に、次に何をするべきか等のアドバイスを行ってください。
- **操作制限**: あなたは一般ユーザー向けのサポートモードのため、タスクの作成・更新・削除などの直接的な操作権限を持っていません。ユーザーから依頼があった場合は「申し訳ありませんが、タスクの直接操作はできません。必要であれば管理者に依頼するか、ダッシュボードから操作してください」と回答してください。

**コンテキスト情報**
【語りかけているユーザー】
{inputs.get("user_name", "User")}

【担当タスク一覧】
id, name, project_id, assigned_to, due_date, status, priority
{task_csv}

【ユーザーのメモ】
{notes_text}
"""
        else: # admin / dashboard
            role_instruction = f"""
あなたはプロジェクト全体の管理者（PM）を補佐する強力なAIアシスタントであり、戦略的パートナーです。
単なる情報提供に留まらず、管理者の**あらゆる相談（技術的な課題、経営・マネジメントの悩み、アイデア出し、壁打ち、雑談など）**に対して、プロフェッショナルかつ親身に応じ、プロジェクト成功のための洞察を提示してください。

{kb_instruction}

**あなたのAdmin行動指針**
- **横断的な洞察**: 提供された「最新の議事録」「決定事項DB」「RAGによる過去経緯」を組み合わせ、多角的な視点から回答してください。
- **Source of Truth（正信）の優先順位**:
    1. **【LATEST MEETING】**: 最も新しい合意事項です。
    2. **【CURRENT ACTIVE DECISIONS】**: 現在生きている決定事項のリストです。
    3. **【RAG/Historical Excerpts】**: 過去の議論の詳細です。最新情報と矛盾する場合は新しい方を優先してください。
- **情報の不足に対する判断**: 提供された情報で回答が不十分な場合、「どの情報が足りないか（例：〇〇プロジェクトの過去の議事録、特定の資料名など）」を具体的に指摘し、管理者に追加の検索や資料提供を促してください。
- **タスク情報の扱い**: タスク詳細は特定のキーワード（タスク、期限など）が含まれる場合のみ提供されます。全体像を問われた場合は、タスク統計と決定事項を元にリスク予測（遅延予兆など）を行ってください。
- **積極的な提案**: 管理者が「何をすべきか」を迷っている場合、対話を通じて優先順位の整理や具体的なネクストアクションの提案を積極的に行ってください。
- **即時の編集**: 管理者からタスクの変更や完了の指示があった場合は、即座にアクションJSONを出力して実行してください。
"""
            if not no_actions:
                role_instruction += """
- **積極的な編集**: 管理者が会話の中で「タスクを変更して」「完了にして」と言った場合、**確認を求めすぎず**に、即座にアクションJSONを出力して実行を促してください。管理者の決定は即時の指令とみなします。
"""
            role_instruction += f"""
**コンテキスト情報**
【管理者のメモ】
{notes_text}

【全タスク一覧 (未完了のみ)】
id, name, description, assigned_to, due_date, status, project_id, priority, type, start_date, taskID, seqID, shotID, cost, updated_at, dependsOn, check_items, deliverables
{task_csv}

【プロジェクト一覧 (簡易版)】
{project_list}

【ユーザー一覧 (簡易版)】
{user_list}

**追加情報**
- `check_items`: 各タスク固有の確認事項やチェックリストです。回答の精度を高めるために活用してください。
- `deliverables`: タスクの成果物（提出物）です。
"""

        if mode == "utility":
            return """あなたは、提供されたデータや資料を正確に処理する実務的なデータ処理ツールです。
会話形式（「〜ですね」「いかがでしょうか？」など）は一切不要です。
求められた情報（要約、リスト、タグなど）のみを、簡潔かつ客観的な事実に基づいて出力してください。
"""

        system_prompt = f"""
あなたはプロジェクト管理ツールのAIアシスタントです。
{common_instructions}

{role_instruction}

**回答のルール**
- フレンドリーかつプロフェッショナルな日本語で答えてください。
- タスクIDやステータスコードではなく、人間が読める名前や状態名を使ってください。
"""
        logger.info(f"[LLM] task_csv len: {len(task_csv)}, notes len: {len(notes_text)}")
        logger.info(f"[LLM] System Prompt Length: {len(system_prompt)}")
        return system_prompt

    async def stream_chat(
        self,
        query: str,
        conversation_id: str,
        inputs: Dict[str, Any] = {},
        user: str = "default_user",
        history: List[Dict[str, Any]] = []
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Gemini 2.0 Flash を使用してストリーミング回答を生成。
        429 Too Many Requests エラーに対して指数バックオフまたは簡易リトライを行う。
        """
        system_prompt = self.generate_system_prompt(inputs)
        attachments_to_clean = []
        
        # 履歴の取得
        history_contents = self._convert_history(history)
        
        # System Prompt Injection
        # テキストパート作成
        system_parts = [types.Part.from_text(text=system_prompt)]
        
        # ユーザープロンプト用のパートを作成
        query_parts = [query]

        # 添付ファイル(PDF/画像)があればシステムプロンプトではなく、ユーザーのメッセージパートに追加
        attachments = inputs.get("attachments", [])
        if attachments:
            logger.info(f"Processing {len(attachments)} attachments for query context.")
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
                            mime_type = "audio/mp4" 
                        elif file_path.lower().endswith(".mp4"):
                            mime_type = "video/mp4"
                        else:
                            continue 
                            
                    if mime_type == "audio/x-m4a" or file_path.lower().endswith(".m4a"):
                         mime_type = "audio/mp4"
                            
                    if mime_type.startswith("audio/") or mime_type == "application/pdf":
                        logger.info(f"Uploading large file to Gemini File API (Async): {file_path}")
                        print(f"LLMClient: Gemini File API へアップロード中... ({p.name})")
                        
                        file_obj = await self.client.aio.files.upload(file=str(file_path), config={"mime_type": mime_type})

                        max_retries = 60 
                        retry_count = 0
                        while file_obj.state == "PROCESSING" and retry_count < max_retries:
                            await asyncio.sleep(10)
                            file_obj = await self.client.aio.files.get(name=file_obj.name)
                            retry_count += 1
                        
                        if file_obj.state != "ACTIVE":
                            logger.error(f"File {file_obj.name} upload failed or timed out (state: {file_obj.state}).")
                            raise Exception(f"File upload processing failed (state: {file_obj.state})")
                        
                        await asyncio.sleep(8)
                        part = types.Part.from_uri(file_uri=file_obj.uri, mime_type=mime_type)
                        query_parts.append(part)
                        attachments_to_clean.append(file_obj.name)
                    else:
                        with open(file_path, "rb") as f:
                            file_data = f.read()
                        part = types.Part.from_bytes(data=file_data, mime_type=mime_type)
                        query_parts.append(part)
                    
                except Exception as e:
                    logger.warning(f"Failed to load attachment {file_path}: {e}")

        current_config = self.config
        current_config.system_instruction = system_parts

        # Retry logic for 429 Resource Exhausted
        max_retries_429 = 3
        retry_delay = 5.0 # 5 seconds
        
        for attempt in range(max_retries_429):
            try:
                chat = self.client.aio.chats.create(
                    model=self.model_name,
                    config=current_config,
                    history=history_contents
                )
                
                accumulated_text = ""
                response_stream = await chat.send_message_stream(query_parts)
                async for chunk in response_stream:
                    text_chunk = chunk.text
                    if text_chunk:
                        accumulated_text += text_chunk
                        yield {
                            "event": "message",
                            "answer": text_chunk,
                            "conversation_id": conversation_id,
                            "message_id": "gemini-msg-" + conversation_id
                        }
                
                # --- アクション検出 ---
                detected_action = self.detect_action_from_text(accumulated_text)
                if detected_action:
                    yield {
                        "event": "task_action",
                        "type": "task_action_candidate",
                        "action": detected_action,
                        "conversation_id": conversation_id
                    }
                
                yield {
                    "event": "message_end",
                    "conversation_id": conversation_id,
                    "message_id": "gemini-msg-" + conversation_id
                }
                
                # Successful response, exit retry loop
                break

            except Exception as e:
                err_msg = str(e)
                if "429" in err_msg or "Resource exhausted" in err_msg:
                    if attempt < max_retries_429 - 1:
                        logger.warning(f"Gemini API 429 Error (Attempt {attempt+1}/{max_retries_429}). Retrying after delay...")
                        await asyncio.sleep(retry_delay)
                        continue
                
                # Non-429 error or final retry failed
                logger.error(f"Gemini API Error: {e}")
                yield {
                    "event": "error",
                    "status": 500,
                    "code": "gemini_error",
                    "message": f"Gemini API Error: {err_msg}"
                }
                break

        # Final Cleanup
        for file_name in attachments_to_clean:
            try:
                await self.client.aio.files.delete(name=file_name)
                logger.info(f"Deleted file from Gemini (Async): {file_name}")
            except:
                pass

    def detect_action_from_text(self, text: str) -> Optional[Dict[str, Any]]:
        """回答テキストからJSONアクションを抽出"""
        try:
            import json
            import re
            # ```json ... ``` または 単純な { ... } を探す
            match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
            if not match:
                match = re.search(r"(\{.*?\})", text, re.DOTALL)
            
            if match:
                json_str = match.group(1).strip()
                return json.loads(json_str)
        except Exception as e:
            logger.debug(f"Failed to parse action JSON: {e}")
        return None
