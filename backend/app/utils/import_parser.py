import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Optional


alias_map = {
    "sl_no":         ["sl no.", "sl\nno.", "slno", "sl_no"],
    "cut":           ["cut"],
    "thumbnail_url": ["thumbnail", "thumnail", "サムネイル"],
    "frame_in":      ["in"],
    "frame_out":     ["out"],
    "duration":      ["duration", "デュレーション"],
    "second":        ["second", "sec"],
    "frame_rem":     ["frame", "フレーム"],
    "action":        ["action", "アクション"],
    "dialogue":      ["dialogue", "dialog"],
    "bg":            ["bg", "背景"],
    "ch":            ["ch", "キャラ", "character"],
    "prop":          ["prop", "プロップ"],
    "task_lay":      ["lay", "レイアウト"],
    "task_anim":     ["anim", "animation", "アニメ"],
    "task_fx":       ["fx", "エフェクト"],
    "task_lighting": ["lighting", "ライティング"],
    "task_comp":     ["comp", "コンポジット"],
    "note":          ["note", "ノート", "備考"],
}

INT_FIELDS = {"sl_no", "frame_in", "frame_out", "duration", "second", "frame_rem"}


def normalize_header(h: str) -> str:
    return re.sub(r'[\s\n\r]+', '', str(h)).lower()


def map_headers(raw_headers: list) -> tuple:
    """Returns (col_index -> db_field dict, warnings list)."""
    normalized_aliases = {}
    for db_field, aliases in alias_map.items():
        for alias in aliases:
            normalized_aliases[normalize_header(alias)] = db_field

    mapping = {}
    warnings = []
    for idx, raw in enumerate(raw_headers):
        norm = normalize_header(raw)
        if norm in normalized_aliases:
            mapping[idx] = normalized_aliases[norm]
        else:
            warnings.append({
                "row": 1,
                "field": raw,
                "level": "warning",
                "message": f"Unknown header '{raw}' at column {idx + 1} — ignored",
            })
    return mapping, warnings


def cast_int(val) -> tuple:
    if val is None or (isinstance(val, str) and val.strip() == ""):
        return None, None
    try:
        return int(val), None
    except (ValueError, TypeError):
        return None, f"Cannot cast '{val}' to int"


def is_skip_row(row_data: dict) -> bool:
    sl_no_val = row_data.get("sl_no")
    if sl_no_val is not None:
        try:
            int(sl_no_val)
        except (ValueError, TypeError):
            return True
    all_none = all(v is None or (isinstance(v, str) and v.strip() == "") for v in row_data.values())
    return all_none


