import os
from google import genai
from dotenv import load_dotenv

load_dotenv("app/.env")
api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    # Try finding .env in current directory
    load_dotenv(".env")
    api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    print("API_KEY not found. Please set GOOGLE_API_KEY in backend/.env")
else:
    try:
        # Default v1?
        client = genai.Client(api_key=api_key)
        print("Using API Key:", api_key[:5] + "...")
        print("Listing available models (v1beta):")
        
        # Try listing - the new library documentation is sparse in my training data, using intuition
        # client.models.list()
        for m in client.models.list():
            print(f"- {m.name}")
            # print(dir(m))
            
    except Exception as e:
        print(f"Error listing models: {e}")
        import traceback
        traceback.print_exc()
