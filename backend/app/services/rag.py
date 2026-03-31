import os
import logging
import asyncio
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

from llama_index.core import VectorStoreIndex, StorageContext, Document, load_index_from_storage
from llama_index.llms.gemini import Gemini
from llama_index.embeddings.gemini import GeminiEmbedding
from llama_index.core.settings import Settings

logger = logging.getLogger(__name__)

# Constants
# Change to a new path to avoid confusion with the old Chroma data
_DEFAULT_PERSIST_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "rag_index")
PERSIST_DIR = os.environ.get("RAG_PERSIST_DIR", _DEFAULT_PERSIST_DIR)

class RAGService:
    def __init__(self):
        # Extremely lightweight init to avoid hanging during uvicorn import
        self.api_key: Optional[str] = None
        self.index: Optional[VectorStoreIndex] = None
        self._initialized: bool = False
        self._lock = asyncio.Lock()
        self._write_lock = asyncio.Lock() # Lock for write operations (add/delete)

    async def _ensure_initialized(self):
        """Heavy lifting initialization, called lazily upon first use."""
        if self._initialized:
            return
        
        async with self._lock:
            if self._initialized:
                return

            print("RAGService: JSONストレージ版(安定版)を初期化中...")
            env_path = Path(__file__).resolve().parent.parent.parent / ".env"
            load_dotenv(dotenv_path=str(env_path), override=True)
            self.api_key = os.environ.get("GOOGLE_API_KEY")
            
            if not self.api_key:
                logger.warning("GOOGLE_API_KEY is not set for RAGService.")
            
            # Configure Gemini (REST transport is much more stable on Windows)
            Settings.llm = Gemini(model="models/gemini-2.0-flash", api_key=self.api_key, transport="rest")
            Settings.embed_model = GeminiEmbedding(model_name="models/gemini-embedding-001", api_key=self.api_key, transport="rest")

            try:
                os.makedirs(PERSIST_DIR, exist_ok=True)
                # Check if we have an existing index
                if os.path.exists(os.path.join(PERSIST_DIR, "docstore.json")):
                    print(f"RAGService: 既存のインデックスを読み込み中 ({PERSIST_DIR})...")
                    def _load():
                        sc = StorageContext.from_defaults(persist_dir=PERSIST_DIR)
                        return load_index_from_storage(sc)
                    
                    self.index = await asyncio.wait_for(
                        asyncio.to_thread(_load),
                        timeout=60.0
                    )
                    print("RAGService: インデックスの読み込み完了")
                else:
                    print("RAGService: 新規インデックスとして開始します")
                    self.index = None
                
                self._initialized = True
            except Exception as e:
                print(f"RAGService: 初期化エラー (新規作成として続行): {e}")
                self.index = None
                self._initialized = True

    async def add_text(self, text: str, metadata: Optional[Dict[str, Any]] = None):
        """Add raw text to the RAG knowledge base."""
        doc = Document(text=text, metadata=metadata or {})
        return await self.add_documents([doc])

    async def add_documents(self, documents: List[Document]):
        await self._ensure_initialized()
        async with self._write_lock:
            try:
                if self.index is None:
                    print("RAGService: 初回ドキュメント追加によりインデックスを生成中...")
                    self.index = await asyncio.wait_for(
                        asyncio.to_thread(VectorStoreIndex.from_documents, documents),
                        timeout=180.0
                    )
                else:
                    print(f"RAGService: {len(documents)} 件のドキュメントを追加中...")
                    for i, doc in enumerate(documents):
                        print(f"RAGService: [{i+1}/{len(documents)}] 挿入中... (文言量: {len(doc.text)}文字)")
                        await asyncio.wait_for(
                            asyncio.to_thread(self.index.insert, doc),
                            timeout=120.0
                        )
                
                # Persist to disk
                print("RAGService: 変更をファイルに保存中...")
                await asyncio.to_thread(self.index.storage_context.persist, persist_dir=PERSIST_DIR)
                print("RAGService: 保存完了")
                return True
            except Exception as e:
                print(f"RAGService: ドキュメント追加エラー: {e}")
                import traceback
                traceback.print_exc()
                return False

    async def add_document(self, file_path: str, metadata: Optional[Dict[str, Any]] = None):
        """Add a single file to the RAG knowledge base."""
        from llama_index.core import SimpleDirectoryReader
        await self._ensure_initialized()
        try:
            print(f"RAGService: ファイル読み込み中 ({file_path})...")
            reader = SimpleDirectoryReader(input_files=[file_path])
            documents = await asyncio.to_thread(reader.load_data)
            
            if metadata:
                for doc in documents:
                    doc.metadata.update(metadata)
            
            return await self.add_documents(documents)
        except Exception as e:
            print(f"RAGService: ファイル追加エラー: {e}")
            return False

    async def delete_item(self, item_id: int):
        """Delete all nodes associated with an item_id from RAG."""
        await self._ensure_initialized()
        if not self.index:
            return True
            
        async with self._write_lock:
            try:
                print(f"RAGService: item_id {item_id} を削除中...")
                # To delete from SimpleVectorStore/Index, we need to find the doc_ids
                # In this implementation, we can use the ref_doc_id or metadata filter
                doc_ids_to_delete = []
                for doc_id, doc_metadata in self.index.ref_doc_info.items():
                    # Check if metadata matches (SimpleIndex metadata check)
                    # Note: LlamaIndex structure might vary, but we can access docstore
                    pass
                
                # Actually, the most reliable way in SimpleVectorStore without complex traversal 
                # is to filter the docstore or just rebuild if it's small.
                # But LlamaIndex allows index.delete_ref_doc(ref_doc_id)
                
                # Since we don't have an easy way to map item_id -> doc_id without the docstore details,
                # let's try a metadata-based approach if LlamaIndex supports it or just filter:
                
                # Best approach for SimpleIndex:
                # 1. Get all doc_ids from docstore that match metadata
                docstore = self.index.storage_context.docstore
                all_docs = docstore.get_all_ref_doc_info()
                
                # In SimpleIndex, deleting by providing the ref_doc_id is easiest.
                # When we add, we should ensure item_id is in metadata.
                
                # Let's try to find them by iterating over documents in the store
                to_delete = []
                for node_id, node in docstore.docs.items():
                    if node.metadata.get("item_id") == item_id:
                        # Find the ref_doc_id (parent document)
                        ref_id = node.ref_doc_id
                        if ref_id and ref_id not in to_delete:
                            to_delete.append(ref_id)
                
                for ref_id in to_delete:
                    self.index.delete_ref_doc(ref_id, delete_from_docstore=True)
                
                print(f"RAGService: {len(to_delete)} 件の親ドキュメントを削除しました。")
                await asyncio.to_thread(self.index.storage_context.persist, persist_dir=PERSIST_DIR)
                return True
            except Exception as e:
                print(f"RAGService: 削除エラー: {e}")
                return False

    async def query_context(
        self, 
        query_text: str, 
        project_id: Optional[int] = None, 
        top_k: int = 20, 
        metadata_filters: Optional[Dict[str, Any]] = None,
        recency_weight: float = 0.3
    ) -> str:
        """Query the RAG knowledge base and return string context with recency-weighted scoring."""
        await self._ensure_initialized()
        if not self.index:
            return "Knowledge base is currently empty."
            
        try:
            print(f"RAGService: 知識ベースを検索中: '{query_text}' (Project: {project_id})...")
            
            # Metadata filtering
            from llama_index.core.vector_stores import MetadataFilter, MetadataFilters, FilterOperator
            
            filters_list = []
            if project_id is not None:
                filters_list.append(MetadataFilter(key="project_id", value=project_id, operator=FilterOperator.EQ))
            
            if metadata_filters:
                for k, v in metadata_filters.items():
                    filters_list.append(MetadataFilter(key=k, value=v, operator=FilterOperator.EQ))
            
            # Use sync retriever inside to_thread to avoid Gemini async bug
            def _retrieve():
                # 表記揺れ対策として、similarity_top_kを多めに取得し、後の再ランキングで絞り込む
                search_k = top_k * 2 if top_k > 10 else 20
                retriever = self.index.as_retriever(
                    similarity_top_k=search_k, 
                    filters=MetadataFilters(filters=filters_list) if filters_list else None
                )
                return retriever.retrieve(query_text)
            
            nodes = await asyncio.wait_for(
                asyncio.to_thread(_retrieve),
                timeout=60.0
            )
            
            if not nodes:
                # 表記揺れ対策：プロジェクト名のみでもう一度検索を試みる（任意検討）
                print("RAGService: 関連情報が見つかりませんでした。")
                return ""

            # Recency-weighted scoring logic
            from datetime import datetime
            now = datetime.now()
            
            scored_nodes = []
            for node in nodes:
                similarity = node.score or 0.5
                
                # Extract date from metadata
                date_str = node.metadata.get('date')
                recency_score = 0.0
                if date_str:
                    try:
                        # isoformat conversion
                        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00')).replace(tzinfo=None)
                        days_diff = (now - dt).days
                        recency_score = max(0.0, 1.0 - (days_diff / 365.0))
                    except (ValueError, TypeError):
                        recency_score = 0.0
                
                final_score = similarity * (1.0 - recency_weight) + recency_score * recency_weight
                scored_nodes.append((final_score, node))
            
            scored_nodes.sort(key=lambda x: x[0], reverse=True)
            # Return up to top_k nodes, or at least a generous 15 for summary queries
            limit = max(10, top_k // 2) if top_k > 20 else 10
            top_nodes = [node for score, node in scored_nodes[:limit]]

            print(f"RAGService: {len(top_nodes)} 件の情報を取得しました (再ランキング済)。")
            context = "Found the following relevant excerpts from the Knowledge Base (Prioritizing recent info):\n"
            for i, node in enumerate(top_nodes):
                title = node.metadata.get('title', 'Unknown Document')
                file_name = node.metadata.get('file_name', 'Unknown File')
                date_str = node.metadata.get('date', 'Date Unknown')
                type_str = node.metadata.get('type', 'document')
                project_name = node.metadata.get('project_name', 'General')
                context += f"\n--- [{type_str.upper()}：{title}] (Date: {date_str}, File: {file_name}, Project: {project_name}) ---\n"
                context += f"{node.text}\n"
                
            return context
        except Exception as e:
            print(f"RAGService: 検索エラー: {e}")
            import traceback
            traceback.print_exc()
            return ""

# Singleton instance
rag_service = RAGService()
