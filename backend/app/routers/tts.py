from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
import edge_tts
import io
import asyncio

router = APIRouter()

@router.get("/generate")
async def generate_tts(text: str = Query(...)):
    """
    Microsoft Edge TTSを使用して高品質な音声を生成し、ストリーミング配信する。
    """
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    # ボイスの選択 (Nanamiが最も一般的で流麗)
    voice = "ja-JP-NanamiNeural"
    
    try:
        # Edge TTSで音声を生成
        communicate = edge_tts.Communicate(text, voice)
        
        # メモリ上のバイナリストリームとして音声を蓄積
        audio_data = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.write(chunk["data"])
        
        audio_data.seek(0)
        
        # MP3としてフロントエンドに返却
        return StreamingResponse(
            audio_data, 
            media_type="audio/mpeg",
            headers={"Content-Disposition": "attachment; filename=speech.mp3"}
        )
        
    except Exception as e:
        print(f"TTS Generation Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
