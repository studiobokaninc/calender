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
            llm = Gemini(model="models/gemini-2.5-pro", api_key=self.api_key)
            embed_model = GeminiEmbedding(model_name="models/embedding-001", api_key=self.api_key)
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
        
        # Load existing index or create an empty one
        try:
            # Check if collection has documents
            if self.chroma_collection.count() > 0:
                self.index = VectorStoreIndex.from_vector_store(
                    self.vector_store,
                    storage_context=self.storage_context
                )
            else:
                self.index = VectorStoreIndex.from_documents(
                    documents=[], 
                    storage_context=self.storage_context
                )
        except Exception as e:
            logger.error(f"Failed to initialize VectorStoreIndex: {e}")
            self.index = None

    def add_document(self, file_path: str, metadata: Optional[Dict[str, Any]] = None):
        """Add a single document to the RAG knowledge base."""
        if not self.index:
            logger.error("RAG Index is not initialized.")
            return False
            
        try:
            reader = SimpleDirectoryReader(input_files=[file_path])
            documents = reader.load_data()
            if metadata:
                for doc in documents:
                    doc.metadata.update(metadata)
                    
            # Insert into index
            for doc in documents:
                self.index.insert(doc)
            logger.info(f"Successfully added {file_path} to RAG knowledge base.")
            return True
        except Exception as e:
            logger.error(f"Failed to add document {file_path} to RAG: {e}")
            return False

    def query_context(self, query_text: str, top_k: int = 5) -> str:
        """Query the RAG knowledge base and return string context."""
        if not self.index:
            return ""
            
        try:
            retriever = self.index.as_retriever(similarity_top_k=top_k)
            nodes = retriever.retrieve(query_text)
            
            context = ""
            for node in nodes:
                file_name = node.metadata.get('file_name', 'Unknown')
                context += f"\n--- RAG Excerpt from: {file_name} ---\n{node.text}\n"
            return context
        except Exception as e:
            logger.error(f"RAG query failed: {e}")
            return ""

# Singleton instance
rag_service = RAGService()
