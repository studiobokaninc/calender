import os
import logging
import json
import asyncio
import pathlib
import tempfile
import shutil
import mimetypes
import subprocess
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from .. import crud, models, schemas
from .llm import LLMClient
from .rag import rag_service
from ..timezone import now_jst_naive
from llama_index.core import Document

logger = logging.getLogger(__name__)

# 同時実行数を制限するためのセマフォ (サーバー負荷とAPI制限の管理)
# 高負荷な解析が同時に走りすぎてバックエンドが応答不能になるのを防ぐ
# 4コア/GPU無し環境ではローカルWhisper+ローカルLLMがCPUを食い尽くすため1に制限。
ANALYZE_SEMAPHORE = asyncio.Semaphore(int(os.getenv("ANALYZE_CONCURRENCY", "1")))

class MeetingAnalyzer:
    def __init__(self, api_key: str):
        if not api_key:
            logger.warning("No API Key provided to MeetingAnalyzer")
        self.llm_client = LLMClient(api_key=api_key)
    async def _get_duration(self, audio_path: str) -> float:
        """ffprobeを使用して音声の長さを取得する（Windows対応・堅牢性強化）"""
        abs_path = os.path.abspath(audio_path)
        if not os.path.exists(abs_path):
            logger.error(f"Audio file not found: {abs_path}")
            return 0
            
        try:
            # ffprobeの実行パスを動的に取得
            ffprobe_exe = shutil.which("ffprobe") or "ffprobe"
            
            # WindowsでのNotImplementedError回避のため、subprocess.runをスレッドで実行
            def _run_ffprobe():
                return subprocess.run(
                    [
                        ffprobe_exe, 
                        "-v", "error", 
                        "-show_entries", "format=duration", 
                        "-of", "default=noprint_wrappers=1:nokey=1", 
                        abs_path
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
            
            result = await asyncio.to_thread(_run_ffprobe)
            
            if result.returncode == 0:
                d_str = result.stdout.strip()
                if d_str:
                    logger.info(f"ffprobe duration: {d_str} for {abs_path}")
                    return float(d_str)
            else:
                logger.warning(f"ffprobe failed ({result.returncode}): {result.stderr}")
                
        except Exception as e:
            # 例外内容を詳細に記録
            logger.warning(f"ffprobe exception for {abs_path}: [{type(e).__name__}] {str(e)}")
            import traceback
            logger.warning(traceback.format_exc())
            
        return 0

    async def _split_audio(self, audio_path: str, chunk_size_sec: int, output_dir: str) -> List[str]:
        """ffmpegを使用して音声を分割する"""
        try:
            abs_audio_path = os.path.abspath(audio_path)
            ext = pathlib.Path(abs_audio_path).suffix or ".mp3"
            output_pattern = os.path.join(output_dir, f"chunk_%03d{ext}")
            
            # 実行パスを動的に取得
            ffmpeg_exe = shutil.which("ffmpeg") or "ffmpeg"
            
            # Windows環境での安定性を重視し、subprocess.runをスレッドで実行
            def _run_ffmpeg():
                return subprocess.run(
                    [
                        ffmpeg_exe, "-i", abs_audio_path, 
                        "-f", "segment", "-segment_time", str(chunk_size_sec), 
                        "-c", "copy", output_pattern
                    ],
                    capture_output=True,
                    text=True,
                    timeout=300 # 分割には少し時間がかかる可能性がある
                )
            
            result = await asyncio.to_thread(_run_ffmpeg)
            
            if result.returncode != 0:
                logger.warning(f"ffmpeg split failed ({result.returncode}): {result.stderr}")
            
            chunks = sorted([
                os.path.join(output_dir, f) 
                for f in os.listdir(output_dir) 
                if f.startswith("chunk_")
            ])
            if chunks:
                logger.info(f"Split audio into {len(chunks)} chunks.")
                return chunks
        except Exception as e:
            logger.error(f"Failed to split audio: {e}")
        return []

    async def analyze_meeting(self, meeting_id: int, audio_path: str):
        """音声を分割し、レート制限に配慮しながら段階的に解析・統合する"""
        # ANALYZE_SEMAPHORE により同時実行数を制限し、バックエンドのフリーズを防止
        async with ANALYZE_SEMAPHORE:
            from ..database import SessionLocal
            db = SessionLocal()
            db_meeting = None
            try:
                db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
                if not db_meeting: 
                    logger.error(f"Meeting {meeting_id} not found in DB.")
                    return
                crud.update_meeting(db, db_meeting, {"status": "processing"})
                db.commit()
            except Exception as e:
                logger.error(f"Initial meeting check failed: {e}")
                return
            finally:
                db.close()

            temp_dir = tempfile.mkdtemp()
            try:
                # 1. 音声分割（5分ごと）
                duration = await self._get_duration(audio_path)
                chunk_size = 300 # 5分
                file_size = os.path.getsize(audio_path)
                
                logger.info(f"Meeting duration: {duration:.1f}s, size: {file_size/1024/1024:.2f}MB")
                
                if duration > (chunk_size + 30) or file_size > 2 * 1024 * 1024:
                    logger.info(f"Splitting meeting into {chunk_size}s chunks...")
                    chunk_paths = await self._split_audio(audio_path, chunk_size, temp_dir)
                else:
                    chunk_paths = [audio_path]
                
                if not chunk_paths: 
                    chunk_paths = [audio_path]

                all_results = []
                for i, path in enumerate(chunk_paths):
                    logger.info(f"Processing chunk {i+1}/{len(chunk_paths)}: {path}")
                    res = await self._process_segment_with_retry(path, i+1, len(chunk_paths), meeting_id)
                    if res:
                        all_results.append(res)
                    
                    if i < len(chunk_paths) - 1:
                        await asyncio.sleep(float(os.getenv("ANALYZE_CHUNK_SLEEP", "30")))

                if not all_results:
                    raise Exception("No results obtained from any segment.")

                # 2. 全結果の統合
                final_minutes = await self._consolidate_results(all_results, meeting_id)
                
                db = SessionLocal()
                try:
                    db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
                    if db_meeting:
                        crud.update_meeting(db, db_meeting, {**final_minutes, "status": "completed"})
                        
                        # RAGメタデータの準備と追加
                        ref_date = db_meeting.date or now_jst_naive()
                        await self._add_meeting_data_to_rag(
                            meeting_id=meeting_id,
                            db_meeting=db_meeting,
                            final_minutes=final_minutes,
                            all_results=all_results,
                            ref_date=ref_date
                        )

                        if db_meeting.version_group:
                            db.query(models.Decision).filter(
                                models.Decision.project_id == db_meeting.project_id,
                                models.Decision.meeting_id != meeting_id,
                                models.Decision.superseded == False
                            ).join(models.Meeting).filter(
                                models.Meeting.version_group == db_meeting.version_group
                            ).update({"superseded": True}, synchronize_session=False)
                        for dec_content in final_minutes.get('decisions', []):
                            crud.create_decision(db, schemas.DecisionCreate(
                                meeting_id=meeting_id,
                                content=dec_content,
                                date=ref_date,
                                project_id=db_meeting.project_id
                            ))
                        
                        # 検出されたタスクを MeetingTask テーブルに保存
                        self._save_detected_tasks(db, meeting_id, final_minutes.get('tasks', []))

                        db.commit()
                        logger.info(f"Meeting {meeting_id} analysis completed.")
                finally:
                    db.close()
                    
            except Exception as e:
                logger.error(f"Meeting processing failed (id={meeting_id}): {e}")
                db = SessionLocal()
                try:
                    db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
                    if db_meeting: 
                        crud.update_meeting(db, db_meeting, {"status": "failed"})
                        db.commit()
                finally:
                    db.close()
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

    async def _process_segment_with_retry(self, path: str, index: int, total: int, meeting_id: int) -> Optional[Dict[str, Any]]:
        """セグメントを処理する。
        方針:
        1) 文字起こしは Whisper の【生テキストをそのまま】採用する（LLMに書き換え・補完させない）。
        2) 生テキストが空なら、LLMに架空内容を捏造させないため、そのセグメントはスキップする。
        3) LLMは「本文に実在する情報のみの抽出」だけに使う（決定/タスク/論点/期限）。
        """
        # --- 1) 逐語文字起こし（verbatim）を取得 ---
        raw = ""
        try:
            raw = (await self.llm_client.transcribe_audio(path)).strip()
        except Exception as e:
            logger.warning(f"chunk {index}/{total}: 文字起こし失敗: [{type(e).__name__}] {e}")

        if not raw:
            # 空データをLLMに渡すと音声と無関係な内容を捏造するため、ここで打ち切る
            logger.warning(f"chunk {index}/{total}: 文字起こしが空。捏造防止のためスキップ。")
            return None

        # transcript は生テキストをそのまま保持（この後も一切書き換えない）
        result: Dict[str, Any] = {
            "transcript": raw, "decisions": [], "tasks": [],
            "discussion_points": [], "deadlines": [],
        }

        # --- 2) LLMは「抽出のみ」。文字起こしの再生成・創作は禁止 ---
        segment_info = f"（第 {index} / {total} セグメント）" if total > 1 else ""
        extract_prompt = f"""あなたは会議の文字起こしから重要情報だけを抽出する精密な議事録アシスタントです。{segment_info}

【最重要ルール】
- 出力は必ず日本語。中国語・英語の混在は禁止。
- **下記の文字起こしに実際に含まれる情報だけを抽出**してください。推測・一般論・創作の追加は固く禁止します。該当が無ければそのセクションには「なし」とだけ書いてください。
- 文字起こし本文は出力しないでください（抽出結果のみ）。挨拶・前置き・「改善します」等の締め文句も一切書かないでください。

【対象の文字起こし】
{raw}

【出力フォーマット】（このキーワードだけをセクション区切りに使用し、他の説明文は書かない）
===DECISIONS===
- 決定事項（なければ「なし」）
===TASKS===
- [タイプ] 担当者：内容（期限）
    ※タイプは以下から選択：[design], [documentation], [testing], [review], [meeting], [fx], [asset], [animation], [lighting], [comp]。該当がなければ最適な単語。
===DISCUSSION_POINTS===
- 主要な論点・意見（なければ「なし」）
===DEADLINES===
- 具体的な期限・日程（なければ「なし」）
"""
        max_retries = 2
        for attempt in range(max_retries + 1):
            try:
                if attempt > 0:
                    await asyncio.sleep(min((2 ** attempt) * 10, 60))
                conv_id = f"mtg_{meeting_id}_seg_{index}_v{attempt}"
                response_text = ""
                async for chunk in self.llm_client.stream_chat(
                    extract_prompt, conv_id, {"mode": "utility", "no_actions": True}
                ):
                    if chunk.get("event") == "message":
                        response_text += chunk.get("answer", "")
                    elif chunk.get("event") == "error":
                        raise Exception(chunk.get("message", "Unknown LLM error"))

                if response_text.strip():
                    parsed = self._parse_output(response_text)
                    result["decisions"] = parsed.get("decisions", [])
                    result["tasks"] = parsed.get("tasks", [])
                    result["discussion_points"] = parsed.get("discussion_points", [])
                    result["deadlines"] = parsed.get("deadlines", [])
                    return result
                logger.warning(f"chunk {index}/{total}: 抽出応答が空 (attempt {attempt})")
            except Exception as e:
                logger.error(f"chunk {index}/{total} 抽出エラー (attempt {attempt}): {e}")

        # 抽出に失敗しても、逐語文字起こしは確保できているので返す（transcriptは失わない）
        return result

    def _parse_output(self, text: str) -> Dict[str, Any]:
        """LLMの応答をパースして辞書に格納する"""
        result = {
            "transcript": "",
            "decisions": [],
            "tasks": [],
            "discussion_points": [],
            "deadlines": []
        }
        
        current_section = None
        transcript_lines = []
        
        for line in text.split('\n'):
            line_raw = line.strip()
            if not line_raw:
                if current_section == 'transcript':
                    transcript_lines.append("")
                continue
                
            if '===TRANSCRIPT===' in line_raw:
                current_section = 'transcript'
                continue
            elif '===DECISIONS===' in line_raw:
                current_section = 'decisions'
                continue
            elif '===TASKS===' in line_raw:
                current_section = 'tasks'
                continue
            elif '===DISCUSSION_POINTS===' in line_raw:
                current_section = 'discussion_points'
                continue
            elif '===DEADLINES===' in line_raw:
                current_section = 'deadlines'
                continue
                
            if current_section == 'transcript':
                transcript_lines.append(line)
            elif current_section:
                item = line_raw.lstrip('-*• ').strip()
                if item and item.lower() not in ['なし', 'none'] and not self._is_meta_line(item):
                    # 重複チェック（リスト内）
                    if item not in result[current_section]:
                        result[current_section].append(item)
                    
        result['transcript'] = '\n'.join(transcript_lines).strip()
        return result

    # 構造化セクション(決定事項/タスク/論点/期限)に紛れ込むモデルの前置き・後置き・メタ発話を除外する。
    _META_MARKERS = (
        "セグメント", "以上が", "以上で", "分析結果", "文字起こし", "抽出結果",
        "承知しました", "了解しました", "申し訳", "以下の", "以下に", "出力します",
        "処理を続け", "続けて", "フォーマット", "については以上", "特にありません",
        "情報はありません", "該当なし", "該当する", "見当たりません",
        # モデルが末尾に付けがちな「お手伝い/改善の申し出」系の締め文句。
        # 構造化フィールド（特に期限・日程候補）への混入を防ぐ。
        "フィードバック", "追加情報", "提供いただ", "いただければ", "いただけましたら",
        "改善させ", "改善いたし", "お気軽に", "お知らせください", "ご連絡ください",
        "ご確認ください", "よろしくお願い", "お手伝いし", "サポートさせ",
        "ご質問が", "ご要望が", "遠慮なく", "お申し付け",
    )

    def _is_meta_line(self, item: str) -> bool:
        """決定事項等として不適切な、モデルのナレーション/メタ文かどうかを判定する。"""
        s = item.strip()
        if not s:
            return True
        # 見出し記号だけ、あるいは区切り線
        if set(s) <= set("=-—―*・● "):
            return True
        return any(mk in s for mk in self._META_MARKERS)

    async def _consolidate_results(self, chunk_results: List[Dict[str, Any]], meeting_id: int) -> Dict[str, Any]:
        """全てのチャンク結果を一つの議事録データに統合・整形する"""
        full_transcript = []
        all_decisions = []
        all_tasks = []
        all_points = []
        all_deadlines = []
        
        for r in chunk_results:
            if r.get("transcript"): full_transcript.append(r["transcript"])
            all_decisions.extend(r.get("decisions", []))
            all_tasks.extend(r.get("tasks", []))
            all_points.extend(r.get("discussion_points", []))
            all_deadlines.extend(r.get("deadlines", []))
            
        final_transcript = "\n\n".join(full_transcript)

        # チャンクが1つだけなら、そのまま返す
        if len(chunk_results) == 1:
            return {
                "transcript": final_transcript,
                "decisions": list(dict.fromkeys(all_decisions)),
                "tasks": list(dict.fromkeys(all_tasks)),
                "discussion_points": list(dict.fromkeys(all_points)),
                "deadlines": list(dict.fromkeys(all_deadlines))
            }

        logger.info("Executing final consolidation pass...")
        
        # 抽出項目を整理するためのプロンプト
        summary_prompt = f"""
あなたは、断片的な抽出データと文字起こしを元に、統合された完璧な議事録を作成するシニア・エディターです。
複数のセグメント（時間帯）から抽出された情報を統合し、重複を排除しながら、会議全体としての結論とアクションプランを明確にしてください。

【出力言語（最優先・絶対厳守）】
出力はすべて【必ず日本語】で記述してください。中国語（简体字・繁体字）や英語での出力は固く禁止します。

【提供された断片データ】
決定事項: {all_decisions}
タスク: {all_tasks}
論点: {all_points}
期限: {all_deadlines}

【要件】
1. 重複排除: 同じ内容の決定事項やタスクが複数回出てくる場合、最も詳細なもの一つに統合してください。
2. 矛盾の解消: セグメント間で矛盾する記述がある場合、全体の流れから総合的に判断してください。
3. 構造化: 誰がいつまでに何をすべきか、何が決まったのかを、即座に実行可能なレベルで整理してください。

【出力フォーマット】（厳守。説明なしで直接開始してください）
===DECISIONS===
- 統合・整理された具体的決定事項

===TASKS===
- [タイプ] 担当者：具体的アクション（期限）
    ※タイプ例: [design], [documentation], [fx] 等

===DISCUSSION_POINTS===
- 会議全体の議論の要約と重要な背景

===DEADLINES===
- 整理された具体的スケジュール
"""
        try:
            accumulated_summary = ""
            # テキスト統合なので attachments は不要
            async for chunk in self.llm_client.stream_chat(summary_prompt, f"mtg_{meeting_id}_final", {"mode": "utility", "no_actions": True}):
                if chunk.get("event") == "message":
                    accumulated_summary += chunk.get("answer", "")
            
            summary_res = self._parse_output(accumulated_summary)
            # 文字起こしは元の結合したものを保持
            summary_res["transcript"] = final_transcript
            
            # 補完セーフティ: 統合AIが失敗（空）を返した場
            if not summary_res["decisions"] and all_decisions:
                summary_res["decisions"] = list(dict.fromkeys(all_decisions))
            if not summary_res["tasks"] and all_tasks:
                summary_res["tasks"] = list(dict.fromkeys(all_tasks))
            
            return summary_res
        except Exception as e:
            logger.error(f"Final consolidation failed: {e}. Falling back to simple merge.")
            return {
                "transcript": final_transcript,
                "decisions": list(dict.fromkeys(all_decisions)),
                "tasks": list(dict.fromkeys(all_tasks)),
                "discussion_points": list(dict.fromkeys(all_points)),
                "deadlines": list(dict.fromkeys(all_deadlines))
            }

    async def _add_meeting_data_to_rag(
        self, 
        meeting_id: int, 
        db_meeting: models.Meeting, 
        final_minutes: Dict[str, Any], 
        all_results: List[Dict[str, Any]], 
        ref_date: Any
    ):
        """議事録の全文、セグメント、重要構造化データ（決定事項、タスク、論点、期限）をRAGに追加する"""
        rag_metadata = {
            "meeting_id": meeting_id, 
            "title": db_meeting.title, 
            "project_id": db_meeting.project_id,
            "version_group": db_meeting.version_group,
            "type": "meeting",
            "date": ref_date.isoformat()
        }
        
        docs_to_add = []
        date_str = ref_date.strftime("%Y-%m-%d") if hasattr(ref_date, "strftime") else str(ref_date)[:10]

        # 1. 文字起こし全文 (transcript) のChunk分割してRAGに追加
        raw_transcript = final_minutes.get('transcript', '') or db_meeting.transcript or ""
        if raw_transcript.strip():
            chunks = []
            start = 0
            chunk_size = 4000
            overlap = 500
            while start < len(raw_transcript):
                end = start + chunk_size
                chunks.append(raw_transcript[start:end])
                if end >= len(raw_transcript):
                    break
                start += chunk_size - overlap
                
            for idx, chunk in enumerate(chunks):
                chunk_text_data = f"【会議発言録チャンク {idx+1}/{len(chunks)}】 会議: {db_meeting.title} ({date_str}), 内容:\n{chunk}"
                chunk_metadata = rag_metadata.copy()
                chunk_metadata["type"] = "meeting_transcript_chunk"
                chunk_metadata["content_type"] = "transcript_chunk"
                chunk_metadata["chunk_index"] = idx
                docs_to_add.append(Document(text=chunk_text_data, metadata=chunk_metadata))

        # 2. 個別のセグメント（チャンク）もRAGに追加
        if len(all_results) > 1:
            for idx, segment in enumerate(all_results):
                seg_transcript = segment.get("transcript")
                if seg_transcript:
                    seg_metadata = rag_metadata.copy()
                    seg_metadata["segment_index"] = idx
                    seg_metadata["type"] = "meeting_segment"
                    seg_text = f"--- [Segment {idx+1}/{len(all_results)}] {db_meeting.title} ---\n{seg_transcript}"
                    docs_to_add.append(Document(text=seg_text, metadata=seg_metadata))

        # 3. 意味単位で構造化したナレッジ（決定事項、タスク、論点、期限）を個別にRAGに追加
        project_name = db_meeting.project.name if db_meeting.project else "不明"

        # 決定事項 (decisions)
        for dec in final_minutes.get('decisions', []):
            if dec and dec.strip():
                dec_text = f"【決定事項】 会議: {db_meeting.title} ({date_str}), プロジェクト: {project_name}, 内容: {dec}"
                dec_metadata = rag_metadata.copy()
                dec_metadata["type"] = "meeting_decision"
                dec_metadata["content_type"] = "decision"
                docs_to_add.append(Document(text=dec_text, metadata=dec_metadata))

        # タスク (tasks)
        for tsk in final_minutes.get('tasks', []):
            if tsk and tsk.strip():
                tsk_text = f"【タスク】 会議: {db_meeting.title} ({date_str}), プロジェクト: {project_name}, 内容: {tsk}"
                tsk_metadata = rag_metadata.copy()
                tsk_metadata["type"] = "meeting_task"
                tsk_metadata["content_type"] = "task"
                docs_to_add.append(Document(text=tsk_text, metadata=tsk_metadata))

        # 論点 (discussion_points)
        for dp in final_minutes.get('discussion_points', []):
            if dp and dp.strip():
                dp_text = f"【論点・議論】 会議: {db_meeting.title} ({date_str}), プロジェクト: {project_name}, 内容: {dp}"
                dp_metadata = rag_metadata.copy()
                dp_metadata["type"] = "meeting_discussion_point"
                dp_metadata["content_type"] = "discussion_point"
                docs_to_add.append(Document(text=dp_text, metadata=dp_metadata))

        # 期限・日程候補 (deadlines)
        for dl in final_minutes.get('deadlines', []):
            if dl and dl.strip():
                dl_text = f"【期限・日程】 会議: {db_meeting.title} ({date_str}), プロジェクト: {project_name}, 内容: {dl}"
                dl_metadata = rag_metadata.copy()
                dl_metadata["type"] = "meeting_deadline"
                dl_metadata["content_type"] = "deadline"
                docs_to_add.append(Document(text=dl_text, metadata=dl_metadata))
                
        # まとめてRAGに登録 (ディスクI/Oのボトルネック防止)
        if docs_to_add:
            await rag_service.add_documents(docs_to_add)

    def _save_detected_tasks(self, db: Session, meeting_id: int, tasks: List[str]):
        """議事録から検出されたタスクを MeetingTask テーブルに解析・保存する"""
        import re
        for task_str in tasks:
            # 解析ロジック: [タイプ] 担当者：内容（期限）
            m_type = re.search(r'\[(.*?)\]', task_str)
            task_type = m_type.group(1) if m_type else None
            
            remaining = task_str
            if m_type: 
                remaining = remaining.replace(m_type.group(0), "").strip()
            
            assignee = None
            if "：" in remaining:
                parts = remaining.split("：", 1)
                assignee = parts[0].strip()
                remaining = parts[1].strip()
                # 先頭のリストマーカーを除去
                assignee = assignee.lstrip('-*• ').strip()
            
            m_date = re.search(r'\((.*?)\)', remaining)
            if m_date:
                # 内容から期限表記を除去
                remaining = remaining.replace(m_date.group(0), "").strip()
            
            crud.create_meeting_task(db, schemas.MeetingTaskCreate(
                meeting_id=meeting_id,
                content=remaining.lstrip('-*• ').strip(),
                type=task_type,
                assignee_suggestion=assignee,
                status="detected"
            ))

