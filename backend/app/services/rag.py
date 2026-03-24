import os
import logging
import asyncio
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, StorageContext, Document
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.google_genai import GoogleGenAI
from llama_index.embeddings.google_genai import GoogleGenAIEmbedding
from llama_index.core.settings import Settings
import chromadb

logger = logging.getLogger(__name__)

# Constants
_DEFAULT_CHROMA_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "chroma")
CHROMA_DB_PATH = os.environ.get("CHROMA_DB_PATH", _DEFAULT_CHROMA_DB_PATH)

class RAGService:
    def __init__(self):
        # Extremely lightweight init to avoid hanging during uvicorn import
        self.api_key: Optional[str] = None
        self.db: Optional[chromadb.PersistentClient] = None
        self.chroma_collection: Any = None
        self.vector_store: Optional[ChromaVectorStore] = None
        self.storage_context: Optional[StorageContext] = None
        self.index: Optional[VectorStoreIndex] = None
        self._initialized: bool = False
        self._index_initialized: bool = False
        self.collection_name: str = "calendar_knowledge_base"
        self._lock = asyncio.Lock()

    async def _ensure_initialized(self):
        """Heavy lifting initialization, called lazily upon first use."""
        if self._initialized:
            return
        
        async with self._lock:
            # Check again inside lock (double-checked locking)
            if self._initialized:
                return

            print("RAGService: 遅延初期化(Async)を開始中...")
            env_path = Path(__file__).resolve().parent.parent.parent / ".env"
            load_dotenv(dotenv_path=str(env_path), override=True)
            self.api_key = os.environ.get("GOOGLE_API_KEY")
            if not self.api_key:
                logger.warning("GOOGLE_API_KEY is not set for RAGService.")
            else:
                print(f"RAGService: APIキーを検知しました (末尾: ...{self.api_key[-4:]})")
                
            # Configure Gemini as the LLM and Embedding Model
            try:
                print("RAGService: Gemini LLM/Embedding を初期化中...")
                llm = GoogleGenAI(model="models/gemini-2.0-flash", api_key=self.api_key)
                embed_model = GoogleGenAIEmbedding(model_name="models/gemini-embedding-001", api_key=self.api_key)
                Settings.llm = llm
                Settings.embed_model = embed_model
                print("RAGService: LlamaIndex 設定完了")
            except Exception as e:
                print(f"RAGService: Gemini 初期化エラー: {e}")
                logger.error(f"Failed to initialize Gemini models: {e}")
            
            try:
                print(f"RAGService: ChromaDB を準備中 ({CHROMA_DB_PATH})...")
                os.makedirs(CHROMA_DB_PATH, exist_ok=True)
                # Ensure the path is absolute for Windows stability
                abs_db_path = os.path.abspath(CHROMA_DB_PATH)
                self.db = chromadb.PersistentClient(path=abs_db_path)
                print(f"RAGService: ChromaDB 準備完了")
            except Exception as e:
                print(f"RAGService: ChromaDB クライアント作成エラー: {e}")
                raise e
                
            print(f"RAGService: コレクション '{self.collection_name}' を取得中...")
            try:
                # Use to_thread for the synchronous chromadb call to avoid blocking the loop
                # Wrap with wait_for to prevent infinite hanging if SQLite is locked
                print(f"RAGService: ChromaDBアクセス中 (ロックされている場合はここで待機が発生します...待機上限 20秒)")
                self.chroma_collection = await asyncio.wait_for(
                    asyncio.to_thread(self.db.get_or_create_collection, self.collection_name),
                    timeout=20.0
                )
                print(f"RAGService: コレクション取得完了 (現在のドキュメント数: {self.chroma_collection.count()})")
            except asyncio.TimeoutError:
                print(f"RAGService ERROR: ChromaDBのコレクション取得が20秒以内に完了しませんでした。")
                print(f" SQLiteファイルが他のプロセスでロックされているか、破損している可能性があります。")
                print(f" 手動で backend/data/chroma/ 内のフォルダやファイルを削除して再起動を試みてください。")
                logger.error("RAGService initialization timeout (ChromaDB collection access). Possible SQLite lock.")
                raise Exception("RAGService: ChromaDB initialization timeout. Please check for SQLite locks.")
            except Exception as e:
                print(f"RAGService: コレクション取得に失敗: {e}")
                raise e

            
            # Initialize VectorStore and Index structures
            self.vector_store = ChromaVectorStore(chroma_collection=self.chroma_collection)
            self.storage_context = StorageContext.from_defaults(vector_store=self.vector_store)
            self._initialized = True

    async def _ensure_index(self):
        """Lazy initialization of the index."""
        await self._ensure_initialized()
        if self._index_initialized and self.index:
            return self.index
        
        async with self._lock:
            if self._index_initialized and self.index:
                return self.index

            try:
                print(f"RAGService: インデックス構造を非同期で初期化中...")
                # from_vector_store is relatively fast as it doesn't embed
                self.index = VectorStoreIndex.from_vector_store(
                    self.vector_store,
                    storage_context=self.storage_context,
                    embed_model=Settings.embed_model
                )
                self._index_initialized = True
                print("RAGService: インデックス構造の準備完了")
            except Exception as e:
                print(f"RAGService: インデックス構造の初期化エラー: {e}")
                self.index = None
                self._index_initialized = False
            return self.index

    async def add_text(self, text: str, metadata: Optional[Dict[str, Any]] = None):
        """Add raw text to the RAG knowledge base."""
        doc = Document(text=text, metadata=metadata or {})
        return await self.add_documents([doc])

    async def add_documents(self, documents: List[Document]):
        """Asynchronous method to add documents, but using sync calls in to_thread for stability on Windows."""
        await self._ensure_initialized()
        try:
            index = await self._ensure_index()
                    
            if not index:
                print(f"RAGService: 新規インデックスを作成中 (to_thread)...")
                # Use to_thread for the heavy sync factory method
                self.index = await asyncio.to_thread(
                    VectorStoreIndex.from_documents,
                    documents=documents,
                    storage_context=self.storage_context,
                    embed_model=Settings.embed_model
                )
                self._index_initialized = True
            else:
                print(f"RAGService: {len(documents)} 個のドキュメントを順次挿入中(to_thread)...")
                for i, doc in enumerate(documents):
                    print(f"RAGService: [{i+1}/{len(documents)}] Gemini API 同期呼び出し中...")
                    # Wrap the sync insert in to_thread -- this was verified to work in test scripts
                    await asyncio.to_thread(index.insert, doc)
                    print(f"RAGService: [{i+1}/{len(documents)}] 挿入完了")
            
            logger.info(f"Successfully added {len(documents)} documents to RAG knowledge base.")
            print(f"RAGService: {len(documents)} 個のドキュメントの追加に成功しました。")
            return True
        except Exception as e:
            print(f"RAGService: ドキュメント追加中にエラーが発生: {e}")
            import traceback
            traceback.print_exc()
            logger.error(f"Failed to add documents to RAG: {e}")
            return False

    async def add_document(self, file_path: str, metadata: Optional[Dict[str, Any]] = None):
        """Add a single file to the RAG knowledge base."""
        await self._ensure_initialized()
        try:
            print(f"RAGService: ファイル読み込み中 ({file_path})...")
            # Use to_thread for file I/O to avoid blocking the event loop
            reader = SimpleDirectoryReader(input_files=[file_path])
            documents = await asyncio.to_thread(reader.load_data)
            
            item_id = metadata.get("item_id") if metadata else None
            if metadata:
                for doc in documents:
                    doc.metadata.update(metadata)
                    if item_id:
                        doc.doc_id = f"item_{item_id}_{doc.doc_id}"
            
            return await self.add_documents(documents)
        except Exception as e:
            print(f"RAGService: ファイル追加エラー: {e}")
            return False

    async def delete_item(self, item_id: int):
        """Delete all nodes associated with an item_id from RAG."""
        await self._ensure_initialized()
        try:
            print(f"RAGService: item_id {item_id} を削除中...")
            # Use to_thread for the synchronous delete call
            await asyncio.to_thread(self.chroma_collection.delete, where={"item_id": item_id})
            
            index = await self._ensure_index()
            if self.chroma_collection.count() == 0:
                self.index = None
                self._index_initialized = False
            elif index:
                # Refresh index
                self.index = VectorStoreIndex.from_vector_store(
                    self.vector_store,
                    storage_context=self.storage_context,
                    embed_model=Settings.embed_model
                )
            
            print(f"RAGService: item_id {item_id} の削除完了")
            return True
        except Exception as e:
            print(f"RAGService: 削除エラー: {e}")
            return False

    async def query_context(self, query_text: str, top_k: int = 10) -> str:
        """Query the RAG knowledge base and return string context with citations."""
        index = await self._ensure_index()
        if not index:
            return "Knowledge base is currently empty or indexing failed."
            
        try:
            print(f"RAGService: 知識ベースを検索中: '{query_text}'...")
            # Use the retrieval tool from LlamaIndex
            retriever = index.as_retriever(similarity_top_k=top_k)
            nodes = await retriever.aretrieve(query_text)
            
            if not nodes:
                print("RAGService: 関連情報が見つかりませんでした。")
                return ""

            print(f"RAGService: {len(nodes)} 件の情報を取得しました。")
            context = "Found the following relevant excerpts from the Knowledge Base:\n"
            for i, node in enumerate(nodes):
                title = node.metadata.get('title', 'Unknown Document')
                file_name = node.metadata.get('file_name', 'Unknown File')
                context += f"\n--- [資料：{title}] (File: {file_name}) ---\n"
                context += f"{node.text}\n"
                
            return context
        except Exception as e:
            print(f"RAGService: 検索エラー: {e}")
            return ""

# Singleton instance
rag_service = RAGService()
