"""Tests for backend/app/utils/webhook_sender.py"""
import asyncio
import hashlib
import hmac
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx

# Ensure app package is importable when running from backend/tests/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.webhook_sender import send_webhook, _build_signature


def run(coro):
    """Run a coroutine in a fresh event loop."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# 1. HMAC 署名が正しく生成されること
# ---------------------------------------------------------------------------

def test_build_signature_correct():
    secret = "mysecret"
    body = '{"event_type":"event.created"}'
    expected = "sha256=" + hmac.new(
        secret.encode(), body.encode(), hashlib.sha256
    ).hexdigest()
    assert _build_signature(body, secret) == expected


# ---------------------------------------------------------------------------
# 2. WEBHOOK_URL 未設定時はスキップ (送信なし)
# ---------------------------------------------------------------------------

def test_skip_when_url_not_set(monkeypatch):
    monkeypatch.delenv("WEBHOOK_URL", raising=False)
    monkeypatch.delenv("WEBHOOK_SECRET", raising=False)

    with patch("httpx.AsyncClient") as mock_client:
        run(send_webhook("event.created", {"data": {}}))
        mock_client.assert_not_called()


def test_skip_when_secret_not_set(monkeypatch):
    monkeypatch.setenv("WEBHOOK_URL", "http://example.com/webhook")
    monkeypatch.delenv("WEBHOOK_SECRET", raising=False)

    with patch("httpx.AsyncClient") as mock_client:
        run(send_webhook("event.created", {"data": {}}))
        mock_client.assert_not_called()


# ---------------------------------------------------------------------------
# 3. 200 レスポンスで正常終了
# ---------------------------------------------------------------------------

def test_success_on_200(monkeypatch):
    monkeypatch.setenv("WEBHOOK_URL", "http://example.com/webhook")
    monkeypatch.setenv("WEBHOOK_SECRET", "testsecret")

    mock_response = MagicMock()
    mock_response.status_code = 200

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_response)

    with patch("app.utils.webhook_sender.httpx.AsyncClient") as mock_client_cls:
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        run(send_webhook("event.created", {"calendar_project_id": 1, "data": {"event_id": 42}}))

    # Only 1 POST call (no retries on success)
    assert mock_client_instance.post.call_count == 1
    call_args = mock_client_instance.post.call_args
    assert call_args[0][0] == "http://example.com/webhook"


# ---------------------------------------------------------------------------
# 4. 500 エラーで 3回 retry して本体例外なし
# ---------------------------------------------------------------------------

def test_retry_on_500_no_exception(monkeypatch):
    monkeypatch.setenv("WEBHOOK_URL", "http://example.com/webhook")
    monkeypatch.setenv("WEBHOOK_SECRET", "testsecret")

    mock_response = MagicMock()
    mock_response.status_code = 500

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_response)

    with patch("app.utils.webhook_sender.httpx.AsyncClient") as mock_client_cls, \
         patch("app.utils.webhook_sender.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        # Should not raise
        run(send_webhook("event.created", {"data": {}}))

    # 1 initial + 3 retries = 4 total attempts
    assert mock_client_instance.post.call_count == 4
    # 3 sleeps between retries
    assert mock_sleep.call_count == 3


# ---------------------------------------------------------------------------
# 5. httpx タイムアウトが発生しても本体例外なし
# ---------------------------------------------------------------------------

def test_no_exception_on_timeout(monkeypatch):
    monkeypatch.setenv("WEBHOOK_URL", "http://example.com/webhook")
    monkeypatch.setenv("WEBHOOK_SECRET", "testsecret")

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))

    with patch("app.utils.webhook_sender.httpx.AsyncClient") as mock_client_cls, \
         patch("app.utils.webhook_sender.asyncio.sleep", new_callable=AsyncMock):
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        # Should not raise despite all attempts timing out
        run(send_webhook("dm_thread.new_message", {"data": {}}))

    # All 4 attempts were made
    assert mock_client_instance.post.call_count == 4
