"""定例(繰り返し予定)の規則の文法と、読み出し時の展開(cmd_731 / subtask_731a)。

規則は Event.recurrence_rule に文字列1本で持つ(DBは1行のまま・展開した回は保存しない)。
文法は iCalendar RRULE の部分集合。受け付ける部分集合は docs/event_recurrence_2026-10-08.md に明記する。
受け付けぬ指定は黙って無視せず RecurrenceError で断る。

展開関数は expand_events() 一つ。三経路 (crud.get_events / routers.score.get_my_events /
routers.readonly.list_events) がすべてこれを使う。経路ごとに別実装を書かぬ事。
"""
import calendar
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Callable, Iterable, List, Optional

# ---- 上限(暴れ止め) ----
MAX_INTERVAL = 100
MAX_COUNT = 1000
MAX_RULE_LENGTH = 200
MAX_OCCURRENCES_PER_RULE = 400  # 1規則が1回の問いで返す最大回数(1年の毎日が収まる)
MAX_EXPANDED_TOTAL = 5000       # 1回の問いで展開して返す総数

_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
_FREQS = ("DAILY", "WEEKLY", "MONTHLY")
_ALLOWED_KEYS = {"FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL"}


class RecurrenceError(ValueError):
    """規則が文法外、または展開の上限を超える問い。"""


def parse_rule(rule: str) -> dict:
    """規則文字列を検証し dict に直す。受け付けぬ指定は RecurrenceError。"""
    if not isinstance(rule, str) or not rule.strip():
        raise RecurrenceError("規則が空です")
    text = rule.strip()
    if len(text) > MAX_RULE_LENGTH:
        raise RecurrenceError("規則が長すぎます")
    if text.upper().startswith("RRULE:"):
        text = text[6:]
    parts = {}
    for chunk in text.split(";"):
        if not chunk:
            continue
        if "=" not in chunk:
            raise RecurrenceError(f"規則の形式が不正です: {chunk}")
        key, value = chunk.split("=", 1)
        key = key.strip().upper()
        value = value.strip().upper()
        if key not in _ALLOWED_KEYS:
            raise RecurrenceError(f"受け付けぬ指定です: {key}")
        if key in parts:
            raise RecurrenceError(f"指定が重複しています: {key}")
        if not value:
            raise RecurrenceError(f"値がありません: {key}")
        parts[key] = value

    freq = parts.get("FREQ")
    if freq not in _FREQS:
        raise RecurrenceError("FREQ は DAILY/WEEKLY/MONTHLY のいずれかが必須です")

    interval = 1
    if "INTERVAL" in parts:
        interval = _to_int(parts["INTERVAL"], "INTERVAL")
        if not 1 <= interval <= MAX_INTERVAL:
            raise RecurrenceError(f"INTERVAL は 1〜{MAX_INTERVAL} です")

    byday = None
    if "BYDAY" in parts:
        if freq != "WEEKLY":
            raise RecurrenceError("BYDAY は WEEKLY のときのみ指定できます")
        byday = []
        for d in parts["BYDAY"].split(","):
            if d not in _WEEKDAYS:
                raise RecurrenceError(f"BYDAY の曜日が不正です: {d}(MO,TU,WE,TH,FR,SA,SU のみ)")
            if d not in byday:
                byday.append(d)
        byday.sort(key=_WEEKDAYS.index)

    if "COUNT" in parts and "UNTIL" in parts:
        raise RecurrenceError("COUNT と UNTIL は同時に指定できません")
    count = None
    if "COUNT" in parts:
        count = _to_int(parts["COUNT"], "COUNT")
        if not 1 <= count <= MAX_COUNT:
            raise RecurrenceError(f"COUNT は 1〜{MAX_COUNT} です")
    until = None
    if "UNTIL" in parts:
        until = _parse_until(parts["UNTIL"])

    return {"freq": freq, "interval": interval, "byday": byday, "count": count, "until": until}


def normalize_rule(rule: Optional[str]) -> Optional[str]:
    """検証して正規形の文字列にする。None/空文字は None(規則なし)。"""
    if rule is None or (isinstance(rule, str) and not rule.strip()):
        return None
    p = parse_rule(rule)
    out = [f"FREQ={p['freq']}"]
    if p["interval"] != 1:
        out.append(f"INTERVAL={p['interval']}")
    if p["byday"]:
        out.append("BYDAY=" + ",".join(p["byday"]))
    if p["count"] is not None:
        out.append(f"COUNT={p['count']}")
    if p["until"] is not None:
        out.append("UNTIL=" + p["until"].strftime("%Y%m%d"))
    return ";".join(out)


def validate_rule_for_start(rule: Optional[str], start_time: Optional[datetime]) -> None:
    """開始日時と規則の整合: BYDAY があるなら開始日の曜日がその中に在る事(元の1件が第0回となる為)。"""
    if not rule:
        return
    p = parse_rule(rule)
    if start_time is None:
        raise RecurrenceError("規則を持つ予定には開始日時が必要です")
    if p["until"] is not None and p["until"] < start_time.date():
        raise RecurrenceError("UNTIL が開始日より前です")
    if p["byday"] and _WEEKDAYS[start_time.weekday()] not in p["byday"]:
        raise RecurrenceError("BYDAY に開始日の曜日が含まれていません")


def _to_int(value: str, name: str) -> int:
    if not value.isdigit():
        raise RecurrenceError(f"{name} は整数です")
    return int(value)


