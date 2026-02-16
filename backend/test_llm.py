import sys
import os
import asyncio
from dotenv import load_dotenv

# Add backend to path to allow importing app
sys.path.append(os.path.dirname(__file__))

from app.services.llm import LLMClient

async def main():
    # Load .env from app/.env if it exists, or .env in CWD
    load_dotenv("app/.env")
    if not os.getenv("GOOGLE_API_KEY"):
        load_dotenv(".env")
        
    api_key = os.getenv("GOOGLE_API_KEY")
    
    if not api_key:
        print("GOOGLE_API_KEY not found in env. Using MOCK mode.")
        api_key = "mock-api-key"
        
        # Mock google.generativeai
        from unittest.mock import MagicMock
        import sys
        
        mock_genai = MagicMock()
        # Mock GenerativeModel
        mock_model = MagicMock()
        mock_chat = MagicMock()
        
        # Mock send_message_async return value (awaitable that returns async generator)
        async def mock_resp_gen():
            yield MagicMock(text="Hello! ")
            yield MagicMock(text="I am ")
            yield MagicMock(text="a mocked ")
            yield MagicMock(text="LLM.")
            
        async def mock_send_message_async(*args, **kwargs):
            return mock_resp_gen()
            
        mock_chat.send_message_async = mock_send_message_async # Assign as function, not return_value if using raw function
        # Or if keeping MagicMock:
        # mock_chat.send_message_async.side_effect = mock_send_message_async
        # But replacing with function is easier.
        mock_chat.send_message_async.side_effect = mock_send_message_async

        mock_model.start_chat.return_value = mock_chat
        mock_genai.GenerativeModel.return_value = mock_model
        
        # Apply mock
        sys.modules["google.generativeai"] = mock_genai
        # Also need to patch app.services.llm.genai which is already imported?
        # Since we imported LLMClient before patching, LLMClient has reference to real genai.
        # We need to re-import or patch the module attribute.
        import app.services.llm
        app.services.llm.genai = mock_genai

    print(f"Using API Key: {api_key[:5]}...{api_key[-5:] if len(api_key)>10 else ''}")
    
    try:
        client = LLMClient(api_key)
    except Exception as e:
        print(f"Failed to initialize LLMClient: {e}")
        return
    
    query = "What tasks do I have?"
    conversation_id = "test-conv-id"
    # Inputs with dummy CSV to test prompt context
    inputs = {
        "csv": "id,name,status\n1,Buy Milk,todo\n2,Walk Dog,done"
    }
    user = "test-user"
    
    print(f"Sending query: {query}")
    print("-" * 20)
    
    try:
        async for event in client.stream_chat(query, conversation_id, inputs, user):
            print(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error during stream_chat: {e}")

if __name__ == "__main__":
    asyncio.run(main())
