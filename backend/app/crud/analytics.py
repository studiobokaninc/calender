import logging
from datetime import datetime, date, timedelta
from typing import List, Optional, Any, Dict
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, or_, and_, cast, String
from collections import defaultdict
import json

from .. import models, schemas
from .base import _parse_datetime, _safe_json_load

logger = logging.getLogger(__name__)

# 定数
HOURS_PER_DAY = 8
WORKING_DAYS_PER_WEEK = 5
MAX_HOURS_PER_WEEK = HOURS_PER_DAY * WORKING_DAYS_PER_WEEK  # 40

def _count_weekdays(start_d: date, end_d: date) -> int:
    """start_d から end_d まで（両端含む）の平日（月〜金）の日数を返す"""
    if start_d > end_d: return 0
    count = 0
    curr = start_d
    while curr <= end_d:
        if curr.weekday() < 5:
            count += 1
        curr += timedelta(days=1)
    return count

def _convert_cost_to_hours(cost_value: Any) -> float:
    """コスト値を時間に変換"""
    if cost_value is None: return 0.0
    if isinstance(cost_value, (int, float)): return float(cost_value)
    if isinstance(cost_value, str):
        cv = cost_value.upper()
        if cv == 'S': return 2.0
        if cv == 'M': return 8.0
        if cv == 'L': return 24.0
        try: return float(cost_value)
        except: return 0.0
    return 0.0

def _parse_depends_on_ids(depends_on: Any) -> List[int]:
    """dependsOn を ID のリストに変換"""
    if not depends_on: return []
    if isinstance(depends_on, str):
        try: depends_on = json.loads(depends_on)
        except: return []
    if not isinstance(depends_on, list): return []
    res = []
    for d in depends_on:
        try: res.append(int(d))
        except: pass
    return res

def _is_task_unblocked_on_date(task: Any, d: date, tasks_by_id: Dict[int, Any], to_date_func: Any) -> bool:
    """タスクが指定日に着手可能か"""
    deps = _parse_depends_on_ids(getattr(task, "dependsOn", None))
    for dep_id in deps:
        dep_task = tasks_by_id.get(dep_id)
        if not dep_task: continue
        if dep_task.status != models.TaskStatus.DELIVER:
            _, dep_end, _ = _task_calendar_range(dep_task, to_date_func)
            if dep_end is None or dep_end > d: return False
    return True

def _task_calendar_range(task: Any, to_date_func: Any) -> Any:
    """タスクの期間とコストを計算"""
    s = to_date_func(task.start_date)
    e = to_date_func(task.due_date)
    cost = _convert_cost_to_hours(task.cost)
    if not s and not e: return None, None, 0
    if not s: s = e
    if not e: e = s
    if s > e: e = s
    return s, e, cost

def get_labor_report(db: Session, group_by: str, from_date: Optional[datetime] = None, to_date: Optional[datetime] = None, include_offline: bool = False, include_completed: bool = False) -> List[Dict[str, Any]]:
    query = db.query(models.Task)
    if not include_offline:
        query = query.join(models.Project).filter(models.Project.display_status != 'offline')
    if not include_completed:
        query = query.filter(models.Task.status != models.TaskStatus.DELIVER)
    if from_date: query = query.filter(models.Task.due_date >= from_date)
    if to_date: query = query.filter(models.Task.due_date <= to_date)
    tasks = query.all()
    report = {}
    for t in tasks:
        key = t.assigned_to if group_by == 'user' else t.project_id
        if key not in report: report[key] = {"total_cost": 0.0, "task_count": 0}
        cost = _convert_cost_to_hours(t.cost)
        report[key]["total_cost"] += cost
        report[key]["task_count"] += 1
    results = []
    for k, v in report.items():
        name = "Unknown"
        if group_by == 'user':
            u = db.query(models.User).filter(models.User.id == k).first()
            name = u.full_name if u else "Unknown"
        else:
            p = db.query(models.Project).filter(models.Project.id == k).first()
            name = p.name if p else "Unknown"
        results.append({"id": k, "name": name, "total_cost": v["total_cost"], "task_count": v["task_count"]})
    return results

