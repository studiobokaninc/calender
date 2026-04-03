# crud/__init__.py
# Re-exporting all CRUD functions for backward compatibility

from .base import _parse_datetime, _parse_int_safe, _safe_json_load
from .users import (
    get_user, get_user_by_email, get_user_by_username, get_users,
    create_user, update_user
)
from .projects import (
    get_project, get_project_by_name, get_projects, create_project, update_project, 
    delete_project_with_cascade, complete_tasks_for_project
)
from .tasks import (
    get_task, get_task_by_name, get_tasks, create_task, update_task, bulk_update_tasks, delete_task
)
from .events import (
    get_event, get_events, create_event, update_event, delete_event
)
from .batch import (
    update_task_statuses, auto_update_task_statuses, get_user_google_token
)
from .groups import (
    get_group, get_groups, create_group, update_group, delete_group,
    get_user_group, get_user_groups_by_user, get_user_groups_by_group,
    add_user_to_group, remove_user_from_group
)
from .notes import (
    get_note, get_notes, create_note, update_note, delete_note
)
from .search import (
    search_projects, search_tasks, search_events
)
from .analytics import (
    get_labor_report, get_weekly_workload, get_daily_workload
)
from .meetings import (
    get_meeting, get_meetings_by_project, create_meeting, update_meeting, delete_meeting,
    create_decision, get_decisions, get_latest_meeting, update_decision, get_all_meeting_summaries
)
from .knowledge import (
    get_knowledge_item, get_knowledge_items, create_knowledge_item, update_knowledge_item,
    delete_knowledge_item, add_knowledge_tag, get_all_knowledge_summaries
)
from .chat import (
    create_chat_message, get_chat_messages, delete_conversation_messages
)
from .others import (
    create_status_history, get_task_status_history, get_status_change_metrics,
    get_cycle_date, create_user_activity, get_user_activities, get_user_activities_by_cycle,
    upsert_user_google_token, delete_user_google_token
)
