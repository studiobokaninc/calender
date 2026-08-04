"""
議事録生成の試験運用スクリプト（開発段階）。

本番 Calendar backend（app.services.meeting_analyzer / app.crud / RAG）とは
一切接続しない独立スクリプト。音声 or 文字起こし済みテキストを入力に取り、
抽出（決定事項・タスク・論点・期限）だけを Claude Code CLI（このPCにログイン
済みの Max プラン契約）に投げて結果を確認するためのもの。

文字起こしは本番と同じ経路（WHISPER_IMPL 環境変数）を再利用する:
  remote … BOX2 の whisper.cpp サーバー (WHISPER_REMOTE_URL) ※本番のデフォルト
  cpp    … ローカル whisper.cpp CLI (WHISPER_CPP_BIN / WHISPER_CPP_MODEL)
backend/.env を自動では読まない。必要な環境変数は事前に export するか
--transcript で文字起こし済みテキストを直接渡すこと。

使い方:
  python minutes_via_claude_code_trial.py --transcript sample.txt
  python minutes_via_claude_code_trial.py --audio rec.mp3 --whisper-impl remote
  python minutes_via_claude_code_trial.py --audio rec.mp3 --claude-model sonnet --out result.json
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

EXTRACT_PROMPT_TEMPLATE = """あなたは会議の文字起こしから重要情報だけを抽出する精密な議事録アシスタントです。

【最重要ルール】
- 出力は必ず日本語。中国語・英語の混在は禁止。
- **下記の文字起こしに実際に含まれる情報だけを抽出**してください。推測・一般論・創作の追加は固く禁止します。該当が無ければそのセクションには「なし」とだけ書いてください。
- 文字起こし本文は出力しないでください（抽出結果のみ）。挨拶・前置き・締め文句も一切書かないでください。

【対象の文字起こし】
{transcript}

