import asyncio
import os
import sys

# パスの設定 (backendディレクトリで実行される前提)
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.services.rag import rag_service

async def main():
    print("Initialising RAG service...")
    await rag_service._ensure_initialized()
    
    query = "ゴールデンウィーク"
    print(f"Querying: {query}")
    context, sources = await rag_service.query_context_with_sources(query)
    
    print("=== CONTEXT ===")
    print(context)
    print("=== SOURCES ===")
    print(sources)

if __name__ == "__main__":
    asyncio.run(main())
