"""議事録生成AIエージェント（別PC）連携サービス。

docs/calendar_integration_spec.md の連携仕様に基づき、会議音声の解析を
別PC上のエージェントサーバー（Faster-Whisper + Qwen）へ委譲する。

    [カレンダー] POST {AGENT_URL}/process_meeting            → 即 accepted
    [エージェント] GET  {CALLBACK}/api/projects/{p}/meetings/{m}/audio
    [エージェント] PATCH {CALLBACK}/api/meetings/{m}          → apply_agent_result()

「解析してほしい」という要求はすべて analyze() を通る唯一の入口にまとめてある。
エージェントが無効・未設定・到達不能・エラーの場合は、従来どおりの
ローカル解析（services/meeting_analyzer.MeetingAnalyzer）へ自動フォールバックする。
"""
import os
import asyncio
import logging
from typing import Any, Dict, Optional

import httpx

from .. import crud, models, schemas
from ..database import SessionLocal
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

# 同一会議を二重に委譲しないためのプロセス内ガード
_inflight: set = set()
# 会議ごとのコールバック適用ロック（PATCH の同時再送対策）
_locks: Dict[int, asyncio.Lock] = {}


# --- 設定読み出し（呼び出し時に os.getenv する。.env 編集が --reload で効くように） ---

def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def agent_url() -> str:
    return _env("MINUTES_AGENT_URL").rstrip("/")


def agent_token() -> str:
    return _env("MINUTES_AGENT_TOKEN")


def callback_url() -> str:
    return _env("CALENDAR_PUBLIC_BASE_URL").rstrip("/")


def job_timeout_sec() -> int:
    try:
        return int(_env("MINUTES_AGENT_JOB_TIMEOUT_SEC", "21600"))
    except ValueError:
        return 21600


def is_enabled() -> bool:
    """エージェント委譲が有効か。URL・トークン・コールバックURLが全て揃っている必要がある。"""
    if _env("MINUTES_AGENT_ENABLED", "false").lower() not in ("1", "true", "yes", "on"):
        return False
    return bool(agent_url() and agent_token() and callback_url())


def _config_problem() -> Optional[str]:
    """設定不備の理由を返す（無ければ None）。"""
    if not agent_url():
        return "MINUTES_AGENT_URL が未設定"
    if not agent_token():
        return "MINUTES_AGENT_TOKEN が未設定"
    cb = callback_url()
    if not cb:
        return "CALENDAR_PUBLIC_BASE_URL が未設定"
    if "localhost" in cb or "127.0.0.1" in cb:
        return f"CALENDAR_PUBLIC_BASE_URL が別マシンから到達できない値です: {cb}"
    return None


# --- DB ヘルパ ---

def _mark(meeting_id: int, updates: Dict[str, Any]) -> Optional[models.Meeting]:
    with SessionLocal() as db:
        db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
        if not db_meeting:
            return None
        crud.update_meeting(db, db_meeting, updates)
        db.commit()
        return db_meeting


def _load(meeting_id: int) -> Optional[Dict[str, Any]]:
    """必要な列だけをセッション外へ持ち出す（DetachedInstanceError 回避）。"""
    with SessionLocal() as db:
        m = crud.get_meeting(db, meeting_id=meeting_id)
        if not m:
            return None
        return {
            "id": m.id,
            "project_id": m.project_id,
            "status": m.status,
            "analysis_backend": m.analysis_backend,
            "agent_dispatched_at": m.agent_dispatched_at,
            "transcript": m.transcript,
            "uuid": m.uuid,
            "audio_url": m.audio_url,
            "attendees": m.attendees,
        }


def _resolve_audio_path(meeting_id: int) -> Optional[str]:
    from ..routers.meetings import resolve_meeting_audio_path
    with SessionLocal() as db:
        m = crud.get_meeting(db, meeting_id=meeting_id)
        if not m:
            return None
        path = resolve_meeting_audio_path(m)
        return str(path) if path else None


