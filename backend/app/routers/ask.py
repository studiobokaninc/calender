import os
import logging
import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from .. import schemas, models, crud
from ..database import get_db
from ..security import get_current_user
from ..services.rag import rag_service
from ..services.llm import LLMClient, get_llm_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ask", tags=["Ask"])

@router.post("", response_model=schemas.AskResponse)
async def ask_question(
    ask_in: schemas.AskRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    蓄積された議事録ナレッジやデータベース全体をAIが自律的に調査し、
    プロジェクトの状況、会議の発言・会話・決定事項に基づいた高度な回答と、
    参照した情報源（ソース）の一覧を返します。
    """
    try:
        # LLMクライアントの取得
        try:
            llm_client = get_llm_client()
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="LLMのAPIキーが設定されていません。"
            )
        
        # 1. 議事録ナレッジに特化した最小限の inputs 辞書を構築
        inputs = {
            "mode": "ask",
            "no_actions": True,  # タスク作成などの実アクションJSON出力は不要
            "user_name": current_user.name or current_user.username or "User"
        }
        
        # 2. RAGによる一次検索（浅い抜粋）を inputs に設定（エージェント探索のフック）
        context, initial_sources = await rag_service.query_context_with_sources(
            ask_in.question,
            top_k=8,
            recency_weight=0.3
        )
        inputs["kb_summaries"] = context
        
        # 3. エージェント向けに、会議録の完全な文字起こしを調べるよう促す特別指示を構成
        prompt = f"""以下の質問について、過去の会議の完全な文字起こし（発言、会話の文脈）や決定事項を自律的に調査し、回答を生成してください。

【探索と回答のルール】
- 提供されている「会議ナレッジの抜粋」に十分な情報がない場合、または「会議中での実際の発言、会話、詳細なやり取り、経緯」を調べる必要がある場合は、必ず `get_meeting_details` や `search_database` ツールを活用し、対象の会議の「完全な文字起こしデータ」を深く精読した上で回答してください。
- **重要**: ユーザーは単なる要約ではなく、「実際の生の発言や会話のやり取り」を求めています。回答を作成する際は、過度な要約や省略を避け、**「誰がどのように発言したか」「どのような会話のラリーがあったか」をダイアログ形式や具体的な引用（「〜」）を交えて、臨場感をもって詳細に記載してください**。
- どのプロジェクトに関する会話かも含めて説明してください。
- 推測や捏造での回答は厳禁です。データに見つからない場合は「該当する情報が見つかりませんでした」と明確に回答してください。

質問：{ask_in.question}
"""

        # 4. エージェントを活性化させて回答を生成 (mode="ask")
        answer = ""
        # stream_chat を回すことで、内部のツール呼び出しループが自動的に機能し、
        # 必要に応じてデータベースクエリや、会議の完全な文字起こし（get_meeting_details）の読み取りが走ります。
        async for chunk in llm_client.stream_chat(
            query=prompt,
            conversation_id="ask_api_oneshot",
            inputs=inputs,
            user=current_user.username,
            history=[],
            db_session=db
        ):
            if chunk.get("event") == "message":
                ans_chunk = chunk.get("answer", "")
                # システムが実行中のツール通知は絶対に含めないように厳密にフィルタリング
                if "*(システム:" not in ans_chunk:
                    answer += ans_chunk
                    
        # 5. 最終ソースの抽出（RAG一次検索ソースに加えて、エージェントが実際に読み込んだ会議もマージ）
        final_sources = list(initial_sources)
        
        # 回答テキストから、AIが参照した会議の特定表記（ID: xx など）を検出してマージ
        meeting_ids = [int(x) for x in re.findall(r"ID:\s*(\d+)", answer)]
        for mid in set(meeting_ids):
            try:
                mtg = crud.get_meeting(db, mid)
                if mtg:
                    ref_date = mtg.date or mtg.created_at
                    date_str = ref_date.strftime("%Y-%m-%d") if ref_date else ""
                    source_str = f"{date_str} {mtg.title}" if date_str else mtg.title
                    if source_str and source_str not in final_sources:
                        final_sources.append(source_str)
            except: pass
            
        # 検索した結果、情報が見つからなかった場合のソースクレンジング
        if "該当する情報が見つかりませんでした" in answer or "分かりかねます" in answer:
            if len(final_sources) > 0 and len(answer) < 180:
                final_sources = []

        return schemas.AskResponse(
            answer=answer.strip(),
            sources=final_sources
        )
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error in ask endpoint: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI回答の生成中にエラーが発生しました: {str(e)}"
        )
