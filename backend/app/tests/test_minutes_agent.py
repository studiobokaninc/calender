"""議事録生成AIエージェント連携のテスト。

エージェントサーバー(192.168.44.139:8090)が無くても、
カレンダー側の受け口・後処理・冪等性・認証を検証できるようにする。
"""
import os
import pytest

from app import models
from app.timezone import now_jst_naive

AGENT_TOKEN = "test_minutes_agent_token_xyz"


# 注意: app/tests/conftest.py の db/client フィクスチャは、ルート conftest.py が
# app.database.SessionLocal に差し込んだエンジンとは「別の」インメモリDBを使う。
# minutes_agent / finalize_minutes はバックグラウンド実行前提で SessionLocal を
# 直接開くため、HTTP層とサービス層で同じDBを見るよう、ここで上書きする。
@pytest.fixture
def db():
    from app.database import SessionLocal
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def client(db):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def agent_env(monkeypatch, client):
    # 注意: client(TestClient) の lifespan 中に get_llm_client() が
    # load_dotenv(override=True) を呼び、backend/.env の値でプロセス環境変数を
    # 上書きしてしまう。そのため必ず client 起動「後」に設定する。
    monkeypatch.setenv("MINUTES_AGENT_TOKEN", AGENT_TOKEN)
    # RAG登録は外部(Ollama embed)に出るのでテストでは無効化する
    monkeypatch.setattr(
        "app.services.meeting_analyzer.add_meeting_data_to_rag",
        _noop_async,
        raising=True,
    )
    yield


async def _noop_async(*args, **kwargs):
    return None