# --- ローカル解析へのフォールバック ---

async def _run_local(
    meeting_id: int,
    audio_path: str,
    api_key: Optional[str],
    reason: str,
    transcript_prefix: str = "",
) -> None:
    """従来どおりプロセス内で解析する。

    先に analysis_backend='local' を立てるのが重要。これにより、
    後からエージェントの failed コールバックが届いても再フォールバックしない
    （＝エージェント↔ローカルのピンポンが構造的に起きない）。
    """
    logger.info(f"minutes-agent: meeting {meeting_id} をローカル解析で処理します (理由: {reason})")
    _mark(meeting_id, {"analysis_backend": "local"})
    try:
        from .meeting_analyzer import MeetingAnalyzer
        if not api_key:
            from .llm import get_llm_client
            api_key = get_llm_client().api_key
        analyzer = MeetingAnalyzer(api_key=api_key)
        await analyzer.analyze_meeting(meeting_id, audio_path, transcript_prefix=transcript_prefix)
    except Exception:
        logger.exception(f"minutes-agent: ローカル解析に失敗しました (meeting={meeting_id})")
        _mark(meeting_id, {"status": "failed"})


# --- 委譲（唯一の入口） ---

async def analyze(
    meeting_id: int,
    audio_path: str,
    project_id: Optional[int] = None,
    api_key: Optional[str] = None,
    transcript_prefix: str = "",
) -> None:
    """会議を解析する。エージェントが使えるなら委譲し、駄目ならローカルで解析する。

    エージェントに受理された場合、この関数はすぐ戻る（結果は PATCH コールバックで届く）。
    """
    if meeting_id in _inflight:
        logger.warning(f"minutes-agent: meeting {meeting_id} は既に処理中のためスキップします")
        return
    _inflight.add(meeting_id)
    try:
        if not is_enabled():
            reason = "エージェント無効" if _env("MINUTES_AGENT_ENABLED", "false").lower() not in ("1", "true", "yes", "on") \
                else f"設定不備: {_config_problem()}"
            await _run_local(meeting_id, audio_path, api_key, reason, transcript_prefix)
            return

        problem = _config_problem()
        if problem:
            await _run_local(meeting_id, audio_path, api_key, f"設定不備: {problem}", transcript_prefix)
            return

        if not audio_path or not os.path.exists(audio_path):
            # エージェントは音声GETで 404 になるだけなので、ここで判定してしまう
            await _run_local(meeting_id, audio_path, api_key, "音声ファイルが見つからない", transcript_prefix)
            return

        row = _load(meeting_id)
        if project_id is None:
            if not row:
                logger.error(f"minutes-agent: meeting {meeting_id} が見つかりません")
                return
            project_id = row["project_id"]

        attendee_names = []
        if row:
            attendee_names = [
                a.get("name") for a in (row.get("attendees") or [])
                if isinstance(a, dict) and a.get("name")
            ]

        # 委譲の記録は POST の前に行う（accepted 後にこちらが落ちても追跡できるように）
        _mark(meeting_id, {
            "status": "processing",
            "analysis_backend": "agent",
            "agent_dispatched_at": now_jst_naive(),
        })

        payload = {
            "meeting_id": meeting_id,
            "project_id": project_id,
            "callback_url": callback_url(),
            "api_token": agent_token(),
            # forward-compat: リモートエージェント側が対応すれば使う想定。未対応でも無視されるだけで実害なし。
            "attendee_names": attendee_names,
        }
        url = f"{agent_url()}/process_meeting"
        try:
            timeout = float(_env("MINUTES_AGENT_DISPATCH_TIMEOUT", "15"))
        except ValueError:
            timeout = 15.0

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    url,
                    json=payload,
                    # 仕様書のサンプル実装はヘッダー/ボディどちらのトークンでも通るため両方送る
                    headers={"X-Agent-Token": agent_token()},
                )
            if resp.status_code < 200 or resp.status_code >= 300:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            body = resp.json()
            if body.get("status") != "accepted":
                raise RuntimeError(f"予期しない応答: {body}")
        except Exception as e:
            logger.error(
                f"minutes-agent: dispatch に失敗しました "
                f"(meeting={meeting_id} url={url} 理由=[{type(e).__name__}] {e})。ローカル解析へフォールバックします。"
            )
            await _run_local(meeting_id, audio_path, api_key, f"dispatch失敗: {type(e).__name__}", transcript_prefix)
            return

        logger.info(
            f"minutes-agent: dispatch accepted (meeting={meeting_id} project={project_id} "
            f"callback_url={callback_url()})"
        )
        _warn_if_callback_unreachable()
        if transcript_prefix:
            _PENDING_PREFIX[meeting_id] = transcript_prefix
        asyncio.create_task(_watchdog(meeting_id, audio_path, api_key))
    finally:
        _inflight.discard(meeting_id)


