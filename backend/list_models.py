import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv("app/.env")
api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    print("API_KEY not found. Please set GOOGLE_API_KEY in backend/.env")
else:
    genai.configure(api_key=api_key)
    try:
        print("Listing available models:")
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                print(m.name)
    except Exception as e:
        print(f"Error listing models: {e}")
