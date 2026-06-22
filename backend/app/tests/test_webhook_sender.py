import asyncio
import hashlib
import hmac
import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.utils.webhook_sender import _build_signature, send_webhook

pytestmark = pytest.mark.anyio


# ─── Test 1: signature is raw hex, no sha256= prefix ───────────────────────

def test_build_signature_is_raw_hex():
    secret = "DUMMY_SECRET_FOR_TEST_ONLY"
    body = "test body"
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    result = _build_signature(body, secret)
    assert not result.startswith("sha256="), "signature must NOT have sha256= prefix"
    assert result == expected


# ─── Helpers ────────────────────────────────────────────────────────────────

def _make_mock_response(status_code: int) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    return resp


# ─── Test 2: envelope structure {"event", "payload", "timestamp"} ───────────

async def test_send_webhook_envelope_structure():
    captured = {}

    async def fake_post(url, *, content, headers):
        captured["body"] = json.loads(content.decode())
        return _make_mock_response(200)

    with patch.dict("os.environ", {
        "CALENDAR_WEBHOOK_URL": "http://example.test/hook",
        "CALENDAR_WEBHOOK_SECRET": "DUMMY_SECRET_FOR_TEST_ONLY",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(side_effect=fake_post)
            mock_client_cls.return_value = mock_client

            await send_webhook("event.created", {"event_id": 1})

    assert "event" in captured["body"]
    assert "payload" in captured["body"]
    assert "timestamp" in captured["body"]
    assert captured["body"]["event"] == "event.created"
    assert captured["body"]["payload"]["event_id"] == 1


# ─── Test 3: event payload uses Score field names ───────────────────────────

async def test_send_webhook_event_payload_score_fields():
    event_payload = {
        "event_id": 42,
        "title": "Team Sync",
        "start_at": "2026-06-01T10:00:00+00:00",
        "end_at": "2026-06-01T11:00:00+00:00",
        "attendees": [1, 2, 3],
    }
    captured = {}

    async def fake_post(url, *, content, headers):
        captured["body"] = json.loads(content.decode())
        return _make_mock_response(200)

    with patch.dict("os.environ", {
        "CALENDAR_WEBHOOK_URL": "http://example.test/hook",
        "CALENDAR_WEBHOOK_SECRET": "DUMMY_SECRET_FOR_TEST_ONLY",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(side_effect=fake_post)
            mock_client_cls.return_value = mock_client

            await send_webhook("event.created", event_payload)

    payload = captured["body"]["payload"]
    for field in ("start_at", "end_at", "attendees"):
        assert field in payload, f"missing Score field: {field}"


# ─── Test 4: dm payload uses Score field names ──────────────────────────────

async def test_send_webhook_dm_payload_score_fields():
    dm_payload = {
        "thread_id": 10001,
        "message_id": 99,
        "sender_id": 1,
        "participants": [1, 2],
        "body": "Hello",
        "created_at": "2026-06-01T10:00:00",
    }
    captured = {}

    async def fake_post(url, *, content, headers):
        captured["body"] = json.loads(content.decode())
        return _make_mock_response(200)

    with patch.dict("os.environ", {
        "CALENDAR_WEBHOOK_URL": "http://example.test/hook",
        "CALENDAR_WEBHOOK_SECRET": "DUMMY_SECRET_FOR_TEST_ONLY",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(side_effect=fake_post)
            mock_client_cls.return_value = mock_client

            await send_webhook("dm_thread.new_message", dm_payload)

    payload = captured["body"]["payload"]
    for field in ("participants", "thread_id", "message_id", "sender_id", "body", "created_at"):
        assert field in payload, f"missing Score field: {field}"


# ─── Test 5: 4xx stops immediately (no retry) ───────────────────────────────

async def test_send_webhook_4xx_no_retry():
    call_count = 0

    async def fake_post(url, *, content, headers):
        nonlocal call_count
        call_count += 1
        return _make_mock_response(400)

    with patch.dict("os.environ", {
        "CALENDAR_WEBHOOK_URL": "http://example.test/hook",
        "CALENDAR_WEBHOOK_SECRET": "DUMMY_SECRET_FOR_TEST_ONLY",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(side_effect=fake_post)
            mock_client_cls.return_value = mock_client

            await send_webhook("event.created", {"event_id": 1})

    assert call_count == 1, f"4xx must stop immediately; got {call_count} call(s)"


# ─── Test 6: 5xx retries up to 4 total attempts ─────────────────────────────

async def test_send_webhook_5xx_retries_up_to_4():
    call_count = 0

    async def fake_post(url, *, content, headers):
        nonlocal call_count
        call_count += 1
        return _make_mock_response(503)

    with patch.dict("os.environ", {
        "CALENDAR_WEBHOOK_URL": "http://example.test/hook",
        "CALENDAR_WEBHOOK_SECRET": "DUMMY_SECRET_FOR_TEST_ONLY",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(side_effect=fake_post)
            mock_client_cls.return_value = mock_client
            with patch("asyncio.sleep", new_callable=AsyncMock):
                await send_webhook("event.created", {"event_id": 1})

    assert call_count == 4, f"5xx must retry 3 times (4 total); got {call_count} call(s)"


# ─── Test 7: exceptions never propagate outside send_webhook ────────────────

async def test_send_webhook_exception_does_not_propagate():
    with patch.dict("os.environ", {
        "CALENDAR_WEBHOOK_URL": "http://example.test/hook",
        "CALENDAR_WEBHOOK_SECRET": "DUMMY_SECRET_FOR_TEST_ONLY",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(side_effect=RuntimeError("network down"))
            mock_client_cls.return_value = mock_client

            # Must not raise
            await send_webhook("event.created", {"event_id": 1})


# ─── Test 8: skip send when env vars unset ──────────────────────────────────

async def test_send_webhook_skips_when_env_unset():
    call_count = 0

    async def fake_post(url, *, content, headers):
        nonlocal call_count
        call_count += 1
        return _make_mock_response(200)

    import os
    env_backup = {}
    for key in ("CALENDAR_WEBHOOK_URL", "CALENDAR_WEBHOOK_SECRET"):
        env_backup[key] = os.environ.pop(key, None)

    try:
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(side_effect=fake_post)
            mock_client_cls.return_value = mock_client

            await send_webhook("event.created", {"event_id": 1})
    finally:
        for key, val in env_backup.items():
            if val is not None:
                os.environ[key] = val

    assert call_count == 0, "must skip HTTP call when env vars are not set"


# ─── Test 9: exception logging format ───────────────────────────────────────

async def test_send_webhook_logs_exception_class_name():
    with patch.dict("os.environ", {
        "CALENDAR_WEBHOOK_URL": "http://example.test/hook",
        "CALENDAR_WEBHOOK_SECRET": "DUMMY_SECRET_FOR_TEST_ONLY",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls, \
             patch("app.utils.webhook_sender.logger.warning") as mock_warning:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            
            # Use an exception with an empty string representation
            from httpx import ReadError
            mock_client.post = AsyncMock(side_effect=ReadError(""))
            mock_client_cls.return_value = mock_client

            await send_webhook("event.created", {"event_id": 1})

            # Check that logger.warning was called to log the exception type
            mock_warning.assert_called_with(
                "webhook error: event_type=%s error=%s", 
                "event.created", 
                "ReadError"
            )


async def test_send_webhook_logs_exception_class_and_message():
    with patch.dict("os.environ", {
        "CALENDAR_WEBHOOK_URL": "http://example.test/hook",
        "CALENDAR_WEBHOOK_SECRET": "DUMMY_SECRET_FOR_TEST_ONLY",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls, \
             patch("app.utils.webhook_sender.logger.warning") as mock_warning:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(side_effect=RuntimeError("some message"))
            mock_client_cls.return_value = mock_client

            await send_webhook("event.created", {"event_id": 1})

            mock_warning.assert_called_with(
                "webhook error: event_type=%s error=%s", 
                "event.created", 
                "RuntimeError: some message"
            )