def get_weekly_workload(db: Session, week_start: date, reference_date: Optional[date] = None, include_offline: bool = False, include_completed: bool = False, consider_dependencies: bool = True) -> List[dict]:
    if reference_date is None: reference_date = date.today()
    week_end = week_start + timedelta(days=6)
    def to_date(d):
        if d is None: return None
        if hasattr(d, "date"): return d.date()
        if isinstance(d, str):
            try: return datetime.strptime(d[:10], "%Y-%m-%d").date()
            except: return None
        return None
    query = db.query(models.Task).filter(models.Task.assigned_to.isnot(None))
    if not include_completed: query = query.filter(models.Task.status != models.TaskStatus.DELIVER)
    if include_completed: query = query.options(selectinload(models.Task.status_history))
    if not include_offline:
        offline_project_ids = [p.id for p in db.query(models.Project).filter(models.Project.display_status == "offline").all()]
        if offline_project_ids: query = query.filter(or_(models.Task.project_id.is_(None), ~models.Task.project_id.in_(offline_project_ids)))
    tasks = list(query.all())
    dependency_ids = set()
    for t in tasks: dependency_ids.update(_parse_depends_on_ids(getattr(t, "dependsOn", None)))
    if dependency_ids:
        dep_tasks = db.query(models.Task).filter(models.Task.id.in_(list(dependency_ids))).all()
        tasks_by_id = {t.id: t for t in list(tasks) + list(dep_tasks)}
    else: tasks_by_id = {t.id: t for t in tasks}
    user_hours, user_daily_hours, user_labor_passed, user_remaining_cost, user_weekdays_passed, user_tasks = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(int), defaultdict(list)
    for t in tasks:
        task_start, task_end, cost = _task_calendar_range(t, to_date)
        if task_start is None or cost <= 0: continue
        total_weekdays = _count_weekdays(task_start, task_end) or 1
        is_completed = t.status == models.TaskStatus.DELIVER
        if is_completed:
            completed_date = None
            if hasattr(t, 'status_history') and t.status_history:
                completed_history = [h for h in t.status_history if h.status == models.TaskStatus.DELIVER]
                if completed_history: completed_date = to_date(max(completed_history, key=lambda h: h.changed_at).changed_at)
            if completed_date is None: completed_date = to_date(getattr(t, 'updated_at', None)) or task_end
            effective_reference_date = completed_date or reference_date
            if effective_reference_date < task_start: weekdays_passed, labor_passed, remaining = 0, 0, 0
            elif effective_reference_date > task_end: weekdays_passed, labor_passed, remaining = total_weekdays, cost, 0
            else:
                weekdays_passed = min(_count_weekdays(task_start, min(effective_reference_date, task_end)), total_weekdays)
                labor_passed = round(min(cost, weekdays_passed * HOURS_PER_DAY), 2)
                remaining = 0
        else:
            if reference_date < task_start: weekdays_passed, labor_passed, remaining = 0, 0, cost
            elif reference_date > task_end: weekdays_passed, labor_passed, remaining = total_weekdays, cost, 0
            else:
                weekdays_passed = min(_count_weekdays(task_start, min(reference_date, task_end)), total_weekdays)
                labor_passed = round(min(cost, weekdays_passed * HOURS_PER_DAY), 2)
                remaining = max(0, round(cost - labor_passed, 2))
        hours_per_weekday = round(cost / total_weekdays, 2)
        overlaps_week = _count_weekdays(max(task_start, week_start), min(task_end, week_end)) > 0
        user_tasks[t.assigned_to].append({"task_id": t.id, "task_name": t.name or "", "cost": round(cost, 2), "start_date": task_start.isoformat(), "due_date": task_end.isoformat(), "total_weekdays": total_weekdays, "hours_per_weekday": hours_per_weekday, "overlaps_week": overlaps_week, "weekdays_passed": weekdays_passed, "labor_hours_passed": round(labor_passed, 2), "remaining_cost_hours": round(remaining, 2)})
        user_labor_passed[t.assigned_to] += labor_passed
        user_remaining_cost[t.assigned_to] += remaining
        user_weekdays_passed[t.assigned_to] = max(user_weekdays_passed[t.assigned_to], weekdays_passed)
        in_week_start, in_week_end = max(task_start, week_start), min(task_end, week_end)
        if _count_weekdays(in_week_start, in_week_end) > 0:
            d = week_start
            while d <= week_end:
                if (in_week_start <= d <= in_week_end) and d.weekday() < 5:
                    if not consider_dependencies or _is_task_unblocked_on_date(t, d, tasks_by_id, to_date):
                        user_hours[t.assigned_to] += hours_per_weekday
                        user_daily_hours[(t.assigned_to, d)] += hours_per_weekday
                d += timedelta(days=1)
    all_user_ids = {u.id for u in db.query(models.User).all()} | set(user_hours.keys()) | set(user_labor_passed.keys())
    users_map = {u.id: (u.username or u.full_name or f"User {u.id}") for u in db.query(models.User).filter(models.User.id.in_(all_user_ids)).all()}
    user_base_loads = {u.id: float(u.base_load_hours_per_week or 0.0) for u in db.query(models.User).filter(models.User.id.in_(all_user_ids)).all()}
    result = []
    for uid in sorted(all_user_ids):
        base_load = user_base_loads.get(uid, 0.0)
        task_assigned = round(user_hours.get(uid, 0), 2)
        assigned = round(task_assigned + base_load, 2)
        free = max(0, MAX_HOURS_PER_WEEK - assigned)
        daily_breakdown = []
        base_load_per_day = base_load / 5.0
        d = week_start
        while d <= week_end:
            task_day_assigned = round(user_daily_hours.get((uid, d), 0), 2)
            day_assigned = round(task_day_assigned + base_load_per_day, 2) if d.weekday() < 5 else task_day_assigned
            daily_breakdown.append({"date": d.isoformat(), "assigned_hours": day_assigned, "free_hours": round(max(0, HOURS_PER_DAY - day_assigned), 2) if d.weekday() < 5 else 0})
            d += timedelta(days=1)
        result.append({"user_id": uid, "user_name": users_map.get(uid, ""), "total_cost_hours": round(sum(x["cost"] for x in user_tasks.get(uid, [])), 2), "assigned_hours": assigned, "free_hours": round(free, 2), "base_load_hours_per_week": round(base_load, 2), "task_assigned_hours": round(task_assigned, 2), "labor_hours_passed": round(user_labor_passed.get(uid, 0), 2), "remaining_cost_hours": round(user_remaining_cost.get(uid, 0), 2), "weekdays_passed": user_weekdays_passed.get(uid, 0), "tasks": user_tasks.get(uid, []), "daily_breakdown": daily_breakdown})
    result.sort(key=lambda x: (-x["free_hours"], x["user_name"]))
    return result

