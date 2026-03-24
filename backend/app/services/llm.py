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
以下の資料が利用可能です。質問の内容に応じて、適切な資料を引用して回答してください。
{kb_summaries}

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
あなたはプロジェクト全体の管理者（PM）を補佐する強力なAIアシスタントです。
プロジェクト管理に限らず、管理者の**あらゆる相談（技術的な課題、マネジメントの悩み、アイデア出し、雑談など）**に真摯に乗ってください。

{kb_instruction}

**あなたの行動指針**
- **あらゆる相談の解決**: 管理者の抱えるどんな相談にでも応じ、適切なアドバイスや壁打ち相手として機能してください。
- **資料の横断分析**: 「まとめて」「概要を」と依頼された場合は、知識ベースの複数の資料を比較・集約して報告してください。
- **精緻な検索**: 具体的な事実（「いつ」「どこで」「誰が」）を問われた場合は、知識ベースの抜粋情報を精査し、正確な根拠（[資料：タイトル]）と共に回答してください。
- **全体俯瞰**: 提供された全データを分析し、プロジェクト全体の遅延、リスク、リソース不足、または順調な進捗を報告してください。
- **データに基づく回答**: タスクやプロジェクト情報を網羅的に確認し、根拠のある回答を提示してください。
- **管理支援**: 管理者が「何をすべきか」を判断するための明確なタスクリストやサマリを提供してください。
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
                            mime_type = "audio/mp4"  # For Gemini, m4a is audio/mp4 or audio/x-m4a
                        elif file_path.lower().endswith(".mp4"):
                            mime_type = "video/mp4"
                        else:
                            continue # 未知のタイプはスキップ
                            
                    # Some systems incorrectly guess m4a audio types, force to audio/mp4
                    if mime_type == "audio/x-m4a" or file_path.lower().endswith(".m4a"):
                         mime_type = "audio/mp4"
                            
                    # For large files like audio/video/pdf, use the File API
                    if mime_type.startswith("audio/") or mime_type == "application/pdf":
                        logger.info(f"Uploading large file to Gemini File API (Async): {file_path}")
                        print(f"LLMClient: Gemini File API へアップロード中... ({p.name})")
                        
                        file_obj = await self.client.aio.files.upload(file=str(file_path), config={"mime_type": mime_type})

                        # Wait for the file to be processed (Required for large audio files)
                        max_retries = 60 # Up to 10 minutes
                        retry_count = 0
                        while file_obj.state == "PROCESSING" and retry_count < max_retries:
                            logger.info(f"File {file_obj.name} is still processing... ({retry_count}/{max_retries})")
                            print(f"LLMClient: ファイルを準備中... ({retry_count+1}/{max_retries})")
                            await asyncio.sleep(10)
                            file_obj = await self.client.aio.files.get(name=file_obj.name)
                            retry_count += 1
                        
                        if file_obj.state != "ACTIVE":
                            logger.error(f"File {file_obj.name} upload failed or timed out (state: {file_obj.state}).")
                            raise Exception(f"File upload processing failed (state: {file_obj.state})")
                        
                        logger.info(f"File {file_obj.name} is ACTIVE and ready for analysis.")
                        print(f"LLMClient: ファイル準備完了. 解析を開始します.")
                        # 準備完了直後はAPIが不安定な場合があるため、少し待機
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

        try:
            # google-genai 1.0+ async chat structure
            chat = self.client.aio.chats.create(
                model=self.model_name,
                config=current_config,
                history=history_contents
            )
            
            accumulated_text = ""
            
            # 完全に非同期な通信を行う (スレッドプールの枯渇やゾンビ接続を防ぐ)
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
                
                # Check for finish reason
                if hasattr(chunk, 'candidates') and chunk.candidates:
                    for cand in chunk.candidates:
                        if cand.finish_reason:
                            pass # can log finish reason here

            # --- アクション検出 (ストリーミング完了時) ---
            # サーバー側でもフォールバックとしてパースするが、
            # 基本はフロントエンドで全結合後にパースするのを推奨
            detected_action = self.detect_action_from_text(accumulated_text)
            
            if detected_action:
                logger.info(f"[LLM] Detected task action: {detected_action.get('action_type')}")
                yield {
                    "event": "task_action",
                    "type": "task_action_candidate",
                    "action": detected_action,
                    "conversation_id": conversation_id
                }
                
            # 会話履歴の保存は呼び出し側(router)で行う
            # self._update_history(conversation_id, "user", query)
            # self._update_history(conversation_id, "model", accumulated_text)
            
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
        finally:
            # クリーンアップ: アップロードしたファイルを削除してクォータを節約
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
