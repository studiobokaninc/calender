import os
import sys
import asyncio

# Define the path to project base
project_path = r'e:\calender\backend'
sys.path.append(project_path)

from app.services.knowledge_processor import KnowledgeProcessor

async def reprocess():
    api_key = os.getenv("GOOGLE_API_KEY")
    kp = KnowledgeProcessor(api_key=api_key)
    print(f"Reprocessing item 20 with fixed code...")
    await kp.process_knowledge_item(20)
    print("reprocess call done.")

if __name__ == "__main__":
    asyncio.run(reprocess())