# 委譲中の会議に付け直す文字起こし先頭警告（録音チャンク欠損など）
_PENDING_PREFIX: Dict[int, str] = {}


# エージェントの GET /jobs/{id} が返す「終端」ステータス。これ以外は実行中とみなす。
_AGENT_TERMINAL_STATUSES = {"completed", "failed", "error", "cancelled", "canceled", "not_found"}


async def agent_job_status(meeting_id: int) -> Optional[Dict[str, Any]]:
    """エージェントの GET /jobs/{meeting_id} を引く。取得できなければ None。"""
    if not agent_url():
        return None
    try:
        timeout = float(_env("MINUTES_AGENT_HEALTH_TIMEOUT", "3"))
    except ValueError:
        timeout = 3.0
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{agent_url()}/jobs/{meeting_id}")
        if 200 <= resp.status_code < 300:
            return resp.json()
    except Exception as e:
        logger.debug(f"minutes-agent: ジョブ照会に失敗 (meeting={meeting_id}): [{type(e).__name__}] {e}")
    return None


async def _watchdog(meeting_id: int, audio_path: str, api_key: Optional[str]) -> None:
    """エージェントが何も返してこないまま放置されるのを防ぐ保険。"""
    await asyncio.sleep(job_timeout_sec())
    row = _load(meeting_id)
    if not row or row["status"] != "processing" or row["analysis_backend"] != "agent":
        return

    # まだ実行中かもしれないので、失敗と断じる前にエージェントへ問い合わせる。
    # （まだ走っているジョブを勝手にローカル解析へ落とすと二重解析になる）
    # エージェント側のステージ名は downloading/transcribing/extracting/queued 等と細かく、
    # 網羅列挙すると取りこぼす（実際 "extracting" を見落としていた）。
    # 「終端でなければ生存」と反転して判定する。
    job = await agent_job_status(meeting_id)
    if job and str(job.get("status", "")).lower() not in _AGENT_TERMINAL_STATUSES:
        logger.warning(
            f"minutes-agent: meeting {meeting_id} はTTL超過だがエージェント側でまだ実行中 "
            f"(progress={job.get('progress')})。もう1周待ちます。"
        )
        asyncio.create_task(_watchdog(meeting_id, audio_path, api_key))
        return

    logger.warning(
        f"minutes-agent: meeting {meeting_id} がタイムアウトしました "
        f"（{job_timeout_sec()}秒以内にコールバックが届きませんでした / job照会={job}）"
    )
    await _handle_failure(meeting_id, audio_path, api_key, "タイムアウト")


