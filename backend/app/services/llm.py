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
from .rag import rag_service
from .. import crud

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
        if api_key and api_key.startswith("sk-ant-"):
            self.provider = "anthropic"
            self.model_name = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
            self.client = None
            logger.info(f"LLMClient initialized with Anthropic (Model: {self.model_name})")
        elif api_key and api_key.startswith("sk-"):
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
タスク情報はそれぞれのプロジェクトのスケジュール(進行計画)そのものでもあります。プロジェクトのスケジュールや最新状況について聞かれた場合は、必ずタスク情報を参照してください。
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
                f"\n【知識ベース（検索結果の抜粋）】\n{kb_summaries}\n"
                "※重要：知識ベースの情報は `--- [TYPE: TITLE (ID: xx)] (DATE) ---` という形式でラベル付けされています。\n"
                "回答の際は、質問された対象とこのラベルが一致しているかを確認し、情報の混同を避けてください。\n"
                "最新の日付の情報を真実として扱ってください。\n\n"
                "【※必須の出力ルール：人間の検証サポートと追加検索】\n"
                "ここに提供されているシステム情報は、アプリ内の全データではなく、検索でヒットした一部の「浅い抜粋」に過ぎません。\n"
                "そのため、ユーザーが特定の会議の内容や最新状況、主な論点などを尋ねている場合、絶対にこの抜粋だけで回答を完結させないでください。\n"
                "必ず回答を生成する前に、該当する会議のID (ID: xx の数値部分) を使って `get_meeting_details` ツールを実行し、全ての議論録（トランスクリプト・全ての論点）を読み込んでから、その内容を含めて分厚い回答を行ってください。\n"
                "回答の最後には必ず、参考にした情報源のIDをリストアップしてください。"
            )

        graph_exploration_template = """
【思考と探索のプロセスルール：知識グラフ探索（最重要）】
クエリのタイプに合わせて、AIは以下のアプローチ（グラフ的な段階取得）を**必ず**実行し、最後に総合的な結論を出力してください。

■ 1. 進捗確認系（例：「状況はどう？」「進捗は？」）
・Step1: 対象タスクやプロジェクト状況の取得（search_tasks や コンテキストから）
・Step2: 遅延や依存元タスクの確認
・Step3: search_database ＋ get_meeting_details で「直近の最新議事録」のみを深掘り

■ 2. 分析・原因究明系（例：「なぜ遅れてる？」「問題は？」）
・Step1: 対象タスクとボトルネック（依存）タスクの取得
・Step2: 過去議事録を search_database -> get_meeting_details で複数深掘り
・Step3: 類似ナレッジや過去トラブルの検索

■ 3. 検索・ナレッジ系（例：「〇〇に関する情報」）
・Step1: search_database でナレッジ中心の検索
・Step2: 必要なら get_meeting_details
・Step3: 関連タスクを軽くチェック

【探索の深さ制御（暴走防止）】
- ホップ数（ツールの連続使用）は最大2〜3回まで
- 広く見すぎず、確実に「欲しい情報の深堀り」を行う

【強制俯瞰による出力フォーマット】
回答は必ず以下の構成にすること。ただのデータ寄せ集めは禁止。
1. 各ソース要約（タスク / 議事録 / ナレッジからの抽出）
2. 相互関係の整理（タスクと議事録がどう紐付いているか等）
3. 問題点・リスク（遅延要因や未決事項など）
4. 結論
5. 【カバレッジ状況】（どのデータをどの期間分探したか、抜け漏れの可能性がないかをユーザーに明示）
"""

        if mode == "ask":
            role_msg = (
                "あなたは、過去の議事録、会議録、および会議中の会話文字起こし（トランスクリプト）の精読・分析に特化した、調査専任の優秀なAIアシスタントです。\n"
                "一般的な一問一答のように、ユーザーの質問に対して優しく、丁寧で、分かりやすいプロフェッショナルな自然言語で回答してください。\n"
                "※重要：プロジェクト管理のフォーマット（『各ソース要約』『相互関係の整理』『問題点・リスク』『結論』『カバレッジ状況』などの5層構成）は【絶対に】使用しないでください。これらは今回は完全に不要です。ただ自然な対話形式で答えを生成してください。"
            )
            
            kb_instruction_ask = ""
            if kb_summaries:
                kb_instruction_ask = (
                    f"\n【会議ナレッジの抜粋（検索結果）】\n{kb_summaries}\n"
                    "※重要：ここに提供されている情報は、検索によって得られた「浅い抜粋」に過ぎません。\n"
                    "ユーザーが会議での実際の発言や、会話の流れ、経緯を求めている場合は、絶対にこの抜粋だけで回答を終わらせないでください。\n"
                    "必ず `get_meeting_details` などのツールを自律的に呼び出して、該当する会議の「完全な文字起こしデータ」をSQLiteから直接ロードし、発言や会話を読み込んだ上で回答を構成してください。\n"
                    "回答には、どの会議（日付と会議名）を参考にしたかを必ず明記してください。また、可能であれば、会議ID（ID: xx）を文頭、文末、または参考元として含めてください（API側でソースの抽出に使用します）。"
                )
                
            system_prompt = f"{role_msg}\n{common_instructions}\n{kb_instruction_ask}\n\n【注意事項】\n- 主な調査対象は会議データ、およびそこでの発言・会話内容です。タスク一覧は関係ありません。\n- 推測や捏造は禁止です。根拠となるデータがない場合は、知ったかぶりをせず素直に「データが見つかりませんでした」と回答してください。"
            return system_prompt

        elif mode == "personal":
            role_msg = f"あなたはユーザー {inputs.get('user_name', 'User')} の専属AIアシスタントです。フレンドリーに応対してください。"
        elif mode == "utility":
            return "あなたは実務的なデータ処理ツールです。挨拶や装飾なしで、求められた情報を簡潔に出力してください。"
        else:
            role_msg = "あなたはプロジェクト管理者の戦略的パートナーです。タスク、決定事項、議事録を元に高度な洞察を提示してください。"

        system_prompt = f"{role_msg}\n{common_instructions}\n{kb_instruction}\n{graph_exploration_template}\n\n【コンテキスト】\nタスク:\n{task_csv}\nプロジェクト:\n{project_list}\nメモ:\n{notes_text}"
        return system_prompt

    async def stream_chat(
        self,
        query: str,
        conversation_id: str,
        inputs: Dict[str, Any] = {},
        user: str = "default_user",
        history: List[Dict[str, Any]] = [],
        db_session: Optional[Any] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        if self.provider == "google":
            async for chunk in self._stream_gemini(query, conversation_id, inputs, history):
                yield chunk
        elif self.provider in ["openai", "anthropic"]:
            async for chunk in self._stream_openai(query, conversation_id, inputs, history, db_session):
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
            
            yield {"event": "message_end", "conversation_id": conversation_id}
        finally:
            for fn in attachments_to_clean:
                try: await self.client.aio.files.delete(name=fn)
                except: pass

    def _get_openai_tools(self):
        return [
            {
                "type": "function",
                "function": {
                    "name": "search_database",
                    "description": "知識ベース全体（会議録、タスクメモ等）からキーワード検索を行います。過去の文脈を探るのに使用してください。\n【重要事項】ここで得られる結果はあくまで短い「抜粋」です！結果の中に気になる会議録等 (ID: xx) が含まれており、ユーザーにより詳細な回答を行う必要がある場合は、必ず回答を出力する前に続けて `get_meeting_details` を呼び出し、会議の完全なトランスクリプトを読みに行ってください。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "keyword": {"type": "string", "description": "検索キーワード"}
                        },
                        "required": ["keyword"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_meeting_details",
                    "description": "特定の会議（IDを指定）の完全な文字起こしや詳細な決定事項・議論事項を取得します。抜粋では情報が足りない場合に使用してください。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "meeting_id": {"type": "integer", "description": "会議ID (例: 5)"}
                        },
                        "required": ["meeting_id"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "search_tasks",
                    "description": "システム内のタスク情報を検索します。プロジェクトIDを指定してタスク一覧とその依存関係、進捗、担当者を確認するのに使用します。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "project_id": {"type": "integer", "description": "特定のプロジェクトに絞る場合のプロジェクトID（省略可能）"}
                        }
                    }
                }
            }
        ]

    async def _execute_openai_tool(self, name: str, args_str: str, db_session) -> str:
        try:
            args = json.loads(args_str)
        except:
            return "Error: 引数のパースに失敗しました。"

        if name == "search_database":
            keyword = args.get("keyword", "")
            if not keyword: return "Error: キーワードが空です。"
            result = await rag_service.query_context(keyword, top_k=15)
            return result if result else "関連情報が見つかりませんでした。"
            
        elif name == "get_meeting_details":
            if not db_session: return "Error: データベース接続がありません。"
            meeting_id = args.get("meeting_id")
            if not meeting_id: return "Error: meeting_id が不明です。"
            
            mtg = crud.get_meeting(db_session, int(meeting_id))
            if not mtg: return f"Error: 会議ID {meeting_id} の情報が見つかりません。"
            
            detail = f"【会議ID: {mtg.id} の詳細】\nタイトル: {mtg.title}\nプロジェクト: {mtg.project.name if mtg.project else '不明'}\n日付: {mtg.date}\n\n"
            if mtg.decisions: detail += "■ 決定事項:\n" + "\n".join([f"- {d}" for d in mtg.decisions]) + "\n"
            if mtg.discussion_points: detail += "■ 議論事項:\n" + "\n".join([f"- {d}" for d in mtg.discussion_points]) + "\n"
            if mtg.tasks: detail += "■ タスク:\n" + "\n".join([f"- {d}" for d in mtg.tasks]) + "\n"
            
            detail += f"\n■ 完全な文字起こしデータ (先頭8000文字):\n{str(mtg.transcript or '')[:8000]}"
            return detail
            
        elif name == "search_tasks":
            if not db_session: return "Error: データベース接続がありません。"
            pid = args.get("project_id")
            tasks = crud.get_tasks(db_session, project_id=int(pid) if pid else None, limit=30)
            if not tasks: return "タスクが見つかりませんでした。"
            
            res = "【検索されたタスク一覧 (最大30件)】\n"
            for t in tasks:
                d_on = t.get('dependsOn', [])
                res += f"- ID: {t.get('id')} | 名前: {t.get('name')} | 状態: {t.get('status')} | 進捗: {t.get('progress')}%"
                if d_on: res += f" | 依存元ID: {d_on}"
                res += "\n"
            return res

        return "Error: 定義されていないツールです。"

    async def _stream_openai(self, query: str, conversation_id: str, inputs: Dict[str, Any], history: List[Dict[str, Any]], db_session: Optional[Any] = None):
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
                    t_text = ""
                    openai_key = os.environ.get("OPENAI_API_KEY")
                    
                    if openai_key and openai_key.startswith("sk-"):
                        try:
                            import openai
                            oai_client = openai.AsyncOpenAI(api_key=openai_key)
                            logger.info(f"LLMClient: Transcribing {p.name} via OpenAI Whisper API...")
                            with open(file_path, "rb") as audio_file:
                                transcript = await oai_client.audio.transcriptions.create(
                                    model="whisper-1", 
                                    file=audio_file,
                                    prompt="これは日本語の会議の文字起こしです。句読点を適切に使用し、意味不明な繰り返しや関係のない挨拶を省いてください。",
                                    language="ja"
                                )
                            t_text = transcript.text.strip()
                        except Exception as e:
                            logger.warning(f"OpenAI Whisper API failed: {e}. Falling back to local Whisper...")
                            
                    if not t_text:
                        logger.info(f"LLMClient: Transcribing {p.name} via local Faster-Whisper...")
                        def _transcribe_local():
                            from faster_whisper import WhisperModel
                            # Use base model for balance of speed and accuracy on CPU
                            model = WhisperModel("base", device="cpu", compute_type="int8")
                            segments, _ = model.transcribe(file_path, language="ja")
                            return "".join([s.text for s in segments])
                        
                        import asyncio
                        t_text = await asyncio.to_thread(_transcribe_local)
                        t_text = t_text.strip()

                    if t_text:
                        all_text_parts.append(f"\n【会議の文字起こしデータ: {p.name}】\n{t_text}")
                    else:
                        all_text_parts.append(f"\n【会議の文字起こしデータ: {p.name}】\n(このセグメントには音声や発言が含まれていないようです。)")
            except Exception as e:
                logger.warning(f"OpenAI multimodal failed: {e}")

        all_text_parts.append(f"\n【指示】\n{query}")
        combined_text = "\n".join(all_text_parts)

        if has_images:
            user_content.insert(0, {"type": "text", "text": combined_text})
            messages.append({"role": "user", "content": user_content})
        else:
            messages.append({"role": "user", "content": combined_text})

        tools = self._get_openai_tools()

        try:
            for iteration in range(5):
                if self.provider == "anthropic":
                    import litellm
                    os.environ["ANTHROPIC_API_KEY"] = self.api_key
                    stream = await litellm.acompletion(
                        model=f"anthropic/{self.model_name}",
                        messages=messages,
                        stream=True,
                        temperature=0.7,
                        tools=tools
                    )
                else:
                    stream = await self.client.chat.completions.create(
                        model=self.model_name,
                        messages=messages,
                        stream=True,
                        temperature=0.7,
                        tools=tools
                    )
                
                full_text = ""
                tool_calls_buffer = {}
                
                async for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        full_text += delta.content
                        yield {"event": "message", "answer": delta.content, "conversation_id": conversation_id}
                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in tool_calls_buffer:
                                tool_calls_buffer[idx] = {"id": tc.id or "", "type": "function", "function": {"name": tc.function.name or "", "arguments": tc.function.arguments or ""}}
                            else:
                                if tc.id: tool_calls_buffer[idx]["id"] += tc.id
                                if tc.function.name: tool_calls_buffer[idx]["function"]["name"] += tc.function.name
                                if tc.function.arguments: tool_calls_buffer[idx]["function"]["arguments"] += tc.function.arguments
                
                if not tool_calls_buffer:
                    break
                
                tool_calls_list = [tool_calls_buffer[k] for k in sorted(tool_calls_buffer.keys())]
                messages.append({"role": "assistant", "content": full_text or None, "tool_calls": tool_calls_list})
                
                for tc in tool_calls_list:
                    fn_name = tc["function"]["name"]
                    fn_args = tc["function"]["arguments"]
                    
                    yield {"event": "message", "answer": f"\n\n*(システム: データベース内で `{fn_name}` を実行中...)*\n\n", "conversation_id": conversation_id}
                    
                    result = await self._execute_openai_tool(fn_name, fn_args, db_session)
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "name": fn_name, "content": result})
                    
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

_cached_llm_client: Optional[LLMClient] = None
_cached_api_key: str = ""

def get_llm_client() -> LLMClient:
    """backend/.env をリロードし、APIキー（OpenAI優先、なければGoogle）を元に
    LLMClientインスタンスをキャッシュ（あるいはAPIキー変更時の再生成）して取得する"""
    global _cached_llm_client, _cached_api_key
    
    from dotenv import load_dotenv
    env_path = pathlib.Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=str(env_path), override=True)
    
    current_openai_key = os.getenv("OPENAI_API_KEY", "")
    current_google_key = os.getenv("GOOGLE_API_KEY", "")
    
    # OpenAI優先、なければGoogle
    selected_key = current_openai_key if current_openai_key.startswith("sk-") else current_google_key
    
    if _cached_llm_client is None or _cached_api_key != selected_key:
        _cached_api_key = selected_key
        _cached_llm_client = LLMClient(api_key=selected_key)
        
    return _cached_llm_client

