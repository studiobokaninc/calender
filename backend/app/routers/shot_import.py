import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Union

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas, security
from ..database import get_db
from ..utils.import_parser import parse_xlsx

router = APIRouter(prefix="/api/projects", tags=["shot_import"])

_STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
_THUMBNAIL_DIR = _STATIC_DIR / "uploads" / "thumbnails"
_THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)


def _save_thumbnail(image_bytes: bytes, shot_code: str, fmt: str = "png") -> str:
    """Save image bytes to thumbnails dir and return the static URL path."""
    safe_code = re.sub(r'[^A-Za-z0-9_\-]', '_', shot_code) if shot_code else "shot"
    filename = f"{safe_code}_{uuid.uuid4().hex[:8]}.{fmt}"
    dest = _THUMBNAIL_DIR / filename
    dest.write_bytes(image_bytes)
    return f"/static/uploads/thumbnails/{filename}"


@router.post(
    "/{project_id}/shots/import",
    response_model=Union[schemas.ShotImportPreview, schemas.ShotImportResult],
    status_code=200,
)
async def import_shots(
    project_id: int,
    file: UploadFile = File(...),
    dry_run: bool = Query(True),
    sheet_name: Optional[str] = Query(None),
    seq_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    filename = file.filename or ""
    if not (filename.endswith(".xlsx") or filename.endswith(".csv")):
        raise HTTPException(status_code=400, detail="xlsx/csv のみ対応")

    target_seq_code = seq_code.strip() if seq_code and seq_code.strip() else "SEQ_PM"

    contents = await file.read()
    parse_result = parse_xlsx(contents, sheet_name=sheet_name)

    # BUG2修正: is_deleted 不問で全shot取得（論理削除済レコードも含む）
    # シーケンスID毎にショットを一意とするため、該当プロジェクトかつ該当シーケンスのショットのみ取得
    existing = db.query(models.Shot).filter(
        models.Shot.project_id == project_id,
        models.Shot.seq_code == target_seq_code
    ).all()
    existing_by_cut = {s.cut: s for s in existing if s.cut is not None}

    to_insert, to_update, unchanged = [], [], []
    now = datetime.utcnow()
    for parsed in parse_result.shots:
        if parsed.cut is None:
            continue
        if parsed.cut in existing_by_cut:
            existing_shot = existing_by_cut[parsed.cut]
            if existing_shot.is_deleted:
                # BUG2修正: 論理削除済 → restore + 全列更新として扱う
                existing_shot.is_deleted = False
                existing_shot.deleted_at = None
                to_update.append((existing_shot, parsed))
            else:
                # BUG1修正: 全18列で差分比較
                has_diff = any([
                    existing_shot.seq_code != target_seq_code,
                    existing_shot.sl_no != parsed.sl_no,
                    existing_shot.frame_in != parsed.frame_in,
                    existing_shot.frame_out != parsed.frame_out,
                    existing_shot.duration != parsed.duration,
                    existing_shot.second != parsed.second,
                    existing_shot.frame_rem != parsed.frame_rem,
                    existing_shot.action != parsed.action,
                    existing_shot.dialogue != parsed.dialogue,
                    existing_shot.bg != parsed.bg,
                    existing_shot.ch != parsed.ch,
                    existing_shot.prop != parsed.prop,
                    existing_shot.task_lay != parsed.task_lay,
                    existing_shot.task_anim != parsed.task_anim,
                    existing_shot.task_fx != parsed.task_fx,
                    existing_shot.task_lighting != parsed.task_lighting,
                    existing_shot.task_comp != parsed.task_comp,
                    existing_shot.note != parsed.note,
                    existing_shot.thumbnail_url != parsed.thumbnail_url,
                ])
                if has_diff:
                    to_update.append((existing_shot, parsed))
                else:
                    unchanged.append(parsed)
        else:
            to_insert.append(parsed)

    excel_cuts = {p.cut for p in parse_result.shots if p.cut}
    # BUG2修正: 論理削除候補は is_deleted=False のものでExcelにないcutのみ
    to_delete = [
        s for cut, s in existing_by_cut.items()
        if cut not in excel_cuts and not s.is_deleted
    ]

    if dry_run:
        preview_rows = []
        for p in parse_result.shots[:5]:
            d = vars(p).copy()
            d.pop("image_data", None)
            d.pop("image_format", None)
            d["seq_code"] = target_seq_code
            preview_rows.append(d)
        return schemas.ShotImportPreview(
            total=len(parse_result.shots),
            to_insert=len(to_insert),
            to_update=len(to_update),
            to_delete_candidates=len(to_delete),
            unchanged=len(unchanged),
            warnings=[schemas.ShotImportWarning(**w) for w in parse_result.warnings],
            preview_rows=preview_rows,
        )


    # BUG3修正: INSERTリストの重複cutを排除（先出し優先）
    seen_cuts = set()
    deduped_insert = []
    for parsed in to_insert:
        if parsed.cut is None or parsed.cut not in seen_cuts:
            deduped_insert.append(parsed)
            if parsed.cut is not None:
                seen_cuts.add(parsed.cut)

    inserted_count = 0
    for parsed in deduped_insert:
        thumb_url = parsed.thumbnail_url
        if thumb_url is None and parsed.image_data is not None:
            thumb_url = _save_thumbnail(parsed.image_data, parsed.cut or "shot", parsed.image_format or "png")
        shot = models.Shot(
            project_id=project_id,
            seq_code=target_seq_code,
            shot_code=parsed.cut,
            cut=parsed.cut,
            sl_no=parsed.sl_no,
            frame_in=parsed.frame_in,
            frame_out=parsed.frame_out,
            duration=parsed.duration,
            second=parsed.second,
            frame_rem=parsed.frame_rem,
            action=parsed.action,
            dialogue=parsed.dialogue,
            bg=parsed.bg,
            ch=parsed.ch,
            prop=parsed.prop,
            task_lay=parsed.task_lay,
            task_anim=parsed.task_anim,
            task_fx=parsed.task_fx,
            task_lighting=parsed.task_lighting,
            task_comp=parsed.task_comp,
            note=parsed.note,
            thumbnail_url=thumb_url,
            is_deleted=False,
            display_order=parsed.sl_no or 0,
            created_at=now,
            updated_at=now,
        )
        db.add(shot)
        inserted_count += 1

    updated_count = 0
    for existing_shot, parsed in to_update:
        thumb_url = parsed.thumbnail_url
        if thumb_url is None and parsed.image_data is not None:
            thumb_url = _save_thumbnail(parsed.image_data, parsed.cut or "shot", parsed.image_format or "png")
        existing_shot.seq_code = target_seq_code
        existing_shot.sl_no = parsed.sl_no
        existing_shot.frame_in = parsed.frame_in
        existing_shot.frame_out = parsed.frame_out
        existing_shot.duration = parsed.duration
        existing_shot.second = parsed.second
        existing_shot.frame_rem = parsed.frame_rem
        existing_shot.action = parsed.action
        existing_shot.dialogue = parsed.dialogue
        existing_shot.bg = parsed.bg
        existing_shot.ch = parsed.ch
        existing_shot.prop = parsed.prop
        existing_shot.task_lay = parsed.task_lay
        existing_shot.task_anim = parsed.task_anim
        existing_shot.task_fx = parsed.task_fx
        existing_shot.task_lighting = parsed.task_lighting
        existing_shot.task_comp = parsed.task_comp
        existing_shot.note = parsed.note
        existing_shot.thumbnail_url = thumb_url
        existing_shot.updated_at = now
        updated_count += 1

    deleted_count = 0
    for shot in to_delete:
        shot.is_deleted = True
        shot.deleted_at = now
        deleted_count += 1

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="一意制約違反: 同一 cut+project_id が重複しています",
        )

    return schemas.ShotImportResult(
        inserted=inserted_count,
        updated=updated_count,
        deleted_candidates=deleted_count,
        skipped=parse_result.skipped_rows,
        warnings=[schemas.ShotImportWarning(**w) for w in parse_result.warnings],
    )
