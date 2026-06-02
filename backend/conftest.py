"""Root conftest: stub heavy modules so test collection works without full deps."""
import sys
import types
from unittest.mock import MagicMock


def _make_module(name):
    mod = types.ModuleType(name)
    mod.__path__ = []
    mod.__package__ = name
    mod.__spec__ = None
    return mod


_PKG_PREFIXES = [
    'llama_index', 'llama_index_instrumentation',
    'chromadb', 'fsspec', 'networkx', 'nltk', 'banks',
    'google', 'openai', 'edge_tts', 'holidays',
]

for _prefix in _PKG_PREFIXES:
    if _prefix not in sys.modules:
        sys.modules[_prefix] = _make_module(_prefix)
    # Ensure any already-present submodule stubs are packages too
    for _key in list(sys.modules.keys()):
        if _key.startswith(_prefix + '.') and not hasattr(sys.modules[_key], '__path__'):
            sys.modules[_key] = _make_module(_key)