def _parse_until(value: str) -> date:
    v = value.rstrip("Z")
    try:
        if len(v) == 8:
            return datetime.strptime(v, "%Y%m%d").date()
        if len(v) == 15 and v[8] == "T":
            return datetime.strptime(v, "%Y%m%dT%H%M%S").date()
    except ValueError:
        pass
    raise RecurrenceError("UNTIL は YYYYMMDD または YYYYMMDDTHHMMSS です")


# ---- 回の生成 ----

def _iter_starts(start: datetime, p: dict):
    """開始日時から順に、規則が生む各回の開始日時を昇順に生成する(無限になり得る・呼び側で打ち切る)。"""
    freq, interval = p["freq"], p["interval"]
    if freq == "DAILY":
        i = 0
        while True:
            yield start + timedelta(days=i * interval)
            i += 1
    elif freq == "WEEKLY":
        days = [_WEEKDAYS.index(d) for d in (p["byday"] or [_WEEKDAYS[start.weekday()]])]
        week0 = start - timedelta(days=start.weekday())  # 開始日を含む週の月曜(時刻は開始と同じ)
        w = 0
        while True:
            base = week0 + timedelta(weeks=w * interval)
            for wd in days:
                cand = base + timedelta(days=wd)
                if cand >= start:
                    yield cand
            w += 1
    else:  # MONTHLY: 開始日と同じ日。その日が無い月(31日等)は飛ばす
        m = 0
        while True:
            total = start.month - 1 + m * interval
            year, month = start.year + total // 12, total % 12 + 1
            m += 1
            if year > 9999:
                return
            if start.day <= calendar.monthrange(year, month)[1]:
                yield start.replace(year=year, month=month)


def occurrences(event, window_start: datetime, window_end: datetime) -> List[tuple]:
    """規則を持つ予定の、期間に掛かる回を [(index, start, end)] で返す。

    index は元の1件(開始日時)を 0 とする通し番号で、期間の取り方に依らず不変。
    掛かる = 回の [start, end] が [window_start, window_end] と重なる。
    """
    p = parse_rule(event.recurrence_rule)
    start, end = event.start_time, event.end_time
    duration = (end - start) if (start and end) else timedelta(0)
    out = []
    for idx, s in enumerate(_iter_starts(start, p)):
        if p["count"] is not None and idx >= p["count"]:
            break
        if p["until"] is not None and s.date() > p["until"]:
            break
        if s > window_end:
            break
        if s + duration >= window_start:
            out.append((idx, s, s + duration))
            if len(out) > MAX_OCCURRENCES_PER_RULE:
                raise RecurrenceError(f"1つの規則が返す回数の上限({MAX_OCCURRENCES_PER_RULE})を超えました")
    return out


def check_window(window_start: Optional[datetime], window_end: Optional[datetime]) -> bool:
    """展開してよい問いか。期間が両端とも指定された時のみ True。

    期間の長さでは断らぬ(守りは 1規則の回数上限・総数上限のみ。実際に溢れた時だけ RecurrenceError)。
    """
    if window_start is None or window_end is None:
        return False
    if window_end < window_start:
        return False
    return True


# ---- 展開(三経路共通の唯一の入口) ----

_COLUMNS = (
    "id", "project_id", "title", "description", "start_time", "end_time", "location", "type",
    "allDay", "participants", "user_ids", "status", "meeting_url", "minutes_id",
    "created_at", "updated_at", "recurrence_rule",
)


def _as_occurrence(event, index: int, start: datetime, end: datetime):
    """展開した1回。id は元の予定のまま(意味を変えぬ)、occurrence_index で回を区別する。"""
    ns = SimpleNamespace(**{c: getattr(event, c, None) for c in _COLUMNS})
    ns.start_time, ns.end_time = start, end
    ns.occurrence_index = index
    ns.date = start.date().isoformat()
    ns.time = start.time().strftime("%H:%M") if not event.allDay else None
    ns.duration_minutes = int((end - start).total_seconds() / 60)
    return ns


def expand_events(
    events: Iterable,
    window_start: Optional[datetime],
    window_end: Optional[datetime],
    keep: Optional[Callable[[datetime, datetime], bool]] = None,
) -> list:
    """予定の列を、規則を持つものだけ展開して返す(規則なしは同一オブジェクトのまま素通し)。

    - 期間が両端指定でなければ一切展開しない(元の1件をそのまま返す)。
    - keep(start,end): 経路ごとの期間の当て方。各回に適用する(規則なしの予定には適用しない=従来のDB絞込みに任せる)。
    - 並びは呼び側が決める。ここでは入力順に、展開した回を元の位置へ時刻昇順で挿す。
    """
    if not check_window(window_start, window_end):
        return list(events)
    out, total = [], 0
    for ev in events:
        if not getattr(ev, "recurrence_rule", None):
            out.append(ev)
            continue
        for idx, s, e in occurrences(ev, window_start, window_end):
            if keep is not None and not keep(s, e):
                continue
            total += 1
            if total > MAX_EXPANDED_TOTAL:
                raise RecurrenceError(f"展開した総数の上限({MAX_EXPANDED_TOTAL})を超えました")
            out.append(_as_occurrence(ev, idx, s, e))
    return out


def sort_key_desc(item):
    """get_events / readonly と同じ並び: start_time 降順・id 降順(同順位は回の番号の降順)。"""
    return (item.start_time, item.id, getattr(item, "occurrence_index", None) or 0)
