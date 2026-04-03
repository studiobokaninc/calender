import logging
import time
import json
import traceback
from typing import Optional, List, Dict, Any, Union
from sqlalchemy.orm import Session
from datetime import datetime

from .. import crud, models, task_list as task_list_module
from .rag import rag_service

logger = logging.getLogger(__name__)

class ChatContextService:
    """
    チャットのコンテキスト構築を担当するサービス。
    Dify風の inputs 辞書を生成し、RAGや会議録、ダッシュボード情報を統合する。
    """

    @staticmethod
    async def get_admin_context(db: Session, current_user: models.User, query: str, conversation_id: str) -> Dict[str, Any]:
        """管理者向けフルコンテキストの取得"""
        t0 = time.time()
        
        # 1. 基本ダッシュボード情報の取得 (タスク, プロジェクト, ユーザー, メモ)
        inputs: Dict[str, Any] = {}
        try:
            full_context = task_list_module.get_dashboard_context(db, current_user.id)
            
            # クエリに応じてタスク詳細を絞り込むか判断
            task_keywords = [
                "タスク", "期限", "予定", "進捗", "誰が", "担当", "いつ", "スケジュール", "遅れ", "進んでる", "やること",
                "案件", "プロジェクト", "状況", "どう", "ワーク", "作業",
                "task", "status", "due", "who", "schedule", "plan", "project"
            ]
            query_lower = query.lower()
            needs_tasks = any(kw in query_lower for kw in task_keywords)
            
            task_csv = ""
            if needs_tasks:
                task_csv = str(full_context.get("csv", ""))
            else:
                lines = str(full_context.get("csv", "")).splitlines()
                task_count = len(lines) - 1 if len(lines) > 0 else 0
                task_csv = f"--- Task Summary --- \nTotal {task_count} active tasks across projects."

            inputs = {
                "csv": task_csv, 
                "proj": full_context.get("proj", ""), 
                "user_list": full_context.get("user_list", ""), 
                "project_summary": full_context.get("project_summary", ""),
                "mode": "admin", 
                "user_name": current_user.name or current_user.username or "Admin",
                "notes": full_context.get("notes", ""),
                "active_project_id": None 
            }
        except Exception as e:
            logger.warning("[ChatContextService] get_dashboard_context failed: %s", e)
            inputs = {"csv": "", "proj": "", "user_list": "", "mode": "admin", "notes": ""}
            
        logger.info(f"[PROFILER] get_dashboard_context took {time.time() - t0:.2f}s")
        
        # 2. プロジェクトの推論とRAG/会議録コンテキストの統合
        try:
            db_history = crud.get_chat_messages(db, conversation_id, limit=3)
            focused_project_id = ChatContextService._infer_project_id(db, query, db_history)
            
            if focused_project_id:
                inputs["active_project_id"] = focused_project_id
            
            ts_context = await ChatContextService._build_ts_rag_context(db, query, focused_project_id, db_history)
            spotlight_context = ChatContextService._get_spotlight_context(db, query)
            
            inputs["notes"] = (str(inputs.get("notes") or "")) + ts_context + spotlight_context
            inputs["kb_summaries"] = "Available in Time-Series context above."
            
        except Exception as e:
            logger.warning("[ChatContextService] Context enrichment failed: %s", e)
            traceback.print_exc()

        return inputs

    @staticmethod
    async def get_personal_context(db: Session, current_user: models.User, query: str, conversation_id: str) -> Dict[str, Any]:
        """一般ユーザー向けパーソナルコンテキストの取得"""
        inputs: Dict[str, Any] = {}
        try:
            raw_personal_context = task_list_module.get_personal_context(db, current_user.id)
            inputs = dict(raw_personal_context)
            inputs["mode"] = "personal"
            inputs["user_name"] = current_user.name or current_user.username or "User"
            inputs["active_project_id"] = None
        except Exception as e:
            logger.warning("[ChatContextService] get_personal_context failed: %s", e)
            inputs = {"csv": "", "proj": "", "events": "", "mode": "personal", "notes": ""}

        # プロジェクト推論とRAG統合
        try:
            db_history = crud.get_chat_messages(db, conversation_id, limit=3)
            focused_project_id = ChatContextService._infer_project_id(db, query, db_history)
            
            if focused_project_id:
                inputs["active_project_id"] = focused_project_id
                
            ts_context = await ChatContextService._build_ts_rag_context(db, query, focused_project_id, db_history)
            spotlight_context = ChatContextService._get_spotlight_context(db, query)
            
            inputs["notes"] = (str(inputs.get("notes") or "")) + ts_context + spotlight_context
            inputs["kb_summaries"] = "Available in Time-Series context above."
        except Exception as e:
            logger.warning("[ChatContextService] Personal context enrichment failed: %s", e)

        return inputs

    @staticmethod
    def _infer_project_id(db: Session, query: str, db_history: List[models.ChatMessage]) -> Optional[int]:
        """クエリや会話履歴から関連するプロジェクトIDを推論する"""
        try:
            active_projects = crud.get_projects(db, skip=0, limit=100)
            query_lower = query.lower()
            
            # A) クエリから直接探す
            for p in active_projects:
                if p.name and p.name.lower() in query_lower:
                    return int(p.id)
            
            # B) 会話履歴（直近3件）から探す
            for m in reversed(db_history):
                msg_content = str(m.content or "").lower()
                for p in active_projects:
                    if p.name and p.name.lower() in msg_content:
                        return int(p.id)
        except Exception as e:
            logger.warning("[ChatContextService] _infer_project_id failed: %s", e)
        return None

    @staticmethod
    async def _build_ts_rag_context(db: Session, query: str, project_id: Optional[int], db_history: List[models.ChatMessage]) -> str:
        """時系列RAGコンテキスト（最新会議、決定事項、RAG検索）を構築する"""
        ts_context = "\n\n"
        
        # 1. 最新の議事録
        latest_mtg = crud.get_latest_meeting(db, project_id=project_id)
        if latest_mtg:
            ts_context += f"--- [LATEST MEETING: {latest_mtg.title}] (Date: {latest_mtg.date}) ---\n"
            decs = crud.get_decisions(db, meeting_id=latest_mtg.id)
            dec_text = ", ".join([str(d.content) for d in decs]) if decs else "N/A"
            ts_context += f"CURRENT DECISIONS: {dec_text}\n"
            ts_context += f"FULL TRANSCRIPT: {str(latest_mtg.transcript or '')[:4000]}...\n\n"

        # 2. 現在有効な決定事項（全プロジェクトから横断）
        active_decs = crud.get_decisions(db, project_id=project_id, superseded=False)
        if active_decs:
            type_label = f"PROJECT {project_id}" if project_id else "CONSOLIDATED"
            ts_context += f"--- [ACTIVE DECISIONS ({type_label} Source of Truth)] ---\n"
            for d in active_decs[:15]:
                date_str = d.date.strftime("%Y-%m-%d") if d.date else "Unknown"
                ts_context += f"- {str(d.content)} (Established: {date_str})\n"
            ts_context += "\n"

        # 3. 会議サマリー（マップ）
        mtg_summaries = crud.get_all_meeting_summaries(db, project_id=project_id)
        ts_context += "--- Chronological Meeting Summaries (Map of Decisions) ---\n"
        ts_context += str(mtg_summaries) + "\n\n"

        # 4. RAG検索
        query_lower = query.lower()
        is_summary_query = any(kw in query_lower for kw in ["まとめて", "一覧", "概要", "全部", "横断", "詳細", "要約", "経緯", "歴史"])
        search_query = query
        
        # プロジェクト名が推論されている場合、検索クエリに含めて表記揺れを補正
        if project_id:
            proj = crud.get_project(db, project_id=project_id)
            if proj and proj.name and proj.name.lower() not in query_lower:
                search_query = f"{proj.name} {query}"
        
        top_k = 40 if is_summary_query else 25
        rag_context = await rag_service.query_context(search_query, project_id=project_id, top_k=top_k)
        if rag_context:
            ts_context += "\n--- Knowledge Base & Historical Meeting Excerpts (RAG) ---\n"
            ts_context += str(rag_context) + "\n"

        return ts_context

    @staticmethod
    def _get_spotlight_context(db: Session, query: str) -> str:
        """クエリ内で明示されたドキュメントの全文をコンテキストに追加する"""
        spotlight_context = ""
        try:
            kb_items = crud.get_knowledge_items(db, limit=20)
            for item in kb_items:
                # status check and title check
                if item.status == "completed" and item.title:
                    item_title = str(item.title)
                    item_id_str = f"ID:{item.id}"
                    if item_title in query or item_id_str in query:
                        # 全文を載せる（ただしトークン制限配慮で 30,000文字程度まで）
                        content_limit = 30000 
                        text = str(item.content_text or "")
                        spotlight_context += f"\n\n--- [SPOTLIGHT DOCUMENT: {item_title} (ID: {item.id})] ---\n"
                        spotlight_context += text[:content_limit]
                        if len(text) > content_limit:
                            spotlight_context += "\n... (Content truncated)"
        except Exception as e:
            logger.warning("[ChatContextService] _get_spotlight_context failed: %s", e)
        return spotlight_context
