import os
try:
    from llama_index.llms.google_genai import GoogleGenAI
    print("GoogleGenAI import Success")
except ImportError as e:
    print(f"GoogleGenAI import Failed: {e}")

try:
    from llama_index.embeddings.google_genai import GoogleGenAIEmbedding
    print("GoogleGenAIEmbedding import Success")
except ImportError as e:
    print(f"GoogleGenAIEmbedding import Failed: {e}")
