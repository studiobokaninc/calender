import os
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, StorageContext
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.gemini import Gemini
from llama_index.embeddings.gemini import GeminiEmbedding
from llama_index.core.settings import Settings
import chromadb

logger = logging.getLogger(__name__)

# Constants
CHROMA_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "chroma")

class RAGService:
    def __init__(self):
        env_path = Path(__file__).resolve().parent.parent.parent / ".env"
        load_dotenv(dotenv_path=str(env_path), override=True)
        self.api_key = os.environ.get("GOOGLE_API_KEY")
        if not self.api_key:
            logger.warning("GOOGLE_API_KEY is not set for RAGService.")
            
        # Configure Gemini as the LLM and Embedding Model
        try:
            llm = Gemini(model="models/gemini-2.0-flash", api_key=self.api_key)
            embed_model = GeminiEmbedding(model_name="models/gemini-embedding-001", api_key=self.api_key)
            Settings.llm = llm
            Settings.embed_model = embed_model
        except Exception as e:
            logger.error(f"Failed to initialize Gemini models for LlamaIndex: {e}")
        
        # Initialize ChromaDB client
        os.makedirs(CHROMA_DB_PATH, exist_ok=True)
        self.db = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        self.collection_name = "calendar_knowledge_base"
        self.chroma_collection = self.db.get_or_create_collection(self.collection_name)
        
        # Initialize VectorStore and Index
        self.vector_store = ChromaVectorStore(chroma_collection=self.chroma_collection)
        self.storage_context = StorageContext.from_defaults(vector_store=self.vector_store)
        
        # Load existing index if it exists
        try:
            if self.chroma_collection.count() > 0:
                self.index = VectorStoreIndex.from_vector_store(
                    self.vector_store,
                    storage_context=self.storage_context,
                    embed_model=Settings.embed_model
                )
            else:
                # Will be initialized on first add_document call
                self.index = None
        except Exception as e:
            logger.warning(f"Initial RAG index load skipped or failed: {e}. Will try to initialize on first use.")
            self.index = None

    def add_document(self, file_path: str, metadata: Optional[Dict[str, Any]] = None):
        """Add a single document to the RAG knowledge base."""
        try:
            reader = SimpleDirectoryReader(input_files=[file_path])
            documents = reader.load_data()
            
            item_id = metadata.get("item_id") if metadata else None
            
            if metadata:
                for doc in documents:
                    doc.metadata.update(metadata)
                    if item_id:
                        # Ensure we have a consistent ref_id to help with some index operations
                        doc.doc_id = f"item_{item_id}_{doc.doc_id}"
                    
            if not self.index:
                # Create original index from the first document(s)
                self.index = VectorStoreIndex.from_documents(
                    documents=documents,
                    storage_context=self.storage_context,
                    embed_model=Settings.embed_model
                )
            else:
                # Insert into existing index
                for doc in documents:
                    self.index.insert(doc)
            
            logger.info(f"Successfully added {file_path} to RAG knowledge base.")
            return True
        except Exception as e:
            logger.error(f"Failed to add document {file_path} to RAG: {e}")
            return False

    def delete_item(self, item_id: int):
        """Delete all nodes associated with an item_id from RAG."""
        try:
            # Delete from ChromaDB directly using metadata filter
            # item_id is stored as int in metadata
            self.chroma_collection.delete(where={"item_id": item_id})
            
            # Since index is already loaded, we might need to refresh it
            if self.chroma_collection.count() == 0:
                self.index = None
            else:
                # Re-init index to reflect the deletion
                self.index = VectorStoreIndex.from_vector_store(
                    self.vector_store,
                    storage_context=self.storage_context,
                    embed_model=Settings.embed_model
                )
            
            logger.info(f"Successfully deleted item_id {item_id} from RAG.")
            return True
        except Exception as e:
            logger.error(f"Failed to delete item_id {item_id} from RAG: {e}")
            return False

    def query_context(self, query_text: str, top_k: int = 10) -> str:
        """Query the RAG knowledge base and return string context with citations."""
        if not self.index:
            return ""
            
        try:
            # Increase top_k for better coverage
            retriever = self.index.as_retriever(similarity_top_k=top_k)
            nodes = retriever.retrieve(query_text)
            
            if not nodes:
                return "No relevant information found in the knowledge base."

            context = "Found the following relevant excerpts from the Knowledge Base:\n"
            for i, node in enumerate(nodes):
                title = node.metadata.get('title', 'Unknown Document')
                file_name = node.metadata.get('file_name', 'Unknown File')
                score = getattr(node, 'score', 'N/A')
                
                context += f"\n--- [Source {i+1}: {title} (File: {file_name})] ---\n"
                context += f"{node.text}\n"
                
            return context
        except Exception as e:
            logger.error(f"RAG query failed: {e}")
            return ""

# Singleton instance
rag_service = RAGService()
