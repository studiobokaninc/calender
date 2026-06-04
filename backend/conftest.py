"""Root conftest: stub heavy modules so test collection works without full deps."""
import sys
import types
import importlib.abc
import importlib.machinery


def _make_module(name):
    mod = types.ModuleType(name)
    mod.__path__ = []
    mod.__package__ = name
    mod.__spec__ = None
    return mod


_PKG_PREFIXES = [
    'llama_index', 'llama_index_instrumentation',
    'chromadb', 'fsspec', 'networkx', 'nltk', 'banks',
    'google', 'openai', 'edge_tts',
]


class _StubLoader(importlib.abc.Loader):
    def create_module(self, spec):
        return _make_module(spec.name)

    def exec_module(self, module):
        pass


class _StubFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        for prefix in _PKG_PREFIXES:
            if fullname == prefix or fullname.startswith(prefix + '.'):
                return importlib.machinery.ModuleSpec(fullname, _StubLoader())
        return None


sys.meta_path.insert(0, _StubFinder())

# Pre-stub top-level packages and any already-loaded submodules
for _prefix in _PKG_PREFIXES:
    if _prefix not in sys.modules:
        sys.modules[_prefix] = _make_module(_prefix)
    for _key in list(sys.modules.keys()):
        if _key.startswith(_prefix + '.') and not hasattr(sys.modules[_key], '__path__'):
            sys.modules[_key] = _make_module(_key)

# ── テスト専用 DB 隔離設定 ────────────────────────────────────
# app.database の engine と SessionLocal を in-memory SQLite に差し替えてから
# app.main を import する。こうすることで NTFS/exFAT 上の WAL pragma 失敗を回避し、
# create_all もテスト用 engine で完結する。
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

_SQLALCHEMY_TEST_DATABASE_URL = "sqlite://"  # in-memory: NTFS I/O エラーを回避
_test_engine = create_engine(
    _SQLALCHEMY_TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)

# engine と SessionLocal を差し替え（app.main import より前に実行する必要がある）
import app.database as _app_db
_app_db.engine = _test_engine
_app_db.SessionLocal = TestingSessionLocal

from app.database import Base, get_db
from app.main import app as _fastapi_app  # モデル全登録を確実にするため先に import


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    """セッション開始時にテスト DB テーブルを作成し、終了時に破棄する。"""
    Base.metadata.drop_all(bind=_test_engine)
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)
    _test_engine.dispose()


@pytest.fixture(autouse=True)
def override_get_db():
    """各テスト関数の HTTP リクエストをテスト DB へルーティングする。"""
    def _get_test_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    _fastapi_app.dependency_overrides[get_db] = _get_test_db
    yield
    _fastapi_app.dependency_overrides.clear()