def _make_meeting(db, status="processing", backend="agent"):
    project = models.Project(name="テストプロジェクト")
    db.add(project)
    db.commit()
    db.refresh(project)

    meeting = models.Meeting(
        project_id=project.id,
        title="テスト会議",
        date=now_jst_naive(),
        status=status,
        analysis_backend=backend,
        agent_dispatched_at=now_jst_naive(),
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


COMPLETED_PAYLOAD = {
    "status": "completed",
    "transcript": "佐藤: 本日の定例を始めます。\n山田: 了解です。",
    "decisions": ["本番リリース日を10月15日に決定"],
    "tasks": ["[design] 佐藤：UIデザインFix（期限: 10月1日）"],
    "discussion_points": ["来月のリリース方針について"],
    "deadlines": ["10月1日", "10月15日"],
    "analysis_seconds": 42,
}


def test_agent_callback_completes_and_runs_post_processing(client, db):
    meeting = _make_meeting(db)

    res = client.patch(
        f"/api/meetings/{meeting.id}",
        json=COMPLETED_PAYLOAD,
        headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
    )
    assert res.status_code == 200, res.text

    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "completed"
    assert "本日の定例" in row.transcript
    assert row.decisions == ["本番リリース日を10月15日に決定"]
    assert row.analysis_seconds == 42

    # 後処理: Decision テーブル
    decisions = db.query(models.Decision).filter(models.Decision.meeting_id == meeting.id).all()
    assert [d.content for d in decisions] == ["本番リリース日を10月15日に決定"]

    # 後処理: MeetingTask (AI推薦タスク) がパースされて入る
    tasks = db.query(models.MeetingTask).filter(models.MeetingTask.meeting_id == meeting.id).all()
    assert len(tasks) == 1
    assert tasks[0].type == "design"
    assert tasks[0].assignee_suggestion == "佐藤"
    assert tasks[0].status == "detected"


def test_agent_callback_is_idempotent(client, db):
    """エージェントが再送しても Decision / MeetingTask が重複しない。"""
    meeting = _make_meeting(db)
    headers = {"Authorization": f"Bearer {AGENT_TOKEN}"}

    first = client.patch(f"/api/meetings/{meeting.id}", json=COMPLETED_PAYLOAD, headers=headers)
    assert first.status_code == 200
    second = client.patch(f"/api/meetings/{meeting.id}", json=COMPLETED_PAYLOAD, headers=headers)
    assert second.status_code == 200  # 再送ストームを避けるため常に200

    db.expire_all()
    assert db.query(models.Decision).filter(models.Decision.meeting_id == meeting.id).count() == 1
    assert db.query(models.MeetingTask).filter(models.MeetingTask.meeting_id == meeting.id).count() == 1


def test_agent_callback_rejects_wrong_token(client, db):
    meeting = _make_meeting(db)
    res = client.patch(
        f"/api/meetings/{meeting.id}",
        json=COMPLETED_PAYLOAD,
        headers={"Authorization": "Bearer totally_wrong_token"},
    )
    assert res.status_code == 401

    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "processing"


def test_empty_transcript_is_treated_as_failure(client, db):
    """空の文字起こしを completed で受け入れると成功状態で固定されるため failed にする。"""
    meeting = _make_meeting(db)
    res = client.patch(
        f"/api/meetings/{meeting.id}",
        json={"status": "completed", "transcript": "   "},
        headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
    )
    assert res.status_code == 200

    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "failed"


def test_failed_callback_without_fallback_marks_failed(client, db, monkeypatch):
    monkeypatch.setenv("MINUTES_AGENT_FALLBACK_ON_FAILED_CALLBACK", "false")
    meeting = _make_meeting(db)

    res = client.patch(
        f"/api/meetings/{meeting.id}",
        json={"status": "failed", "error": "whisper crashed"},
        headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
    )
    assert res.status_code == 200

    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "failed"


def test_agent_only_alias_endpoint(client, db):
    meeting = _make_meeting(db)
    res = client.patch(
        f"/api/minutes-agent/meetings/{meeting.id}",
        json=COMPLETED_PAYLOAD,
        headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["result"] == "completed"

    # JWT では叩けない（エージェント専用）
    res2 = client.patch(
        f"/api/minutes-agent/meetings/{meeting.id}",
        json=COMPLETED_PAYLOAD,
        headers={"Authorization": "Bearer some_user_jwt"},
    )
    assert res2.status_code == 401


def test_agent_token_unset_disables_agent_path(client, db, monkeypatch):
    """MINUTES_AGENT_TOKEN 未設定なら、どんな Bearer でもエージェント扱いにならない。"""
    monkeypatch.delenv("MINUTES_AGENT_TOKEN", raising=False)
    meeting = _make_meeting(db)

    res = client.patch(
        f"/api/meetings/{meeting.id}",
        json=COMPLETED_PAYLOAD,
        headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
    )
    # JWT として検証され、失敗する（＝未設定の環境変数が認可してしまわない）
    assert res.status_code == 401


def test_normalize_minutes_handles_non_string_items():
    """エージェントからの JSON は外部入力。dict が混ざっても落ちない。"""
    from app.services.meeting_analyzer import normalize_minutes

    out = normalize_minutes({
        "transcript": None,
        "decisions": ["  A  ", "", {"text": "B"}],
        "tasks": None,
        "unexpected_key": "捨てられる",
    })
    assert out["transcript"] == ""
    assert out["decisions"][0] == "A"
    assert len(out["decisions"]) == 2
    assert out["tasks"] == []
    assert "unexpected_key" not in out


# --- dispatch（委譲）側のテスト ---

@pytest.fixture
def enabled_agent(monkeypatch, client):
    monkeypatch.setenv("MINUTES_AGENT_ENABLED", "true")
    monkeypatch.setenv("MINUTES_AGENT_URL", "http://192.0.2.1:8090")
    monkeypatch.setenv("MINUTES_AGENT_TOKEN", AGENT_TOKEN)
    monkeypatch.setenv("CALENDAR_PUBLIC_BASE_URL", "http://192.168.44.78:8001")
    yield


@pytest.mark.anyio
async def test_dispatch_falls_back_to_local_when_agent_unreachable(
    enabled_agent, db, tmp_path, monkeypatch, anyio_backend
):
    """エージェントに繋がらない場合、従来のローカル解析に落ちること。"""
    from app.services import minutes_agent

    meeting = _make_meeting(db, status="pending", backend=None)
    audio = tmp_path / "x.webm"
    audio.write_bytes(b"dummy")

    async def boom(*args, **kwargs):
        raise RuntimeError("connection refused")

    calls = {}

    async def fake_local(meeting_id, audio_path, api_key, reason, transcript_prefix=""):
        calls["meeting_id"] = meeting_id
        calls["reason"] = reason

    monkeypatch.setattr(minutes_agent, "_run_local", fake_local)
    monkeypatch.setattr("httpx.AsyncClient.post", boom)

    await minutes_agent.analyze(meeting.id, str(audio), project_id=meeting.project_id)

    assert calls["meeting_id"] == meeting.id
    assert "dispatch失敗" in calls["reason"]


@pytest.mark.anyio
async def test_dispatch_accepted_leaves_meeting_to_agent(
    enabled_agent, db, tmp_path, monkeypatch, anyio_backend
):
    """accepted が返ったらローカル解析は走らず、委譲の記録が残ること。"""
    from app.services import minutes_agent

    meeting = _make_meeting(db, status="pending", backend=None)
    audio = tmp_path / "x.webm"
    audio.write_bytes(b"dummy")

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"status": "accepted", "meeting_id": meeting.id}

    async def fake_post(self, url, **kwargs):
        assert url.endswith("/process_meeting")
        assert kwargs["json"]["callback_url"] == "http://192.168.44.78:8001"
        assert kwargs["json"]["api_token"] == AGENT_TOKEN
        return FakeResponse()

    async def fail_local(*args, **kwargs):
        raise AssertionError("ローカル解析が呼ばれてはいけない")

    monkeypatch.setattr(minutes_agent, "_run_local", fail_local)
    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)
    # watchdog は 6 時間待つタスクなので起動させない
    monkeypatch.setattr(minutes_agent, "_watchdog", _noop_async)

    await minutes_agent.analyze(meeting.id, str(audio), project_id=meeting.project_id)

    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "processing"
    assert row.analysis_backend == "agent"
    assert row.agent_dispatched_at is not None