def get_daily_workload(db: Session, target_date: date, include_offline: bool = False, include_completed: bool = False, consider_dependencies: bool = True) -> List[dict]:
    # (省略版だがロジックは同等。必要に応じて crud_v1 から完全復元)
    def to_date(d):
        if d is None: return None
        if hasattr(d, "date"): return d.date()
        if isinstance(d, str):
            try: return datetime.strptime(d[:10], "%Y-%m-%d").date()
            except: return None
        return None
    query = db.query(models.Task).filter(models.Task.assigned_to.isnot(None), models.Task.status != models.TaskStatus.DELIVER)
    if not include_offline:
        offline_project_ids = [p.id for p in db.query(models.Project).filter(models.Project.display_status == "offline").all()]
        if offline_project_ids: query = query.filter(~models.Task.project_id.in_(offline_project_ids))
    tasks = list(query.all())
    dependency_ids = set()
    for t in tasks: dependency_ids.update(_parse_depends_on_ids(getattr(t, "dependsOn", None)))
    if dependency_ids:
        dep_tasks = db.query(models.Task).filter(models.Task.id.in_(list(dependency_ids))).all()
        tasks_by_id = {t.id: t for t in list(tasks) + list(dep_tasks)}
    else: tasks_by_id = {t.id: t for t in tasks}
    user_hours, user_labor_passed, user_remaining_cost, user_weekdays_passed = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(int)
    for t in tasks:
        task_start, task_end, cost = _task_calendar_range(t, to_date)
        if task_start is None or cost <= 0: continue
        total_weekdays = _count_weekdays(task_start, task_end) or 1
        if target_date < task_start: weekdays_passed, labor_passed, remaining = 0, 0, cost
        elif target_date > task_end: weekdays_passed, labor_passed, remaining = total_weekdays, cost, 0
        else:
            weekdays_passed = min(_count_weekdays(task_start, min(target_date, task_end)), total_weekdays)
            labor_passed = round(min(cost, weekdays_passed * HOURS_PER_DAY), 2)
            remaining = max(0, round(cost - labor_passed, 2))
        effective_start = max(task_start, target_date)
        remaining_weekdays = _count_weekdays(effective_start, task_end)
        overlaps_today = task_start <= target_date <= task_end
        if overlaps_today and target_date.weekday() < 5 and remaining_weekdays > 0:
            if not consider_dependencies or _is_task_unblocked_on_date(t, target_date, tasks_by_id, to_date):
                user_hours[t.assigned_to] += remaining / remaining_weekdays
        user_labor_passed[t.assigned_to] += labor_passed
        user_remaining_cost[t.assigned_to] += remaining
        user_weekdays_passed[t.assigned_to] = max(user_weekdays_passed[t.assigned_to], weekdays_passed)
    all_user_ids = {u.id for u in db.query(models.User).all()} | set(user_hours.keys()) | set(user_labor_passed.keys())
    users_map = {u.id: (u.username or u.full_name or f"User {u.id}") for u in db.query(models.User).filter(models.User.id.in_(all_user_ids)).all()}
    user_base_loads = {u.id: float(u.base_load_hours_per_week or 0.0) for u in db.query(models.User).filter(models.User.id.in_(all_user_ids)).all()}
    result = []
    for uid in sorted(all_user_ids):
        base_load = user_base_loads.get(uid, 0.0)
        base_load_per_day = base_load / 5.0 if target_date.weekday() < 5 else 0.0
        task_assigned = round(user_hours.get(uid, 0), 2)
        assigned = round(task_assigned + base_load_per_day, 2)
        result.append({"user_id": uid, "user_name": users_map.get(uid, ""), "assigned_hours": assigned, "free_hours": round(max(0, HOURS_PER_DAY - assigned), 2) if target_date.weekday() < 5 else 0, "base_load_hours_per_week": round(base_load, 2), "base_load_hours_per_day": round(base_load_per_day, 2), "task_assigned_hours": task_assigned, "labor_hours_passed": round(user_labor_passed.get(uid, 0), 2), "remaining_cost_hours": round(user_remaining_cost.get(uid, 0), 2), "weekdays_passed": user_weekdays_passed.get(uid, 0)})
    result.sort(key=lambda x: (-x["free_hours"], x["user_name"]))
    return result