def extract_embedded_images(ws, file_bytes: bytes = None) -> dict:
    """Returns {data_row_index: (image_bytes, format)} for embedded images.

    data_row_index is 0-based counting from the first data row (after header).
    Tries openpyxl first; falls back to drawing1.xml direct parse for TwoCellAnchor
    files where openpyxl returns no images.
    """
    image_map = {}

    # --- openpyxl path ---
    openpyxl_images = list(getattr(ws, '_images', []))
    if openpyxl_images:
        for img in openpyxl_images:
            try:
                anchor = img.anchor
                if not hasattr(anchor, '_from'):
                    continue
                data_row = anchor._from.row - 1  # _from.row is 0-indexed; row 0 = header
                if data_row < 0:
                    continue
                image_bytes = img._data()
                if image_bytes:
                    fmt = (getattr(img, 'format', None) or 'png').lower()
                    image_map[data_row] = (image_bytes, fmt)
            except Exception:
                pass
        return image_map

    # --- fallback: drawing1.xml direct parse ---
    if file_bytes is None:
        return image_map

    _NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
    _NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    _NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    _NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'

    try:
        from io import BytesIO
        with zipfile.ZipFile(BytesIO(file_bytes), 'r') as zf:
            names = set(zf.namelist())

            # Find first drawing XML
            drawing_xml = None
            for n in sorted(names):
                if re.match(r'xl/drawings/drawing\d+\.xml$', n):
                    drawing_xml = n
                    break
            if not drawing_xml:
                return image_map

            rels_path = drawing_xml.replace('drawings/', 'drawings/_rels/') + '.rels'
            if rels_path not in names:
                return image_map

            # Build rId → media path mapping
            rels_root = ET.fromstring(zf.read(rels_path))
            id_to_media = {}
            for rel in rels_root.findall(f'{{{_NS_PKG}}}Relationship'):
                rid = rel.get('Id')
                target = rel.get('Target', '')
                # target is relative: '../media/image1.JPG' → 'xl/media/image1.JPG'
                media_path = 'xl/' + re.sub(r'^\.\./', '', target)
                id_to_media[rid] = media_path

            # Parse anchors
            tree = ET.fromstring(zf.read(drawing_xml))
            for anchor_tag in (
                f'{{{_NS_XDR}}}twoCellAnchor',
                f'{{{_NS_XDR}}}oneCellAnchor',
                f'{{{_NS_XDR}}}absoluteAnchor',
            ):
                for anchor in tree.findall(anchor_tag):
                    from_elem = anchor.find(f'{{{_NS_XDR}}}from')
                    if from_elem is None:
                        continue
                    row_elem = from_elem.find(f'{{{_NS_XDR}}}row')
                    if row_elem is None:
                        continue
                    # drawing XML row is 0-indexed; header=row0, first data=row1
                    anchor_row = int(row_elem.text)
                    data_row = anchor_row - 1
                    if data_row < 0:
                        continue

                    blip = anchor.find(f'.//{{{_NS_A}}}blip')
                    if blip is None:
                        continue
                    rid = blip.get(f'{{{_NS_R}}}embed')
                    if rid not in id_to_media:
                        continue
                    media_path = id_to_media[rid]
                    if media_path not in names:
                        continue

                    img_bytes = zf.read(media_path)
                    ext = media_path.rsplit('.', 1)[-1].lower() if '.' in media_path else 'jpg'
                    if ext == 'jpeg':
                        ext = 'jpg'
                    image_map[data_row] = (img_bytes, ext)
    except Exception:
        pass

    return image_map


@dataclass
class ParsedShot:
    cut: Optional[str]
    sl_no: Optional[int]
    frame_in: Optional[int]
    frame_out: Optional[int]
    duration: Optional[int]
    second: Optional[int]
    frame_rem: Optional[int]
    action: Optional[str]
    dialogue: Optional[str]
    bg: Optional[str]
    ch: Optional[str]
    prop: Optional[str]
    task_lay: Optional[str]
    task_anim: Optional[str]
    task_fx: Optional[str]
    task_lighting: Optional[str]
    task_comp: Optional[str]
    note: Optional[str]
    thumbnail_url: Optional[str]
    row_number: int
    image_data: Optional[bytes] = None
    image_format: Optional[str] = None


@dataclass
class ParseResult:
    shots: list
    warnings: list
    total_rows: int
    skipped_rows: int