@pytest.mark.anyio
async def test_dispatch_rejects_localhost_callback_url(
    enabled_agent, db, tmp_path, monkeypatch, anyio_backend
):
    """callback_url が localhost のままなら委譲せずローカルで処理する（静かな失敗の防止）。"""
    from app.services import minutes_agent

    monkeypatch.setenv("CALENDAR_PUBLIC_BASE_URL", "http://localhost:8001")
    meeting = _make_meeting(db, status="pending", backend=None)
    audio = tmp_path / "x.webm"
    audio.write_bytes(b"dummy")

    calls = {}

    async def fake_local(meeting_id, audio_path, api_key, reason, transcript_prefix=""):
        calls["reason"] = reason

    monkeypatch.setattr(minutes_agent, "_run_local", fake_local)
    await minutes_agent.analyze(meeting.id, str(audio), project_id=meeting.project_id)
    assert "到達できない" in calls["reason"]


# --- 音声ファイル解決のテスト ---

def test_resolve_audio_path_accepts_scanner_absolute_path(db, tmp_path, monkeypatch):
    """ネットワークドライブ取込(uuid なし・audio_url が絶対パス)でも音声が解決できること。"""
    from app.routers import meetings as meetings_router

    scan_root = tmp_path / "MTG_audio"
    scan_root.mkdir()
    audio = scan_root / "20260316.m4a"
    audio.write_bytes(b"dummy")

    monkeypatch.setattr(meetings_router, "_audio_allowed_roots", lambda: [scan_root])

    meeting = _make_meeting(db)
    meeting.uuid = None
    meeting.audio_url = str(audio)
    db.commit()

    resolved = meetings_router.resolve_meeting_audio_path(meeting)
    assert resolved is not None
    assert resolved.name == "20260316.m4a"


def test_resolve_audio_path_rejects_path_outside_allowlist(db, tmp_path, monkeypatch):
    """ホワイトリスト外の絶対パスは解決しない（静的トークンでの任意ファイル読み出し防止）。"""
    from app.routers import meetings as meetings_router

    allowed = tmp_path / "allowed"
    allowed.mkdir()
    secret = tmp_path / "secret.env"
    secret.write_bytes(b"OPENAI_API_KEY=sk-xxx")

    monkeypatch.setattr(meetings_router, "_audio_allowed_roots", lambda: [allowed])

    meeting = _make_meeting(db)
    meeting.uuid = None
    meeting.audio_url = str(secret)
    db.commit()

    assert meetings_router.resolve_meeting_audio_path(meeting) is None


def test_task_parsing_strips_fullwidth_due_date():
    """プロンプトが指示する全角括弧「（期限: ...）」も content から除去されること。"""
    from app.services.meeting_analyzer import save_detected_tasks
    from app.database import SessionLocal
    from app import models
    from app.timezone import now_jst_naive

    db = SessionLocal()
    try:
        project = models.Project(name="括弧テスト")
        db.add(project)
        db.commit()
        meeting = models.Meeting(
            project_id=project.id, title="t", date=now_jst_naive(), status="processing"
        )
        db.add(meeting)
        db.commit()

        save_detected_tasks(db, meeting.id, [
            "[design] 佐藤：UIデザインFix（期限: 10月1日）",
            "[fx] 高橋：連携API開発(10月3日)",
        ])
        db.commit()

        rows = db.query(models.MeetingTask).filter(
            models.MeetingTask.meeting_id == meeting.id
        ).order_by(models.MeetingTask.id).all()
        assert rows[0].content == "UIデザインFix"
        assert rows[0].assignee_suggestion == "佐藤"
        assert rows[1].content == "連携API開発"
    finally:
        db.close()


