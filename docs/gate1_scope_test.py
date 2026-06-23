#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GATE-1 Scope Propagation Test (v4)

Purpose: Verify that _auth_scope (ContextVar) propagates correctly from
         ASGI middleware to FastMCP tool execution.

Usage:
  cd E:\\calender
  python3 docs/gate1_scope_test.py

Tokens are loaded automatically from backend/.env (no manual input needed).
"""

import os
import sys
import httpx
import json
from pathlib import Path

# stdout UTF-8 (Windows CP932 workaround)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Load backend/.env automatically
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / "backend" / ".env"
    load_dotenv(dotenv_path=env_path)
    print(f"[.env] loaded: {env_path}")
except ImportError:
    print("[.env] python-dotenv not installed. Set env vars manually.")

HOST = "http://192.168.44.253:8001"
MCP_URL = f"{HOST}/mcp/"  # trailing slash required (no slash -> 307 redirect)

WRITE_TOKEN = os.getenv("CASPER_WRITE_TOKEN", "")
READ_TOKEN  = os.getenv("SCORE_READONLY_TOKEN", "")

print(f"[token] CASPER_WRITE_TOKEN:   {'SET (len=' + str(len(WRITE_TOKEN)) + ')' if WRITE_TOKEN else 'NOT SET <-- check .env'}")
print(f"[token] SCORE_READONLY_TOKEN: {'SET (len=' + str(len(READ_TOKEN))  + ')' if READ_TOKEN  else 'NOT SET <-- check .env'}")

if not WRITE_TOKEN or not READ_TOKEN:
    print("\n[ERROR] Token(s) not set. Check: " + str(Path(__file__).parent.parent / "backend" / ".env"))
    sys.exit(1)

REQ_ID = 0

def next_id():
    global REQ_ID
    REQ_ID += 1
    return REQ_ID


def mcp_session(token, label):
    """MCP Streamable HTTP handshake: initialize -> mcp-session-id -> notifications/initialized"""
    headers = {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    resp = httpx.post(
        MCP_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": next_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "gate1-test", "version": "4.0"},
            },
        },
        follow_redirects=True,
        timeout=15,
    )
    print(f"  [{label}] initialize -> HTTP {resp.status_code}")
    if not resp.is_success:
        print(f"  [FAIL] {resp.text[:150]}")
        if resp.status_code == 401:
            print("  NOTE: 401 = token mismatch or server not reading .env")
        return None

    session_id = resp.headers.get("mcp-session-id")
    if not session_id:
        print(f"  [FAIL] no mcp-session-id header: {resp.text[:100]}")
        return None

    hs_headers = dict(headers)
    hs_headers["mcp-session-id"] = session_id
    httpx.post(
        MCP_URL,
        headers=hs_headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
        follow_redirects=True,
        timeout=10,
    )
    print(f"  [OK] session: {session_id[:24]}...")
    return session_id


def call_tool(token, session_id, tool, arguments, label):
    headers = {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "mcp-session-id": session_id,
    }
    resp = httpx.post(
        MCP_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": next_id(),
            "method": "tools/call",
            "params": {"name": tool, "arguments": arguments},
        },
        follow_redirects=True,
        timeout=15,
    )
    print(f"\n{'='*55}")
    print(f"[{label}]  HTTP {resp.status_code}")
    try:
        # SSE (text/event-stream) or plain JSON
        body = resp.text.strip()
        if body.startswith("event:"):
            # Extract "data: {...}" line from SSE stream
            for line in body.splitlines():
                if line.startswith("data:"):
                    body = line[len("data:"):].strip()
                    break
        result = json.loads(body)
        content = result.get("result", {}).get("content", [])
        text = content[0].get("text", "") if content else json.dumps(result)
        try:
            data = json.loads(text)
        except Exception:
            data = text
        print(f"Body: {json.dumps(data, ensure_ascii=False)[:300]}")
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"Parse error: {e} / raw: {resp.text[:200]}")
        return {}


def judge(data, expect_blocked):
    is_scope_err = bool(data.get("isError")) and "CASPER_WRITE_TOKEN" in str(data.get("error", ""))
    if expect_blocked:
        ok = is_scope_err
        result = "[PASS]" if ok else "[FAIL]"
        detail = "scope blocked (expected)" if ok else "NOT blocked -- expected isError + CASPER_WRITE_TOKEN msg"
        print(f"-> {result}: {detail}")
    else:
        ok = not is_scope_err
        if ok:
            print("-> [PASS] [GATE-1 OK]: scope passed -- ContextVar propagation confirmed")
        else:
            print("-> [FAIL] [GATE-1 NG]: write token blocked by scope -- ContextVar NOT propagating -> redesign needed")
    return ok


def main():
    print("\n" + "=" * 55)
    print("GATE-1 Scope Propagation Test v4")
    print(f"MCP endpoint: {MCP_URL}")
    results = []

    # TEST 0: /health tool count
    print(f"\n[TEST 0] GET {HOST}/health")
    r = httpx.get(f"{HOST}/health", timeout=10)
    h = r.json()
    print(f"  -> {h}")
    ok0 = h.get("tools") == 6
    print(f"  {'[PASS]' if ok0 else '[FAIL]'}: tools={h.get('tools')} (expected: 6)")
    results.append(("health tools=6", ok0))

    # write token session
    print("\n[WRITE session handshake]")
    wsid = mcp_session(WRITE_TOKEN, "write")
    if wsid:
        d1 = call_tool(WRITE_TOKEN, wsid, "upload_asset",
                       {"file_path": "/nonexistent/gate1_test.txt", "actor_id": 1},
                       "TEST 1: write -> upload_asset")
        results.append(("write->upload_asset scope pass [GATE-1]", judge(d1, expect_blocked=False)))

        d4 = call_tool(WRITE_TOKEN, wsid, "get_projects", {"limit": 1},
                       "TEST 4: write -> get_projects")
        ok4 = "total" in d4 or "items" in d4
        print(f"-> {'[PASS]' if ok4 else '[FAIL]'}: {'normal response' if ok4 else 'unexpected response'}")
        results.append(("write->get_projects normal", ok4))
    else:
        results.append(("write session [GATE-1]", False))
        print("  NOTE: write session failed -- check if server .env has CASPER_WRITE_TOKEN")

    # read token session
    print("\n[READ session handshake]")
    rsid = mcp_session(READ_TOKEN, "read")
    if rsid:
        d2 = call_tool(READ_TOKEN, rsid, "upload_asset",
                       {"file_path": "/nonexistent/gate1_test.txt", "actor_id": 1},
                       "TEST 2: read -> upload_asset (expect scope block)")
        results.append(("read->upload_asset scope blocked", judge(d2, expect_blocked=True)))

        d3 = call_tool(READ_TOKEN, rsid, "get_projects", {"limit": 1},
                       "TEST 3: read -> get_projects")
        ok3 = "total" in d3 or "items" in d3
        print(f"-> {'[PASS]' if ok3 else '[FAIL]'}: {'normal response' if ok3 else 'unexpected response'}")
        results.append(("read->get_projects normal", ok3))
    else:
        results.append(("read session", False))

    # Summary
    print(f"\n{'='*55}")
    print("=== SUMMARY ===")
    for name, ok in results:
        print(f"  {'[PASS]' if ok else '[FAIL]'} {name}")

    all_pass = all(ok for _, ok in results)
    if all_pass:
        print("\n[SUCCESS] All PASS -> SEC-1 resolved -> write/DM tools ready for announcement")
    else:
        print("\n[INCOMPLETE] See FAIL items above")
        gate1 = next((ok for n, ok in results if "GATE-1" in n), None)
        if gate1 is False:
            print("  GATE-1 NG: ContextVar not propagating -> redesign with FastMCP request context")


if __name__ == "__main__":
    main()