async def rearm_watchdogs() -> None:
    """再起動後、まだエージェントに預けたままの会議へ watchdog を貼り直す。"""
    try:
        with SessionLocal() as db:
            rows = db.query(models.Meeting).filter(
                models.Meeting.status == "processing",
                models.Meeting.analysis_backend == "agent",
            ).all()
            ids = [m.id for m in rows]
        for meeting_id in ids:
            audio_path = _resolve_audio_path(meeting_id) or ""
            asyncio.create_task(_watchdog(meeting_id, audio_path, None))
        if ids:
            logger.info(f"minutes-agent: 委譲中の会議 {ids} に watchdog を再設定しました")
    except Exception:
        logger.exception("minutes-agent: watchdog の再設定に失敗しました")


def _warn_if_callback_unreachable() -> None:
    """callback_url のホストが自分のIPと一致しないときに警告する。

    ここが間違っていると dispatch は accepted で成功したように見えるのに
    エージェントが折り返せず、タイムアウトするまで（既定6時間）誰も気づけない。
    開発機(.78)の設定のまま本番機(.253)で動かす事故が起きやすいので、
    起動直後ではなく毎回の委譲時にログへ残す。
    """
    try:
        import socket
        from urllib.parse import urlparse
        host = urlparse(callback_url()).hostname
        if not host:
            return
        local_ips = {ip[4][0] for ip in socket.getaddrinfo(socket.gethostname(), None)}
        # ホスト名指定の場合は解決結果で比較する
        try:
            target = socket.gethostbyname(host)
        except OSError:
            target = host
        if target not in local_ips:
            logger.warning(
                f"minutes-agent: CALENDAR_PUBLIC_BASE_URL={callback_url()} は "
                f"このホストのIP {sorted(local_ips)} に一致しません。"
                f"エージェントが結果を返せない可能性があります（.env を確認してください）。"
            )
    except Exception:
        pass


# --- コールバック適用 ---

async def _handle_failure(
    meeting_id: int,
    audio_path: Optional[str],
    api_key: Optional[str],
    reason: str,
) -> str:
    """エージェントが失敗した場合の処理。設定に応じてローカル解析へ落とす。"""
    fallback = _env("MINUTES_AGENT_FALLBACK_ON_FAILED_CALLBACK", "true").lower() in ("1", "true", "yes", "on")
    row = _load(meeting_id)
    if not row:
        return "failed"

    # analysis_backend が既に 'local' なら、これは遅れて届いた重複通知。何もしない。
    if row["analysis_backend"] != "agent":
        logger.info(f"minutes-agent: meeting {meeting_id} は既にローカル解析へ移行済みのため failed 通知を無視します")
        return "ignored"

    if not audio_path:
        audio_path = _resolve_audio_path(meeting_id)

    if fallback and audio_path and os.path.exists(audio_path):
        logger.warning(
            f"minutes-agent: meeting {meeting_id} がエージェント側で失敗しました ({reason})。ローカル解析へフォールバックします。"
        )
        prefix = _PENDING_PREFIX.pop(meeting_id, "")
        asyncio.create_task(_run_local(meeting_id, audio_path, api_key, f"エージェント失敗: {reason}", prefix))
        return "fallback"

    logger.error(f"minutes-agent: meeting {meeting_id} を failed にします ({reason})")
    _mark(meeting_id, {"status": "failed"})
    _PENDING_PREFIX.pop(meeting_id, None)
    return "failed"


