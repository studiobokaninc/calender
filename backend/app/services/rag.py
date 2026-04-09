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
            
            if openai_key and openai_key.startswith("sk-"):
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
                    self.index = await asyncio.wait_for(asyncio.to_thread(_load), timeout=60.0)
                else:
                    self.index = None
                
                self._initialized = True
            except Exception as e:
                logger.error(f"RAG init error: {e}")
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

    async def query_context(self, query_text: str, project_id: Optional[int] = None, top_k: int = 20, metadata_filters: Optional[Dict[str, Any]] = None, recency_weight: float = 0.3) -> str:
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
            
            def _retrieve():
                retriever = self.index.as_retriever(similarity_top_k=top_k, filters=MetadataFilters(filters=filters_list) if filters_list else None)
                return retriever.retrieve(query_text)
            
            nodes = await asyncio.to_thread(_retrieve)
            if not nodes: return ""

            from datetime import datetime
            now = datetime.now()
            scored_nodes = []
            for node in nodes:
                similarity = node.score or 0.5
                date_str = node.metadata.get('date')
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
                context += f"\n--- [{m.get('type','doc').upper()}: {m.get('title','?')}] ({m.get('date','?')}) ---\n{node.text}\n"
            return context
        except Exception as e:
            logger.error(f"RAG query error: {e}")
            return ""

rag_service = RAGService()
