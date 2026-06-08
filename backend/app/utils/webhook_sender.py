import asyncio
import hashlib
import hmac
import json
import logging
import os
import threading
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

_BACKOFF_DELAYS = [1, 2, 4]


def _get_config() -> tuple[str, str]:
    return os.getenv("CALENDAR_WEBHOOK_URL", ""), os.getenv("CALENDAR_WEBHOOK_SECRET", "")


def _build_signature(body: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return digest


async def send_webhook(event_type: str, payload: dict) -> None:
    """Send signed webhook to WEBHOOK_URL. Silently skips if env vars unset.
    Retries up to 3 times on 5xx; never propagates exceptions to caller."""
    url, secret = _get_config()
    if not url or not secret:
        return

    envelope = {
        "event": event_type,
        "payload": payload,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    body = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
    signature = _build_signature(body, secret)
    headers = {
        "Content-Type": "application/json",
        "X-Calendar-Signature": signature,
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            for attempt in range(4):  # 1 initial + 3 retries
                if attempt > 0:
                    await asyncio.sleep(_BACKOFF_DELAYS[attempt - 1])
                try:
                    resp = await client.post(url, content=body.encode(), headers=headers)
                    if resp.status_code < 500:
                        if resp.status_code >= 400:
                            logger.warning("webhook 4xx: event_type=%s status=%s", event_type, resp.status_code)
                        return
                    logger.warning("webhook 5xx: event_type=%s status=%s attempt=%s", event_type, resp.status_code, attempt + 1)
                except httpx.TimeoutException:
                    logger.warning("webhook timeout: event_type=%s attempt=%s", event_type, attempt + 1)
                except Exception as exc:
                    logger.warning("webhook error: event_type=%s error=%s", event_type, exc)
                    return
            logger.warning("webhook failed after retries: event_type=%s", event_type)
    except Exception:
        pass


def send_webhook_in_thread(event_type: str, payload: dict) -> None:
    """Sync wrapper — runs send_webhook in a daemon thread (for sync route handlers)."""
    def _run():
        try:
            asyncio.run(send_webhook(event_type, payload))
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True).start()