async def apply_agent_result(meeting_id: int, payload: schemas.MeetingPatchBody) -> str:
    """エージェントからの PATCH を適用する。

    戻り値: "completed" | "ignored" | "fallback" | "failed"
    いずれの場合も HTTP 200 を返す想定（エージェントに再送ストームをさせない）。
    """
    lock = _locks.setdefault(meeting_id, asyncio.Lock())
    async with lock:
        row = _load(meeting_id)
        if not row:
            raise ValueError(f"meeting {meeting_id} が見つかりません")

        status_value = (payload.status or "").lower()

        # --- 進捗通知 (status="processing", progress=0-100) ---
        # 解析中の中間報告であって結果ではない。ここでステータスを触ってはいけない。
        # （transcript が空だからといって失敗扱いにすると、進捗5%の時点で毎回ジョブを殺してしまう）
        if status_value == "processing":
            if row["status"] == "completed":
                return "ignored"
            updates: Dict[str, Any] = {}
            if payload.progress is not None:
                updates["analysis_progress"] = max(0, min(100, int(payload.progress)))
            if row["status"] != "processing":
                updates["status"] = "processing"
            if updates:
                _mark(meeting_id, updates)
            logger.info(f"minutes-agent: meeting {meeting_id} progress={payload.progress}")
            return "progress"

        if status_value == "failed":
            return await _handle_failure(
                meeting_id, None, None, payload.failure_reason or "エージェントから failed 通知"
            )

        transcript = (payload.transcript or "").strip()
        if not transcript:
            # 空の文字起こしを completed として受け入れると、成功状態で固定されてしまう。
            # ローカル解析と同じ「捏造防止」方針で失敗扱いにする。
            logger.warning(f"minutes-agent: meeting {meeting_id} の文字起こしが空のため failed として扱います")
            return await _handle_failure(meeting_id, None, None, "文字起こしが空")

        # 冪等性: 既に完了済みなら二度目以降は何もしない（Decision/MeetingTask/RAG の重複防止）
        if row["status"] == "completed" and row["transcript"]:
            logger.warning(f"minutes-agent: meeting {meeting_id} は完了済みのため重複コールバックを無視します")
            return "ignored"

        # エージェントは秒を小数(第2位)で送ってくるため丸めてから保存する
        analysis_seconds = None if payload.analysis_seconds is None else int(round(payload.analysis_seconds))
        source = "エージェント申告"
        if analysis_seconds is None and row["agent_dispatched_at"]:
            analysis_seconds = int((now_jst_naive() - row["agent_dispatched_at"]).total_seconds())
            source = "委譲時刻からの実測(待ち時間込み)"
        logger.info(f"minutes-agent: meeting {meeting_id} analysis_seconds={analysis_seconds} ({source})")

        from .meeting_analyzer import finalize_minutes
        await finalize_minutes(
            meeting_id,
            {
                "transcript": payload.transcript,
                "decisions": payload.decisions,
                "tasks": payload.tasks,
                "discussion_points": payload.discussion_points,
                "deadlines": payload.deadlines,
            },
            analysis_seconds=analysis_seconds,
            segment_results=None,
            transcript_prefix=_PENDING_PREFIX.pop(meeting_id, ""),
        )
        _mark(meeting_id, {"agent_dispatched_at": None, "analysis_progress": 100})
        return "completed"


# --- ヘルスチェック（管理画面用） ---

async def agent_health() -> Dict[str, Any]:
    """エージェントサーバーの /health を叩いて状態を返す。トークンは絶対に返さない。"""
    result: Dict[str, Any] = {
        "enabled": is_enabled(),
        "url": agent_url() or None,
        "callback_url": callback_url() or None,
        "token_configured": bool(agent_token()),
        "config_problem": _config_problem(),
        "reachable": False,
        "latency_ms": None,
        "agent": None,
        "error": None,
    }
    if not agent_url():
        result["error"] = "MINUTES_AGENT_URL が未設定です"
        return result

    try:
        timeout = float(_env("MINUTES_AGENT_HEALTH_TIMEOUT", "3"))
    except ValueError:
        timeout = 3.0

    import time
    started = time.time()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{agent_url()}/health")
        result["latency_ms"] = int((time.time() - started) * 1000)
        result["reachable"] = 200 <= resp.status_code < 300
        try:
            result["agent"] = resp.json()
        except Exception:
            result["agent"] = {"raw": resp.text[:500]}
        if not result["reachable"]:
            result["error"] = f"HTTP {resp.status_code}"
    except Exception as e:
        result["latency_ms"] = int((time.time() - started) * 1000)
        result["error"] = f"[{type(e).__name__}] {e}"
    return result