【出力フォーマット】（このキーワードだけをセクション区切りに使用し、他の説明文は書かない）
===DECISIONS===
- 決定事項（なければ「なし」）
===TASKS===
- [タイプ] 担当者：内容（期限）
===DISCUSSION_POINTS===
- 主要な論点・意見（なければ「なし」）
===DEADLINES===
- 具体的な期限・日程（なければ「なし」）
"""

_META_MARKERS = (
    "セグメント", "以上が", "以上で", "分析結果", "文字起こし", "抽出結果",
    "承知しました", "了解しました", "申し訳", "以下の", "以下に", "出力します",
    "特にありません", "情報はありません", "該当なし", "該当する", "見当たりません",
)


def _transcribe_whisper_remote(audio_path: str) -> str:
    import httpx

    url = os.getenv("WHISPER_REMOTE_URL", "").strip()
    if not url:
        raise RuntimeError("WHISPER_REMOTE_URL が未設定です。")
    lang = os.getenv("WHISPER_LANG", "ja")
    timeout = float(os.getenv("WHISPER_REMOTE_TIMEOUT", "900"))

    tmp_dir = tempfile.mkdtemp()
    tmp_wav = os.path.join(tmp_dir, "audio16k.wav")
    ffmpeg_exe = shutil.which("ffmpeg") or "ffmpeg"
    try:
        r1 = subprocess.run(
            [ffmpeg_exe, "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", tmp_wav],
            capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=300,
        )
        if not os.path.exists(tmp_wav):
            raise RuntimeError(f"ffmpeg 16kHz変換失敗(code={r1.returncode}): {(r1.stderr or '')[:300]}")

        with httpx.Client(timeout=timeout) as client:
            with open(tmp_wav, "rb") as f:
                files = {"file": ("audio16k.wav", f, "audio/wav")}
                data = {"response_format": "json", "language": lang, "temperature": "0"}
                resp = client.post(url, files=files, data=data)
        resp.raise_for_status()
        try:
            j = resp.json()
            text = (j.get("text") or "") if isinstance(j, dict) else str(j)
        except Exception:
            text = resp.text
        return text.strip()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _transcribe_whisper_cpp(audio_path: str) -> str:
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
        r1 = subprocess.run(
            [ffmpeg_exe, "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", tmp_wav],
            capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=300,
        )
        if not os.path.exists(tmp_wav):
            raise RuntimeError(f"ffmpeg 16kHz変換失敗(code={r1.returncode}): {(r1.stderr or '')[:300]}")

        r2 = subprocess.run(
            [bin_path, "-m", model_path, "-f", tmp_wav, "-l", "ja",
             "-t", str(threads), "-otxt", "-of", out_base, "-np", "-mc", "0", "-sns"],
            capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=1800,
        )
        if r2.returncode != 0:
            raise RuntimeError(f"whisper-cli 失敗(code={r2.returncode}): {(r2.stderr or '')[:300]}")

        txt_path = out_base + ".txt"
        if not os.path.exists(txt_path):
            return ""
        with open(txt_path, encoding="utf-8") as f:
            return f.read().strip()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def transcribe(audio_path: str, impl: str) -> str:
    if impl == "remote":
        try:
            return _transcribe_whisper_remote(audio_path)
        except Exception as e:
            print(f"[warn] remote whisper 失敗: {e} → ローカル whisper.cpp にフォールバック", file=sys.stderr)
            return _transcribe_whisper_cpp(audio_path)
    return _transcribe_whisper_cpp(audio_path)


def extract_with_claude_code(transcript: str, model: str) -> str:
    """Claude Code CLI (headless / print mode) にこのPCのMaxプランセッションで抽出させる。"""
    prompt = EXTRACT_PROMPT_TEMPLATE.format(transcript=transcript)
    cmd = [
        "claude", "-p", "--output-format", "json",
        "--model", model,
        "--tools", "",  # ツール呼び出し不要（純粋なテキスト抽出）
        "--no-session-persistence",
        prompt,
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI 失敗(code={result.returncode}): {(result.stderr or '')[:500]}")

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return result.stdout.strip()

    if isinstance(payload, dict):
        if payload.get("is_error"):
            raise RuntimeError(f"claude CLI エラー応答: {payload.get('result') or payload}")
        return str(payload.get("result", "")).strip()
    return str(payload).strip()


def parse_sections(text: str) -> dict:
    result = {"decisions": [], "tasks": [], "discussion_points": [], "deadlines": []}
    key_map = {
        "===DECISIONS===": "decisions",
        "===TASKS===": "tasks",
        "===DISCUSSION_POINTS===": "discussion_points",
        "===DEADLINES===": "deadlines",
    }
    current = None
    for line in text.split("\n"):
        raw = line.strip()
        if not raw:
            continue
        if raw in key_map:
            current = key_map[raw]
            continue
        if current is None:
            continue
        item = raw.lstrip("-*・ ").strip()
        if not item or item.lower() in ("なし", "none"):
            continue
        if any(mk in item for mk in _META_MARKERS):
            continue
        if item not in result[current]:
            result[current].append(item)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--audio", help="音声/動画ファイルのパス")
    src.add_argument("--transcript", help="文字起こし済みテキストファイルのパス（Whisperをスキップ）")
    parser.add_argument("--whisper-impl", choices=["remote", "cpp"], default=os.getenv("WHISPER_IMPL", "remote"),
                         help="音声からの文字起こし方式（デフォルト: 環境変数 WHISPER_IMPL、無ければ remote=BOX2）")
    parser.add_argument("--claude-model", default="sonnet",
                         help="claude CLI に渡すモデル (sonnet/opus/fable 等。デフォルト: sonnet)")
    parser.add_argument("--out", help="結果をJSONで保存するパス（省略時は標準出力のみ）")
    args = parser.parse_args()

    if args.transcript:
        raw = Path(args.transcript).read_text(encoding="utf-8").strip()
    else:
        print(f"[info] 文字起こし中... (impl={args.whisper_impl})", file=sys.stderr)
        raw = transcribe(args.audio, args.whisper_impl).strip()

    if not raw:
        print("[error] 文字起こし結果が空でした。中断します。", file=sys.stderr)
        sys.exit(1)

    print(f"[info] 文字起こし完了 ({len(raw)}文字)。Claude Code CLI (model={args.claude_model}) で抽出中...", file=sys.stderr)
    extracted_text = extract_with_claude_code(raw, args.claude_model)
    result = parse_sections(extracted_text)
    result["transcript"] = raw

    output = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"[info] 結果を保存しました: {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
