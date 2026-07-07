import os
import logging
import asyncio
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

from llama_index.core import VectorStoreIndex, StorageContext, Document, load_index_from_storage
from llama_index.llms.gemini import Gemini
from llama_index.embeddings.gemini import GeminiEmbedding
from llama_index.llms.openai import OpenAI
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.core.settings import Settings

logger = logging.getLogger(__name__)

# Constants
_DEFAULT_PERSIST_DIR_GEMINI = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "rag_index")
_DEFAULT_PERSIST_DIR_OPENAI = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "rag_index_openai")

class RAGService:
    def __init__(self):
        self.api_key: Optional[str] = None
        self.provider: str = "google"
        self.index: Optional[VectorStoreIndex] = None
        self._initialized: bool = False
        self._lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self.persist_dir: str = _DEFAULT_PERSIST_DIR_GEMINI

    async def _ensure_initialized(self):
        if self._initialized:
            return
        
        async with self._lock:
            if self._initialized:
                return

            env_path = Path(__file__).resolve().parent.parent.parent / ".env"
            load_dotenv(dotenv_path=str(env_path), override=True)
            
            openai_key = os.environ.get("OPENAI_API_KEY")
            google_key = os.environ.get("GOOGLE_API_KEY")
            anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
            llm_provider_env = os.getenv("LLM_PROVIDER", "").lower()

            if llm_provider_env == "local":
                # 完全ローカル動作（Ollama LLM + ローカル埋め込み）。APIキー不要。
                # 依存パッケージは遅延インポート（未導入でもアプリ起動は壊さない）:
                #   pip install llama-index-llms-ollama
                #   埋め込みが huggingface の場合: pip install llama-index-embeddings-huggingface
                #   埋め込みが ollama の場合:      pip install llama-index-embeddings-ollama
                print("RAGService: ローカル (Ollama LLM + ローカル埋め込み) を初期化中...")
                from llama_index.llms.ollama import Ollama
                self.provider = "local"
                self.api_key = None
                persist_dir = os.path.join(str(Path(__file__).resolve().parent.parent.parent), "data", "rag_index_local")
                # CALENDER_LLM_BASE_URL 優先、旧 LOCAL_LLM_BASE_URL は未移行環境向けフォールバック
                base_url = (
                    os.getenv("CALENDER_LLM_BASE_URL")
                    or os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1")
                ).rstrip("/")
                # Ollama ネイティブAPIは /v1 サフィックス無しのベースURLを使う
                ollama_base = base_url[:-3].rstrip("/") if base_url.endswith("/v1") else base_url
                model_name = os.getenv("LOCAL_LLM_MODEL", "qwen2.5:7b")
                Settings.llm = Ollama(model=model_name, base_url=ollama_base, request_timeout=300.0)

                embed_backend = os.getenv("LOCAL_EMBED_BACKEND", "huggingface").lower()
                if embed_backend == "ollama":
                    from llama_index.embeddings.ollama import OllamaEmbedding
                    embed_model_name = os.getenv("LOCAL_EMBED_MODEL", "nomic-embed-text")
                    Settings.embed_model = OllamaEmbedding(model_name=embed_model_name, base_url=ollama_base)
                    print(f"RAGService: ローカル埋め込み = Ollama {embed_model_name}")
                else:
                    from llama_index.embeddings.huggingface import HuggingFaceEmbedding
                    embed_model_name = os.getenv("LOCAL_EMBED_MODEL", "BAAI/bge-m3")
                    Settings.embed_model = HuggingFaceEmbedding(model_name=embed_model_name)
                    print(f"RAGService: ローカル埋め込み = HuggingFace {embed_model_name}")
            elif anthropic_key and anthropic_key.startswith("sk-ant-"):
                print("RAGService: Anthropic (Claude / HuggingFace BGE) を初期化中...")
                from llama_index.llms.anthropic import Anthropic
                from llama_index.embeddings.huggingface import HuggingFaceEmbedding
                self.provider = "anthropic"
                self.api_key = anthropic_key
                persist_dir = os.path.join(str(Path(__file__).resolve().parent.parent.parent), "data", "rag_index_anthropic")
                model_name = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
                Settings.llm = Anthropic(model=model_name, api_key=self.api_key)
                Settings.embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-m3")
            elif openai_key and openai_key.startswith("sk-"):
                print("RAGService: OpenAI (gpt-4o / text-embedding-3-small) を初期化中...")
                self.provider = "openai"
                self.api_key = openai_key
                persist_dir = _DEFAULT_PERSIST_DIR_OPENAI
                model_name = os.getenv("OPENAI_MODEL", "gpt-4o")
                Settings.llm = OpenAI(model=model_name, api_key=self.api_key)
                Settings.embed_model = OpenAIEmbedding(model="text-embedding-3-small", api_key=self.api_key)
            else:
                print("RAGService: Gemini (2.0-flash) を初期化中...")
                self.provider = "google"
                self.api_key = google_key
                persist_dir = _DEFAULT_PERSIST_DIR_GEMINI
                Settings.llm = Gemini(model="models/gemini-2.0-flash", api_key=self.api_key, transport="rest")
                Settings.embed_model = GeminiEmbedding(model_name="models/gemini-embedding-001", api_key=self.api_key, transport="rest")

            self.persist_dir = persist_dir
            try:
                os.makedirs(persist_dir, exist_ok=True)
                if os.path.exists(os.path.join(persist_dir, "docstore.json")):
                    print(f"RAGService: 既存のインデックスを読み込み中 ({persist_dir})...")
                    def _load():
                        sc = StorageContext.from_defaults(persist_dir=persist_dir)
                        return load_index_from_storage(sc)
                    self.index = await asyncio.wait_for(asyncio.to_thread(_load), timeout=300.0)
                else:
                    self.index = None
                
                self._initialized = True
            except asyncio.TimeoutError:
                logger.error(f"RAG init error: Loading index from storage timed out after 300 seconds.")
                self.index = None
                self._initialized = True
            except Exception as e:
                import traceback
                logger.error(f"RAG init error: {e}\n{traceback.format_exc()}")
                self.index = None
                self._initialized = True

    async def add_text(self, text: str, metadata: Optional[Dict[str, Any]] = None):
        doc = Document(text=text, metadata=metadata or {})
        return await self.add_documents([doc])

    async def add_documents(self, documents: List[Document]):
        await self._ensure_initialized()
        async with self._write_lock:
            try:
                if self.index is None:
                    self.index = await asyncio.wait_for(
                        asyncio.to_thread(VectorStoreIndex.from_documents, documents),
                        timeout=180.0
                    )
                else:
                    for doc in documents:
                        await asyncio.wait_for(asyncio.to_thread(self.index.insert, doc), timeout=120.0)
                
                await asyncio.to_thread(self.index.storage_context.persist, persist_dir=self.persist_dir)
                return True
            except Exception as e:
                logger.error(f"RAG add error: {e}")
                return False

    async def delete_item(self, item_id: int):
        await self._ensure_initialized()
        if not self.index: return True
        async with self._write_lock:
            try:
                docstore = self.index.storage_context.docstore
                to_delete = []
                for node_id, node in docstore.docs.items():
                    if node.metadata.get("item_id") == item_id:
                        ref_id = node.ref_doc_id
                        if ref_id and ref_id not in to_delete: to_delete.append(ref_id)
                for ref_id in to_delete:
                    self.index.delete_ref_doc(ref_id, delete_from_docstore=True)
                await asyncio.to_thread(self.index.storage_context.persist, persist_dir=self.persist_dir)
                return True
            except: return False

    async def query_context(self, query_text: str, project_id: Optional[int] = None, top_k: int = 20, metadata_filters: Optional[Dict[str, Any]] = None, recency_weight: float = 0.3, exclude_project_ids: Optional[List[int]] = None) -> str:
        await self._ensure_initialized()
        if not self.index: return ""
        try:
            from llama_index.core.vector_stores import MetadataFilter, MetadataFilters, FilterOperator
            filters_list = []
            if project_id is not None:
                filters_list.append(MetadataFilter(key="project_id", value=project_id, operator=FilterOperator.EQ))
            if metadata_filters:
                for k, v in metadata_filters.items():
                    filters_list.append(MetadataFilter(key=k, value=v, operator=FilterOperator.EQ))
            
            # exclude_project_ids がある場合、NE フィルタを追加（LlamaIndexの制限により複数は難しい場合があるため検索後にフィルタ）
            
            def _retrieve():
                retriever = self.index.as_retriever(similarity_top_k=top_k * 2, filters=MetadataFilters(filters=filters_list) if filters_list else None)
                return retriever.retrieve(query_text)
            
            nodes = await asyncio.to_thread(_retrieve)
            if not nodes: return ""

            from datetime import datetime
            now = datetime.now()
            scored_nodes = []
            for node in nodes:
                m = node.metadata
                
                # オフラインプロジェクトの除外
                if exclude_project_ids and m.get("project_id") in exclude_project_ids:
                    continue

                similarity = node.score or 0.5
                date_str = m.get('date')
                recency_score = 0.0
                if date_str:
                    try:
                        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00')).replace(tzinfo=None)
                        recency_score = max(0.0, 1.0 - ((now - dt).days / 365.0))
                    except: pass
                final_score = similarity * (1.0 - recency_weight) + recency_score * recency_weight
                
                # タイトル一致ブースト (クエリに含まれる単語がタイトルにある場合)
                title = m.get('title', '').lower()
                if title:
                    query_lower = query_text.lower()
                    if any(word in title for word in query_lower.split() if len(word) > 1):
                        final_score += 0.2
                
                scored_nodes.append((final_score, node))
            
            scored_nodes.sort(key=lambda x: x[0], reverse=True)
            top_nodes = [node for score, node in scored_nodes[:10]]

            context = "Knowledge Base excerpts:\n"
            for node in top_nodes:
                m = node.metadata
                item_id_val = m.get('item_id') or m.get('meeting_id', '不明')
                context += f"\n--- [{m.get('type','doc').upper()}: {m.get('title','?')} (ID: {item_id_val})] ({m.get('date','?')}) ---\n{node.text}\n"
            return context
        except Exception as e:
            logger.error(f"RAG query error: {e}")
            return ""

    async def query_context_with_sources(self, query_text: str, project_id: Optional[int] = None, top_k: int = 20, metadata_filters: Optional[Dict[str, Any]] = None, recency_weight: float = 0.3, exclude_project_ids: Optional[List[int]] = None) -> tuple[str, List[str]]:
        await self._ensure_initialized()
        if not self.index: return "", []
        try:
            from llama_index.core.vector_stores import MetadataFilter, MetadataFilters, FilterOperator
            filters_list = []
            if project_id is not None:
                filters_list.append(MetadataFilter(key="project_id", value=project_id, operator=FilterOperator.EQ))
            if metadata_filters:
                for k, v in metadata_filters.items():
                    filters_list.append(MetadataFilter(key=k, value=v, operator=FilterOperator.EQ))
            
            def _retrieve():
                retriever = self.index.as_retriever(similarity_top_k=top_k * 2, filters=MetadataFilters(filters=filters_list) if filters_list else None)
                return retriever.retrieve(query_text)
            
            nodes = await asyncio.to_thread(_retrieve)
            if not nodes: return "", []

            from datetime import datetime
            now = datetime.now()
            scored_nodes = []
            for node in nodes:
                m = node.metadata
                
                # オフラインプロジェクトの除外
                if exclude_project_ids and m.get("project_id") in exclude_project_ids:
                    continue

                similarity = node.score or 0.5
                date_str = m.get('date')
                recency_score = 0.0
                if date_str:
                    try:
                        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00')).replace(tzinfo=None)
                        recency_score = max(0.0, 1.0 - ((now - dt).days / 365.0))
                    except: pass
                final_score = similarity * (1.0 - recency_weight) + recency_score * recency_weight
                
                # タイトル一致ブースト (クエリに含まれる単語がタイトルにある場合)
                title = m.get('title', '').lower()
                if title:
                    query_lower = query_text.lower()
                    if any(word in title for word in query_lower.split() if len(word) > 1):
                        final_score += 0.2
                
                scored_nodes.append((final_score, node))
            
            scored_nodes.sort(key=lambda x: x[0], reverse=True)
            top_nodes = [node for score, node in scored_nodes[:10]]

            context = "Knowledge Base excerpts:\n"
            sources_set = []
            for node in top_nodes:
                m = node.metadata
                item_id_val = m.get('item_id') or m.get('meeting_id', '不明')
                context += f"\n--- [{m.get('type','doc').upper()}: {m.get('title','?')} (ID: {item_id_val})] ({m.get('date','?')}) ---\n{node.text}\n"
                
                # ソースの作成
                title = m.get('title')
                date_val = m.get('date')
                source_str = ""
                if date_val:
                    # '2026-05-11T12:00:00' のような形式から日付部分だけを抽出
                    date_str_formatted = str(date_val)[:10]  # YYYY-MM-DD
                    if title:
                        source_str = f"{date_str_formatted} {title}"
                    else:
                        source_str = f"{date_str_formatted} 議事録ナレッジ"
                elif title:
                    source_str = title
                
                if source_str and source_str not in sources_set:
                    sources_set.append(source_str)
                    
            return context, sources_set
        except Exception as e:
            logger.error(f"RAG query with sources error: {e}")
            return "", []

rag_service = RAGService()