def _cell_to_str(val) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def parse_xlsx(file_bytes: bytes, sheet_name: Optional[str] = None) -> ParseResult:
    import openpyxl
    from io import BytesIO

    wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
    ws = wb[sheet_name] if sheet_name else wb.active

    embedded_images = extract_embedded_images(ws, file_bytes=file_bytes)

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return ParseResult(shots=[], warnings=[], total_rows=0, skipped_rows=0)

    raw_headers = [str(c) if c is not None else "" for c in rows[0]]
    col_map, header_warnings = map_headers(raw_headers)

    warnings = list(header_warnings)
    shots = []
    skipped = 0
    seen_sl_no = {}

    data_rows = rows[1:]
    total_rows = len(data_rows)

    for row_idx, row in enumerate(data_rows):
        excel_row = row_idx + 2  # 1-based, header is row 1

        raw = {}
        for col_idx, db_field in col_map.items():
            raw[db_field] = row[col_idx] if col_idx < len(row) else None

        if is_skip_row(raw):
            skipped += 1
            continue

        # cast int fields
        cast = {}
        for db_field in INT_FIELDS:
            val = raw.get(db_field)
            int_val, err = cast_int(val)
            cast[db_field] = int_val
            if err:
                warnings.append({
                    "row": excel_row,
                    "field": db_field,
                    "level": "warning",
                    "message": err,
                })

        # sl_no duplicate check
        sl_no = cast.get("sl_no")
        if sl_no is not None:
            if sl_no in seen_sl_no:
                warnings.append({
                    "row": excel_row,
                    "field": "sl_no",
                    "level": "warning",
                    "message": f"Duplicate sl_no={sl_no} (first seen at row {seen_sl_no[sl_no]})",
                })
            else:
                seen_sl_no[sl_no] = excel_row

        cut = _cell_to_str(raw.get("cut"))
        if not cut:
            warnings.append({
                "row": excel_row,
                "field": "cut",
                "level": "warning",
                "message": "cut is empty",
            })

        # WARNING 1: frame_out <= frame_in の矛盾
        frame_in = cast.get("frame_in")
        frame_out = cast.get("frame_out")
        duration = cast.get("duration")
        if frame_in is not None and frame_out is not None:
            if frame_out <= frame_in:
                warnings.append({
                    "row": excel_row,
                    "field": "frame_out",
                    "level": "warning",
                    "message": f"frame_out({frame_out}) <= frame_in({frame_in}): 矛盾した値"
                })
            # WARNING 2: duration/in-out 矛盾
            if duration is not None:
                expected_duration = frame_out - frame_in + 1  # inclusive: out=84,in=1 → 84 frames
                if duration != expected_duration:
                    warnings.append({
                        "row": excel_row,
                        "field": "duration",
                        "level": "warning",
                        "message": f"duration({duration}) != out-in({expected_duration}): 計算値と不一致"
                    })

        # WARNING 3: thumbnail_url 型エラー
        thumb_raw = raw.get("thumbnail_url")
        if thumb_raw is None or (isinstance(thumb_raw, str) and thumb_raw.strip() == ""):
            thumbnail_url = None
        elif isinstance(thumb_raw, str):
            thumbnail_url = thumb_raw.strip() or None
        else:
            warnings.append({
                "row": excel_row,
                "field": "thumbnail_url",
                "level": "warning",
                "message": f"thumbnail_url が文字列でない型({type(thumb_raw).__name__}): Noneとして処理"
            })
            thumbnail_url = None

        # Use embedded image only when no URL column value is present (URL column takes priority)
        img_data, img_fmt = None, None
        if thumbnail_url is None and row_idx in embedded_images:
            img_data, img_fmt = embedded_images[row_idx]

        shot = ParsedShot(
            cut=cut,
            sl_no=sl_no,
            frame_in=frame_in,
            frame_out=frame_out,
            duration=duration,
            second=cast.get("second"),
            frame_rem=cast.get("frame_rem"),
            action=_cell_to_str(raw.get("action")),
            dialogue=_cell_to_str(raw.get("dialogue")),
            bg=_cell_to_str(raw.get("bg")),
            ch=_cell_to_str(raw.get("ch")),
            prop=_cell_to_str(raw.get("prop")),
            task_lay=_cell_to_str(raw.get("task_lay")),
            task_anim=_cell_to_str(raw.get("task_anim")),
            task_fx=_cell_to_str(raw.get("task_fx")),
            task_lighting=_cell_to_str(raw.get("task_lighting")),
            task_comp=_cell_to_str(raw.get("task_comp")),
            note=_cell_to_str(raw.get("note")),
            thumbnail_url=thumbnail_url,
            row_number=excel_row,
            image_data=img_data,
            image_format=img_fmt,
        )
        shots.append(shot)

    # WARNING 4: 同一バッチ内の cut 重複チェック
    from collections import Counter
    cut_counter = Counter(s.cut for s in shots if s.cut is not None)
    for cut_val, count in cut_counter.items():
        if count > 1:
            dup_rows = [s.row_number for s in shots if s.cut == cut_val]
            warnings.append({
                "row": dup_rows[0],
                "field": "cut",
                "level": "warning",
                "message": f"cut={cut_val!r} が {count}行で重複: rows={dup_rows}"
            })

    return ParseResult(
        shots=shots,
        warnings=warnings,
        total_rows=total_rows,
        skipped_rows=skipped,
    )
