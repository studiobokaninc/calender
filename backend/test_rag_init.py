import os
import logging
from llama_index.core import Settings, VectorStoreIndex, Document
from llama_index.llms.gemini import Gemini
from llama_index.embeddings.gemini import GeminiEmbedding
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
load_dotenv()

api_key = os.getenv("GOOGLE_API_KEY")
print(f"API KEY present: {bool(api_key)}")

try:
    llm = Gemini(model="models/gemini-2.0-flash", api_key=api_key)
    embed_model = GeminiEmbedding(model_name="models/gemini-embedding-001", api_key=api_key)
    
    Settings.llm = llm
    Settings.embed_model = embed_model
    
    print("Settings configured.")
    
    doc = Document(text="This is a test document.")
    index = VectorStoreIndex.from_documents([doc])
    print("Index created successfully.")
    
except Exception as e:
    print(f"FAILED: {e}")
    import traceback
    traceback.print_exc()
