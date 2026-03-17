import os
import logging
import json
import asyncio
import pathlib
import tempfile
import shutil
import mimetypes
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from .. import crud, models, schemas
from .llm import LLMClient
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

class MeetingAnalyzer:
    def __init__(self, api_key: str):
        if not api_key:
            logger.warning("GOOGLE_API_KEY is not set for MeetingAnalyzer")
        self.llm_client = LLMClient(api_key=api_key)
        # 確実に安定しているモデルを使用
        self.llm_client.model_name = "models/gemini-2.0-flash" 

    async def _get_duration(self, audio_path: str) -> float:
        """ffprobeを使用して音声の長さを取得する（Windows対応強化）"""
        abs_path = os.path.abspath(audio_path)
        if not os.path.exists(abs_path):
            logger.error(f"Audio file not found: {abs_path}")
            return 0
            
        try:
            # shell=Trueを使うことで、WindowsのPATH解決を確実にする
            # パスを二重引用符で囲み、エスケープが必要な文字が含まれている場合に対応
            cmd = f'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "{abs_path}"'
            process = await asyncio.create_subprocess_shell(
                cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            if process.returncode == 0:
                d_str = stdout.decode().strip()
                return float(d_str) if d_str else 0
            else:
                logger.warning(f"ffprobe returned non-zero exit code: {process.returncode}, stderr: {stderr.decode()}")
        except Exception as e:
            logger.warning(f"ffprobe duration check failed: {e}")
        return 0

    async def _split_audio(self, audio_path: str, chunk_size_sec: int, output_dir: str) -> List[str]:
        """ffmpegを使用して音声を分割する"""
        try:
            abs_audio_path = os.path.abspath(audio_path)
            # 元のファイル拡張子を維持
            ext = pathlib.Path(abs_audio_path).suffix or ".mp3"
            output_pattern = os.path.join(output_dir, f"chunk_%03d{ext}")
            
            # segment muxerを使用して非エンコードで高速分割
            # -segment_time で長さを指定
            cmd = f'ffmpeg -i "{abs_audio_path}" -f segment -segment_time {chunk_size_sec} -c copy "{output_pattern}"'
            process = await asyncio.create_subprocess_shell(
                cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                chunks = sorted([
                    os.path.join(output_dir, f) 
                    for f in os.listdir(output_dir) 
                    if f.startswith("chunk_")
                ])
                logger.info(f"Split audio into {len(chunks)} chunks.")
                return chunks
            else:
                logger.error(f"ffmpeg split failed: {stderr.decode()}")
        except Exception as e:
            logger.error(f"Failed to split audio: {e}")
        return []

    async def analyze_meeting(self, meeting_id: int, audio_path: str):
        """音声を分割し、レート制限に配慮しながら段階的に解析・統合する"""
        from ..database import SessionLocal
        db = SessionLocal()
        try:
            db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
            if not db_meeting: 
                logger.error(f"Meeting {meeting_id} not found in DB.")
                return
            crud.update_meeting(db, db_meeting, {"status": "processing"})
        finally:
            db.close()

        temp_dir = tempfile.mkdtemp()
        try:
            # 1. 音声分割（5分ごと）でトークン制限と429を回避
            # 文字起こし精度を上げるため、10分から5分に短縮
            duration = await self._get_duration(audio_path)
            chunk_size = 300 # 5分
            
            logger.info(f"Meeting duration: {duration:.1f}s")
            
            if duration > (chunk_size + 30):
                logger.info(f"Splitting meeting into {chunk_size}s chunks...")
                chunk_paths = await self._split_audio(audio_path, chunk_size, temp_dir)
            else:
                chunk_paths = [audio_path]
            
            if not chunk_paths: 
                logger.warning("Split failed or no chunks, falling back to original path.")
                chunk_paths = [audio_path]

            all_results = []
            for i, path in enumerate(chunk_paths):
                logger.info(f"Processing chunk {i+1}/{len(chunk_paths)}: {path}")
                
                # チャンクごとに文字起こしと構造化を行う
                res = await self._process_segment_with_retry(path, i+1, len(chunk_paths), meeting_id)
                if res:
                    all_results.append(res)
                else:
                    logger.error(f"Failed to process chunk {i+1}")
                
                # レート制限(429)回避のため、チャンク間に待機を入れる
                if i < len(chunk_paths) - 1:
                    await asyncio.sleep(10)

            if not all_results:
                raise Exception("No results obtained from any segment.")

            # 2. 全結果の統合
            logger.info("Final Phase: Consolidating results...")
            final_minutes = await self._consolidate_results(all_results, meeting_id)
            
            db = SessionLocal()
            try:
                db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
                if db_meeting:
                    crud.update_meeting(db, db_meeting, {**final_minutes, "status": "completed"})
                    logger.info(f"Meeting {meeting_id} analysis completed.")
            finally:
                db.close()
                
        except Exception as e:
            logger.error(f"Meeting processing failed: {e}")
            import traceback
            traceback.print_exc()
            db = SessionLocal()
            try:
                db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
                if db_meeting: crud.update_meeting(db, db_meeting, {"status": "failed"})
            finally:
                db.close()
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    async def _process_segment_with_retry(self, path: str, index: int, total: int, meeting_id: int) -> Optional[Dict[str, Any]]:
        """リトライとバックオフ付きでセグメントを処理する"""
        max_retries = 3
        for attempt in range(max_retries + 1):
            try:
                segment_info = f"（第 {index} / {total} セグメント）" if total > 1 else ""
                
                prompt = f"""
あなたは、会議音声を詳細に分析し、重要な情報を一切漏らさない精密な議事録を作成するプロフェッショナルAIエディターです。
現在、会議音声の{segment_info}を処理しています。

以下の【要件】に厳密に従って、出力を生成してください。

【要件】
1. 逐次、詳細な文字起こし:
   - 日本語で全文を文字起こししてください。
   - 発言者（A, B, C... または会話から推測される名前）を特定し、発言ごとに以下のタグを先頭に付与してください。
     [議題] [提案] [決定] [タスク] [質問] [雑談]
   - 相槌（「あー」「うん」「はい」等）や言い直しを適宜削り、読みやすく整形してください。
   - **要約するのではなく、具体的に誰が何を言ったかを詳細に残すこと**を最優先してください。

2. 重要情報の抽出:
   - 決定事項: 会議で合意された、または決定した方針。
   - タスク: 「誰が」「いつまでに」「何をするか」。些細な依頼もすべて抽出してください。
   - 論点: 議論されているポイント、出された意見、懸案事項。
   - スケジュール: 具体的日程、期限、次回の予定。

【出力フォーマット】（以下のキーワードをセクション区切りとして使用し、それ以外の説明は不要です）
===TRANSCRIPT===
（タグ付き文字起こし全文）

===DECISIONS===
- 決定事項のリスト（なければ「なし」）

===TASKS===
- 担当者：内容（期限）（なければ「なし」）

===DISCUSSION_POINTS===
- 主要な論点・意見のリスト（なければ「なし」）

===DEADLINES===
- 具体的期限・日程のリスト（なければ「なし」）
"""
                inputs = {"mode": "admin", "attachments": [path]}
                response_text = ""
                
                # 指数バックオフ
                if attempt > 0:
                    wait = (2 ** attempt) * 15
                    logger.info(f"Retry {attempt}/{max_retries} for chunk {index}. Waiting {wait}s...")
                    await asyncio.sleep(wait)
                
                # 会話履歴が干渉しないよう、セグメントごとにユニークなIDを使用
                conv_id = f"mtg_{meeting_id}_seg_{index}_v{attempt}"
                
                async for chunk in self.llm_client.stream_chat(prompt, conv_id, inputs):
                    if chunk.get("event") == "message":
                        response_text += chunk.get("answer", "")
                
                if response_text.strip():
                    parsed = self._parse_output(response_text)
                    # 文字起こしが含まれていれば成功とみなす
                    if parsed.get("transcript"):
                        return parsed
                
                logger.warning(f"Empty response for chunk {index}, attempt {attempt}")
                    
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    logger.warning(f"Rate limit hit at chunk {index}.")
                    if attempt == max_retries: break # 最後のリトライなら諦める
                    # バックオフは次のループ開始時に sleep する
                else:
                    logger.error(f"Segment {index} processing error: {e}")
                    if attempt == max_retries: break
        return None

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
                if item and item.lower() not in ['なし', 'none']:
                    # 重複チェック（リスト内）
                    if item not in result[current_section]:
                        result[current_section].append(item)
                    
        result['transcript'] = '\n'.join(transcript_lines).strip()
        return result

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
- 担当者：具体的アクション（期限）

===DISCUSSION_POINTS===
- 会議全体の議論の要約と重要な背景

===DEADLINES===
- 整理された具体的スケジュール
"""
        try:
            accumulated_summary = ""
            # テキスト統合なので attachments は不要
            async for chunk in self.llm_client.stream_chat(summary_prompt, f"mtg_{meeting_id}_final", {"mode": "admin"}):
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
