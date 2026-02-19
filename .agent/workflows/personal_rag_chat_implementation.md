---
description: Implement RAG-based personalized chat and auto-execution for admins
---

# Personalized RAG Chat & Admin Auto-Execution Workflow

This workflow outlines the steps to upgrade the current chat system to a context-aware, efficient RAG system that handles User and Admin contexts differently, including auto-execution capabilities for admins.

## Phase 1: Context Logic Refactoring (The "RAG" Part)

Currently, the system loads *all* tasks into the LLM context. We need to split this into "Personal Context" and "Admin/Dashboard Context" to save tokens and improve relevance.

1.  **Modify `backend/app/task_list.py` (or create `backend/app/services/context.py`)**:
    *   Create a function `get_personal_context(db: Session, user_id: int)`:
        *   Fetch tasks where `assigned_to == user_id`.
        *   Fetch projects where the user is a member.
        *   Fetch calendar events for the user.
        *   Format as CSV/Text specifically for the user.
    *   Create a function `get_dashboard_context(db: Session)` (Admin):
        *   Fetch "High Attention" items: Delayed tasks, High priority tasks, Tasks due within 7 days.
        *   Summary statistics (Total tasks per project, etc.).
        *   *Do not* dump every single "done" task unless asked.

2.  **Update `backend/app/routers/chat.py`**:
    *   In `/chat/user/stream` (User Endpoint):
        *   Replace the generic `build_task_list_for_chat` call with `get_personal_context(db, current_user.id)`.
    *   In `/chat/stream` (Admin/Dashboard Endpoint):
        *   Replace generic loader with `get_dashboard_context(db)`.

## Phase 2: Prompt Engineering & System Instructions

The LLM needs different instructions based on who it's talking to.

1.  **Update `backend/app/services/llm.py`**:
    *   Modify `generate_system_prompt` to accept a `mode` parameter (`"personal"` | `"admin"`).
    *   **Personal Mode**:
        *   "You are an assistant for {User Name}. Focus on their specific tasks and schedule. Do not discuss other users' private tasks unless relevant to a shared project."
    *   **Admin Mode**:
        *   "You are a Project Manager Assistant. Focus on project health, blocks, and resource allocation. You have authority to manage tasks."
        *   *Crucial for Auto-Execution*: Add strictly formatted JSON output instructions for actions (already present, but reinforce strictness).

## Phase 3: Admin Auto-Execution Logic

The user wants the admin's intent to translate directly to action without confirmation dialogs.

1.  **Backend vs Frontend Execution**:
    *   *Approach*: Backend-side execution is more robust for "Agents".
    *   In `backend/app/routers/chat.py` -> `stream_chat` (Admin endpoint):
        *   Implement a buffer to detect Action JSON blocks during the stream (or wait for `message_end`).
        *   **If Action Detected**:
            *   Call `_execute_task_action_internal` immediately within the route.
            *   Capture the result (Success/Fail).
            *   Append a system message to the stream: `"\n\n[System]: Task updated successfully."`
            *   Send a special SSE event (e.g., `event: action_executed`) to the frontend so it can refresh the data grid.

2.  **Frontend Handling (`frontend/src/pages/ChatPage.tsx` or similar)**:
    *   Listen for `event: action_executed`.
    *   Trigger `refetchTasks()` or similar to update the UI immediately.
    *   Suppress the "Confirm Action" dialog if the event indicates it was already executed.

## Phase 4: Implementation Steps

### Step 1: Backend Context Services
// turbo
Create/Update context retrieval functions in `backend/app/task_list.py`.

### Step 2: Update Chat Router
// turbo
Modify `backend/app/routers/chat.py` to use specific contexts and implement the auto-execute logic in the admin stream.

### Step 3: Frontend Refesh
Update the frontend to handle the "Action Executed" event seamlessly.

---
**Usage**:
Run this workflow by asking the agent to "Implement Step X of the RAG Chat workflow".