# --- エージェント側回答(2026-09-24)で判明した実際のペイロードへの追従 ---

def test_progress_callback_does_not_kill_the_job(client, db):
    """進捗通知 {"status":"processing","progress":N} で failed にしてはいけない。

    エージェントは 5% から進捗PATCHを送ってくる。transcript が空だからといって
    失敗扱いにすると、すべてのジョブが開始直後に殺される。
    """
    meeting = _make_meeting(db)
    headers = {"Authorization": f"Bearer {AGENT_TOKEN}"}

    for pct in (5, 15, 60, 95):
        res = client.patch(
            f"/api/meetings/{meeting.id}",
            json={"status": "processing", "progress": pct},
            headers=headers,
        )
        assert res.status_code == 200, res.text

    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "processing"
    assert row.analysis_progress == 95
    assert row.transcript is None

    # そのあと完了通知が来れば正常に確定する
    res = client.patch(f"/api/meetings/{meeting.id}", json=COMPLETED_PAYLOAD, headers=headers)
    assert res.status_code == 200
    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "completed"
    assert row.analysis_progress == 100


def test_fractional_analysis_seconds_is_accepted(client, db):
    """エージェントは analysis_seconds を小数(第2位)で送る。int で受けると 422 で全損する。"""
    meeting = _make_meeting(db)
    payload = dict(COMPLETED_PAYLOAD, analysis_seconds=137.42)

    res = client.patch(
        f"/api/meetings/{meeting.id}",
        json=payload,
        headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
    )
    assert res.status_code == 200, res.text

    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "completed"
    assert row.analysis_seconds == 137


def test_error_message_field_is_accepted(client, db, monkeypatch):
    """失敗理由のフィールド名はエージェント側実装では error_message。"""
    monkeypatch.setenv("MINUTES_AGENT_FALLBACK_ON_FAILED_CALLBACK", "false")
    meeting = _make_meeting(db)

    res = client.patch(
        f"/api/meetings/{meeting.id}",
        json={"status": "failed", "error_message": "音声から有効な発話が検出されませんでした。"},
        headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
    )
    assert res.status_code == 200

    db.expire_all()
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting.id).first()
    assert row.status == "failed"


def test_agent_real_task_format_parses(client, db):
    """エージェントが実際に返す書式（全角コロン・全角括弧・期限なし）が正しく分解されること。"""
    meeting = _make_meeting(db)
    payload = dict(COMPLETED_PAYLOAD, tasks=["[タスク] 田中：資料作成（期限なし）"])

    res = client.patch(
        f"/api/meetings/{meeting.id}",
        json=payload,
        headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
    )
    assert res.status_code == 200

    db.expire_all()
    t = db.query(models.MeetingTask).filter(models.MeetingTask.meeting_id == meeting.id).one()
    assert t.assignee_suggestion == "田中"
    assert t.content == "資料作成"


@pytest.mark.anyio
async def test_watchdog_treats_unknown_stage_as_alive(
    enabled_agent, db, monkeypatch, anyio_backend
):
    """エージェントのステージ名(downloading/transcribing/extracting…)を終端と誤判定しないこと。

    列挙式にすると取りこぼす（実機で "extracting" を見落とした）。
    終端(completed/failed 等)でなければ生存とみなす。
    """
    from app.services import minutes_agent

    meeting = _make_meeting(db, status="processing", backend="agent")
    monkeypatch.setattr(minutes_agent, "watchdog_interval_sec", lambda: 0)

    async def fake_job_status(mid):
        return {"meeting_id": mid, "status": "extracting", "progress": 65}

    failed = {}

    async def fake_failure(meeting_id, audio_path, api_key, reason):
        failed["reason"] = reason
        return "failed"

    rearmed = {}

    async def fake_watchdog_rearm(*args, **kwargs):
        rearmed["yes"] = True

    monkeypatch.setattr(minutes_agent, "agent_job_status", fake_job_status)
    monkeypatch.setattr(minutes_agent, "_handle_failure", fake_failure)
    monkeypatch.setattr(minutes_agent, "asyncio", __import__("asyncio"))

    await minutes_agent._watchdog(meeting.id, "/tmp/x.webm", None)
    assert "reason" not in failed, "実行中のジョブを失敗扱いにしてはいけない"

    # 終端ステータスなら失敗として処理される
    async def terminal_job_status(mid):
        return {"meeting_id": mid, "status": "failed"}

    monkeypatch.setattr(minutes_agent, "agent_job_status", terminal_job_status)
    await minutes_agent._watchdog(meeting.id, "/tmp/x.webm", None)
    assert "reason" in failed


