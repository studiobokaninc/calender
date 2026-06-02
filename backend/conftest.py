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
