import asyncio
import time
import mimetypes
import pathlib
import json
import logging
import base64
import os
import re
import subprocess
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

# faster-whisper モデルのプロセス内キャッシュ。
# 以前はチャンク（5分）ごとに WhisperModel を再ロードしており、
# 長い会議ほどモデルロードが積み重なりCPUを浪費していた。1度だけロードして使い回す。
_FASTER_WHISPER_MODELS: Dict[str, Any] = {}

def _get_faster_whisper_model(model_name: str, cpu_threads: int):
    key = f"{model_name}::{cpu_threads}"
    mdl = _FASTER_WHISPER_MODELS.get(key)
    if mdl is None:
        from faster_whisper import WhisperModel  # lazy import
        # cpu_threads を絞ることで、4コア環境でもuvicornに1〜2コア残しサーバー無応答を防ぐ
        # 注意: ctranslate2 4.x はAVX2前提。AVX2非対応CPU(例:Sandy Bridge)ではロード時にsegfaultするため、
        #       そのような環境では WHISPER_IMPL=openai を使うこと。
        mdl = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=cpu_threads)
        _FASTER_WHISPER_MODELS[key] = mdl
    return mdl

# openai-whisper (PyTorch) モデルのプロセス内キャッシュ
_OPENAI_WHISPER_MODELS: Dict[str, Any] = {}

def _get_openai_whisper_model(model_name: str):
    mdl = _OPENAI_WHISPER_MODELS.get(model_name)
    if mdl is None:
        import whisper  # openai-whisper (importでtorchをロード)
        try:
            import torch
            torch.set_num_threads(int(os.getenv("WHISPER_CPU_THREADS", "2")))
        except Exception:
            pass
        mdl = whisper.load_model(model_name)
        _OPENAI_WHISPER_MODELS[model_name] = mdl
    return mdl

async def _transcribe_whisper_cpp(audio_path: str) -> str:
    """whisper.cpp の CLI 実行ファイルで文字起こしする（別プロセスで実行）。
    AVX2非対応CPU(例: Sandy Bridge)向けに AVX2/FMA を無効化して自前ビルドした whisper-cli を使う。
    別プロセスのため、たとえクラッシュしてもFastAPI本体を巻き込まない。
    必要な環境変数: WHISPER_CPP_BIN(実行ファイル), WHISPER_CPP_MODEL(ggml *.bin)。
    """
    import shutil
    import tempfile

    bin_path = os.getenv("WHISPER_CPP_BIN", "")
    model_path = os.getenv("WHISPER_CPP_MODEL", "")
    threads = os.getenv("WHISPER_CPU_THREADS", "2")
    if not bin_path or not os.path.exists(bin_path):
        raise FileNotFoundError(f"WHISPER_CPP_BIN が見つかりません: {bin_path!r}")
    if not model_path or not os.path.exists(model_path):
        raise FileNotFoundError(f"WHISPER_CPP_MODEL が見つかりません: {model_path!r}")

    tmp_dir = tempfile.mkdtemp()
    tmp_wav = os.path.join(tmp_dir, "audio16k.wav")
    out_base = os.path.join(tmp_dir, "out")
    ffmpeg_exe = shutil.which("ffmpeg") or "ffmpeg"
    try:
        # 重要: 非同期サブプロセス(asyncio.create_subprocess_exec)は稼働中uvicornワーカーの
        # イベントループ次第で Windows 上 NotImplementedError(str()が空)になり毎回失敗する。
        # 実績のある subprocess.run + asyncio.to_thread（ffprobe/ffmpegと同じ方式）で実行する。

        # 1) whisper.cpp は wav/mp3/flac/ogg のみ対応。16kHzモノWAVへ変換する。
        def _run_ffmpeg():
            return subprocess.run(
                [ffmpeg_exe, "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", tmp_wav],
                capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=300,
            )
        r1 = await asyncio.to_thread(_run_ffmpeg)
        if not os.path.exists(tmp_wav):
            raise RuntimeError(
                f"ffmpeg 16kHz変換に失敗 (code={r1.returncode}): {(r1.stderr or '')[:300]}"
            )

        # 2) whisper-cli を実行（-np: 進捗抑制, -otxt: テキスト出力）
        def _run_whisper():
            return subprocess.run(
                [bin_path, "-m", model_path, "-f", tmp_wav, "-l", "ja",
                 "-t", str(threads), "-otxt", "-of", out_base, "-np"],
                capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=1800,
            )
        r2 = await asyncio.to_thread(_run_whisper)
        if r2.returncode != 0:
            raise RuntimeError(
                f"whisper-cli 失敗(code={r2.returncode}): {(r2.stderr or '')[:300]}"
            )

        txt_path = out_base + ".txt"
        if not os.path.exists(txt_path):
            return ""
        with open(txt_path, encoding="utf-8") as f:
            return f.read().strip()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

class LLMClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        if not api_key:
            logger.warning("No API Key provided to LLMClient.")
        
        # Check LLM_PROVIDER env var first — overrides api_key-based detection
        _llm_provider_env = os.getenv("LLM_PROVIDER", "").lower()
        if _llm_provider_env == "local":
            self.provider = "openai"  # Ollama is OpenAI-compatible
            # CALENDER_LLM_BASE_URL がこのプロジェクト専用のキー。LOCAL_LLM_BASE_URL は
            # 他システムでも使われる汎用キーで、未移行環境向けにフォールバックとして残す。
            _base_url = (
                os.getenv("CALENDER_LLM_BASE_URL")
                or os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1")
            )
            self.model_name = os.getenv("LOCAL_LLM_MODEL", "qwen2.5:7b")
            self.client = openai.AsyncOpenAI(
                api_key="ollama",  # dummy key — Ollama does not validate
                base_url=_base_url,
            )
            logger.info(f"LLMClient: local Ollama ({_base_url}, model={self.model_name})")
        # Decide provider based on key format or presence
        elif api_key and api_key.startswith("sk-ant-"):
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
            return "あなたは実務的なデータ処理ツールです。挨拶や装飾なしで、求められた情報を簡潔に出力してください。出力は必ず日本語で行い、中国語や英語を混在させないでください。"
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

    async def transcribe_audio(self, file_path: str) -> str:
        """音声/動画を文字起こしして【生テキスト】を返す（議事録の逐語文字起こし用）。
        バックエンド選択は _stream_openai と同じ優先順位（クラウドWhisper→cpp→faster→openai）。
        LLMによる整形・補完は行わない。失敗時は空文字を返す（呼び出し側で捏造を防ぐ）。"""
        p = pathlib.Path(file_path)
        if not p.exists():
            return ""
        ext = p.suffix.lower()
        if ext not in [".mp3", ".wav", ".m4a", ".mp4", ".webm", ".ogg", ".opus", ".flac", ".aac", ".m4b", ".wma", ".mov"]:
            return ""

        t_text = ""
        _whisper_backend = os.getenv("WHISPER_BACKEND", "auto")
        _whisper_model = os.getenv("WHISPER_MODEL", "medium")
        openai_key = os.environ.get("OPENAI_API_KEY", "")

        # クラウドWhisper API（WHISPER_BACKEND=local またはキー無しならスキップ）
        if openai_key.startswith("sk-") and _whisper_backend != "local":
            try:
                oai_client = openai.AsyncOpenAI(api_key=openai_key)
                logger.info(f"Transcribing {p.name} via OpenAI Whisper API...")
                with open(file_path, "rb") as audio_file:
                    transcript = await oai_client.audio.transcriptions.create(
                        model="whisper-1", file=audio_file, language="ja",
                        prompt="これは日本語の会議の文字起こしです。句読点を適切に使用し、意味不明な繰り返しや関係のない挨拶を省いてください。",
                    )
                t_text = (transcript.text or "").strip()
            except Exception as e:
                logger.warning(f"OpenAI Whisper API failed: {e}. ローカルWhisperにフォールバック")

        if not t_text:
            _whisper_impl = os.getenv("WHISPER_IMPL", "faster").lower()
            if _whisper_impl == "cpp":
                logger.info(f"Transcribing {p.name} via whisper.cpp CLI...")
                t_text = (await _transcribe_whisper_cpp(file_path)).strip()
            elif _whisper_impl == "openai":
                def _transcribe_openai_whisper():
                    mdl = _get_openai_whisper_model(_whisper_model)
                    return mdl.transcribe(file_path, language="ja", fp16=False)["text"]
                t_text = (await asyncio.to_thread(_transcribe_openai_whisper)).strip()
            else:
                def _transcribe_faster():
                    mdl = _get_faster_whisper_model(_whisper_model, int(os.getenv("WHISPER_CPU_THREADS", "2")))
                    segs, _ = mdl.transcribe(file_path, language="ja")
                    return "".join(s.text for s in segs)
                t_text = (await asyncio.to_thread(_transcribe_faster)).strip()

        return t_text

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
                elif ext in [".mp3", ".wav", ".m4a", ".mp4", ".webm", ".ogg", ".opus", ".flac", ".aac", ".m4b", ".wma", ".mov"]:
                    t_text = ""
                    _whisper_backend = os.getenv("WHISPER_BACKEND", "auto")
                    _whisper_model   = os.getenv("WHISPER_MODEL", "medium")
                    openai_key = os.environ.get("OPENAI_API_KEY", "")

                    # Cloud Whisper API (スキップ条件: WHISPER_BACKEND=local OR キーなし)
                    if openai_key.startswith("sk-") and _whisper_backend != "local":
                        try:
                            import openai
                            oai_client = openai.AsyncOpenAI(api_key=openai_key)
                            logger.info(f"Transcribing {p.name} via OpenAI Whisper API...")
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

                    # Local Whisper: WHISPER_IMPL で実装を明示選択
                    #   cpp    … whisper.cpp CLI(別プロセス) ※AVX2非対応CPU向け・サーバーを巻き込まない
                    #   faster … faster-whisper(ctranslate2) ※AVX2非対応CPUではsegfaultするので使用不可
                    #   openai … openai-whisper(PyTorch)      ※AVX2非対応CPUではtorchがロード不可
                    # 未指定時は faster を試し、未導入(ImportError)なら openai にフォールバック
                    if not t_text:
                        _whisper_impl = os.getenv("WHISPER_IMPL", "faster").lower()
                        if _whisper_impl == "cpp":
                            try:
                                logger.info(f"Transcribing {p.name} via whisper.cpp CLI...")
                                t_text = (await _transcribe_whisper_cpp(file_path)).strip()
                            except Exception as e:
                                logger.warning(f"whisper.cpp transcription failed: {e}")
                        elif _whisper_impl == "openai":
                            try:
                                logger.info(f"Transcribing {p.name} via openai-whisper (model={_whisper_model})...")
                                def _transcribe_openai_whisper():
                                    mdl = _get_openai_whisper_model(_whisper_model)
                                    result = mdl.transcribe(file_path, language="ja", fp16=False)
                                    return result["text"]
                                t_text = (await asyncio.to_thread(_transcribe_openai_whisper)).strip()
                            except ImportError:
                                logger.warning("openai-whisper not installed. Skipping transcription.")
                            except Exception as e:
                                logger.warning(f"openai-whisper transcription failed: {e}")
                        else:
                            try:
                                _whisper_threads = int(os.getenv("WHISPER_CPU_THREADS", "2"))
                                logger.info(f"Transcribing {p.name} via faster-whisper (model={_whisper_model}, cpu_threads={_whisper_threads})...")
                                def _transcribe_faster():
                                    mdl = _get_faster_whisper_model(_whisper_model, _whisper_threads)
                                    segs, _ = mdl.transcribe(file_path, language="ja")
                                    return "".join(s.text for s in segs)
                                t_text = (await asyncio.to_thread(_transcribe_faster)).strip()
                            except ImportError:
                                logger.info("faster-whisper not installed. Trying openai-whisper...")
                                try:
                                    def _transcribe_openai_whisper():
                                        mdl = _get_openai_whisper_model(_whisper_model)
                                        result = mdl.transcribe(file_path, language="ja", fp16=False)
                                        return result["text"]
                                    t_text = (await asyncio.to_thread(_transcribe_openai_whisper)).strip()
                                except ImportError:
                                    logger.warning("Neither faster-whisper nor openai-whisper is installed. Skipping transcription.")
                                except Exception as e:
                                    logger.warning(f"openai-whisper transcription failed: {e}")
                            except Exception as e:
                                logger.warning(f"faster-whisper transcription failed: {e}")

                    if t_text:
                        all_text_parts.append(f"\n【会議の文字起こしデータ: {p.name}】\n{t_text}")
                    else:
                        all_text_parts.append(f"\n【会議の文字起こしデータ: {p.name}】\n(文字起こし失敗または音声なし)")
            except Exception as e:
                logger.warning(f"OpenAI multimodal failed: {e}")

        all_text_parts.append(f"\n【指示】\n{query}")
        combined_text = "\n".join(all_text_parts)

        if has_images:
            user_content.insert(0, {"type": "text", "text": combined_text})
            messages.append({"role": "user", "content": user_content})
        else:
            messages.append({"role": "user", "content": combined_text})

        # 議事録解析など no_actions/utility の呼び出しではツールを渡さない。
        # ツールを渡すと小型モデル(qwen2.5:3b等)が不要なツール呼び出しに走り、
        # 構造化出力(===DECISIONS=== 等)を返さなくなるため。
        _use_tools = not inputs.get("no_actions") and inputs.get("mode") != "utility"
        tools = self._get_openai_tools() if _use_tools else None

        try:
            for iteration in range(5):
                _kwargs = dict(messages=messages, stream=True, temperature=0.7)
                if tools:
                    _kwargs["tools"] = tools
                if self.provider == "anthropic":
                    import litellm
                    os.environ["ANTHROPIC_API_KEY"] = self.api_key
                    stream = await litellm.acompletion(
                        model=f"anthropic/{self.model_name}",
                        **_kwargs
                    )
                else:
                    stream = await self.client.chat.completions.create(
                        model=self.model_name,
                        **_kwargs
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
    
    _llm_provider = os.getenv("LLM_PROVIDER", "").lower()
    if _llm_provider == "local":
        selected_key = "__local__"  # sentinel — キャッシュキーとして機能
    else:
        # OpenAI優先、なければGoogle
        selected_key = current_openai_key if current_openai_key.startswith("sk-") else current_google_key
    
    if _cached_llm_client is None or _cached_api_key != selected_key:
        _cached_api_key = selected_key
        _cached_llm_client = LLMClient(api_key=selected_key)
        
    return _cached_llm_client