def test_agent_meta_statements_are_filtered():
    """エージェントが返す「期限は言及されていない」等のメタ文を構造化項目に入れない。

    ローカル解析(_parse_output)は同じ基準で除去しており、経路で差を出さないための担保。
    実機で deadlines に混入したケースの回帰テスト。
    """
    from app.services.meeting_analyzer import normalize_minutes

    out = normalize_minutes({
        "transcript": "本文",
        "deadlines": ["文字起こし内に具体的な期限は言及されていない", "10月15日"],
        "decisions": ["なし", "リリース日を10月15日に決定"],
        "discussion_points": ["特にありません", "精度のレベルについて"],
    })
    assert out["deadlines"] == ["10月15日"]
    assert out["decisions"] == ["リリース日を10月15日に決定"]
    assert out["discussion_points"] == ["精度のレベルについて"]


def test_normal_content_is_not_over_filtered():
    """メタ文フィルタが正当な抽出結果を巻き込まないこと（過剰除去の回帰テスト）。"""
    from app.services.meeting_analyzer import normalize_minutes

    keep = [
        "クライアントからのフィードバックを待つ",
        "以下の作業をBスタジオに依頼する",
        "中央値で画像を重ねる方式を採用する",
    ]
    out = normalize_minutes({"transcript": "x", "decisions": keep})
    assert out["decisions"] == keep


@pytest.mark.anyio
async def test_watchdog_tolerates_transient_unreachable(
    enabled_agent, db, monkeypatch, anyio_backend
):
    """エージェントへ照会できないだけでは即failedにしない（瞬断でジョブを殺さない）。

    TTLを短くしても安全に運用できることの担保。
    規定回数を超えて照会不能が続いたときだけ失敗として扱う。
    """
    from app.services import minutes_agent

    meeting = _make_meeting(db, status="processing", backend="agent")
    monkeypatch.setattr(minutes_agent, "watchdog_interval_sec", lambda: 0)

    async def unreachable(mid):
        return None

    failed = {}

    async def fake_failure(meeting_id, audio_path, api_key, reason):
        failed["reason"] = reason
        return "failed"

    monkeypatch.setattr(minutes_agent, "agent_job_status", unreachable)
    monkeypatch.setattr(minutes_agent, "_handle_failure", fake_failure)

    # 1回目・2回目は再スケジュールされ、失敗しない
    await minutes_agent._watchdog(meeting.id, "/tmp/x.webm", None, unreachable_strikes=0)
    assert "reason" not in failed
    await minutes_agent._watchdog(meeting.id, "/tmp/x.webm", None, unreachable_strikes=1)
    assert "reason" not in failed

    # 規定回数に達したら失敗として扱う
    await minutes_agent._watchdog(meeting.id, "/tmp/x.webm", None, unreachable_strikes=2)
    assert failed.get("reason") == "タイムアウト"


@pytest.mark.anyio
async def test_watchdog_fails_when_agent_says_done_but_no_callback(
    enabled_agent, db, monkeypatch, anyio_backend
):
    """エージェント側が完了しているのに結果が届かない＝折り返し経路の不通。

    そのまま放置せずフォールバックへ回す。
    """
    from app.services import minutes_agent

    meeting = _make_meeting(db, status="processing", backend="agent")
    monkeypatch.setattr(minutes_agent, "watchdog_interval_sec", lambda: 0)

    async def done(mid):
        return {"meeting_id": mid, "status": "completed", "progress": 100}

    failed = {}

    async def fake_failure(meeting_id, audio_path, api_key, reason):
        failed["reason"] = reason
        return "failed"

    monkeypatch.setattr(minutes_agent, "agent_job_status", done)
    monkeypatch.setattr(minutes_agent, "_handle_failure", fake_failure)

    await minutes_agent._watchdog(meeting.id, "/tmp/x.webm", None)
    assert failed.get("reason") == "タイムアウト"
