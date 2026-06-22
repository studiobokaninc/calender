"""
tests/test_assets_api.py — cmd_544: Casper書込API テスト
CASPER_WRITE_TOKEN 経路と SCORE_READONLY_TOKEN の POST /api/assets スコープ制限を検証。
SKIP=FAIL: 全テストが PASS であること。
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import io
import pytest
from fastapi.testclient import TestClient
from app import models
from app.database import SessionLocal


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def admin_user():
    """既存DBの管理者ユーザーを返す(なければ作成)。"""
    session = SessionLocal()
    try:
        user = session.query(models.User).filter(models.User.role == "admin").first()
        if user is None:
            user = models.User(
                email="testadmin_casper544@example.com",
                hashed_password="hashed_pw",
                name="Test Admin Casper544",
                role="admin",
            )
            session.add(user)
            session.commit()
            session.refresh(user)
        uid = user.id
        return uid
    finally:
        session.close()


@pytest.fixture(scope="module")
def client():
    """FastAPI TestClient(依存関係オーバーライドなし — 実際のトークン検証をテスト)。"""
    from app.main import app as fastapi_app
    with TestClient(fastapi_app) as c:
        yield c


TEST_CASPER_TOKEN = "casper-test-write-token-544"
TEST_READONLY_TOKEN = "readonly-test-token-544"


@pytest.fixture(autouse=True)
def set_env_tokens(monkeypatch):
    monkeypatch.setenv("CASPER_WRITE_TOKEN", TEST_CASPER_TOKEN)
    monkeypatch.setenv("SCORE_READONLY_TOKEN", TEST_READONLY_TOKEN)


# ── Helper ────────────────────────────────────────────────────────────────────

def _small_file():
    return ("test_casper_upload.txt", io.BytesIO(b"casper test"), "text/plain")


# ── POST /api/assets 正常系 ────────────────────────────────────────────────────

def test_casper_write_token_assets_creates_201(client, admin_user):
    """CASPER_WRITE_TOKEN + X-Actor-User-Id → 201 Created"""
    fname, fbytes, ftype = _small_file()
    resp = client.post(
        "/api/assets",
        files={"file": (fname, fbytes, ftype)},
        data={"data": '{"task_id": null, "version": "casper-test"}'},
        headers={
            "Authorization": f"Bearer {TEST_CASPER_TOKEN}",
            "X-Actor-User-Id": str(admin_user),
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert "id" in body
    assert body["version"] == "casper-test"
    assert body["created_by"] == admin_user

    # 後片付け: DB レコード削除
    session = SessionLocal()
    try:
        session.query(models.Asset).filter(models.Asset.id == body["id"]).delete()
        session.commit()
    finally:
        session.close()


def test_casper_write_token_assets_data_json_optional_fields(client, admin_user):
    """data JSON でフィールドを渡さない場合も 201 (version はデフォルト "1")"""
    fname, fbytes, ftype = _small_file()
    resp = client.post(
        "/api/assets",
        files={"file": (fname, io.BytesIO(b"x"), ftype)},
        data={"data": "{}"},
        headers={
            "Authorization": f"Bearer {TEST_CASPER_TOKEN}",
            "X-Actor-User-Id": str(admin_user),
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version"] == "1"

    session = SessionLocal()
    try:
        session.query(models.Asset).filter(models.Asset.id == body["id"]).delete()
        session.commit()
    finally:
        session.close()


# ── POST /api/assets 異常系 ────────────────────────────────────────────────────

def test_readonly_token_post_assets_returns_401(client):
    """SCORE_READONLY_TOKEN で POST /api/assets → 401 (JWT decode 失敗、casperトークンとも不一致)"""
    fname, fbytes, ftype = _small_file()
    resp = client.post(
        "/api/assets",
        files={"file": (fname, fbytes, ftype)},
        data={"version": "1"},
        headers={"Authorization": f"Bearer {TEST_READONLY_TOKEN}"},
    )
    assert resp.status_code == 401, resp.text


def test_casper_token_missing_actor_header_returns_400(client):
    """CASPER_WRITE_TOKEN + X-Actor-User-Id 欠落 → 400"""
    fname, fbytes, ftype = _small_file()
    resp = client.post(
        "/api/assets",
        files={"file": (fname, fbytes, ftype)},
        data={"version": "1"},
        headers={"Authorization": f"Bearer {TEST_CASPER_TOKEN}"},
    )
    assert resp.status_code == 400, resp.text


def test_no_token_post_assets_returns_401(client):
    """トークン無し → 401"""
    fname, fbytes, ftype = _small_file()
    resp = client.post(
        "/api/assets",
        files={"file": (fname, fbytes, ftype)},
        data={"version": "1"},
    )
    assert resp.status_code == 401, resp.text


def test_casper_token_delete_asset_returns_401(client, admin_user):
    """CASPER_WRITE_TOKEN で DELETE /api/assets/{id} → 401 (get_current_user 経路 — JWT decode 失敗)"""
    resp = client.delete(
        "/api/assets/99999",
        headers={
            "Authorization": f"Bearer {TEST_CASPER_TOKEN}",
            "X-Actor-User-Id": str(admin_user),
        },
    )
    assert resp.status_code == 401, resp.text


def test_casper_token_get_assets_returns_401(client):
    """CASPER_WRITE_TOKEN で GET /api/assets → 401 (get_actor_user_id→get_current_user 経路外)"""
    resp = client.get(
        "/api/assets",
        headers={"Authorization": f"Bearer {TEST_CASPER_TOKEN}"},
    )
    assert resp.status_code == 401, resp.text


def test_casper_token_admin_only_ep_returns_401(client, admin_user):
    """CASPER_WRITE_TOKEN で admin 限定 EP (PATCH /api/troubles/{id}/reopen) → 401"""
    resp = client.patch(
        "/api/troubles/99999/reopen",
        headers={
            "Authorization": f"Bearer {TEST_CASPER_TOKEN}",
            "X-Actor-User-Id": str(admin_user),
        },
    )
    assert resp.status_code == 401, resp.text


# ── POST /api/reference_materials 正常系 ──────────────────────────────────────

def test_casper_write_token_reference_materials_creates_201(client, admin_user):
    """CASPER_WRITE_TOKEN + X-Actor-User-Id → 201 Created for /api/reference_materials"""
    resp = client.post(
        "/api/reference_materials",
        json={
            "title": "Casper test ref",
            "media_type": "url",
            "file_path": "https://example.com/ref.pdf",
        },
        headers={
            "Authorization": f"Bearer {TEST_CASPER_TOKEN}",
            "X-Actor-User-Id": str(admin_user),
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Casper test ref"
    assert body["created_by"] == admin_user

    session = SessionLocal()
    try:
        session.query(models.ReferenceMaterial).filter(models.ReferenceMaterial.id == body["id"]).delete()
        session.commit()
    finally:
        session.close()


# ── POST /api/reference_materials 異常系 ──────────────────────────────────────

def test_casper_token_ref_materials_missing_actor_returns_400(client):
    """CASPER_WRITE_TOKEN + X-Actor-User-Id 欠落 → 400 for /api/reference_materials"""
    resp = client.post(
        "/api/reference_materials",
        json={
            "title": "fail ref",
            "media_type": "url",
            "file_path": "https://example.com/x",
        },
        headers={"Authorization": f"Bearer {TEST_CASPER_TOKEN}"},
    )
    assert resp.status_code == 400, resp.text
