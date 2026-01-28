# Verification Walkthrough: Gantt Chart Conditional Highlighting

This guide helps verify the refined highlighting behavior in the Gantt chart.

## Objective
Ensure that task highlighting respects status colors while dimming unrelated tasks, and that arrows for the selected dependency chain are visible.

## Verification Steps

1.  **Open the Application**:
    *   Navigate to the Metrics page where the Gantt chart is located.
    *   Ensure the "Week" or "Month" view is selected for better visibility.

2.  **Initial State (No Selection)**:
    *   **Verify**: Upon loading (with no task selected), check the color of the task bars.
        *   They should be colored according to their status (e.g., Blue for 'Todo', Orange for 'In-Progress', Green for 'Completed').
    *   **Verify**: Check that default gray arrows connecting dependent tasks are visible.
    *   **Verify**: No tasks should be dimmed.

3.  **Active Selection State**:
    *   **Action**: Click on a specific task that has dependencies (parents or children).
    *   **Verify**:
        *   The **selected task** and all its **related tasks** (parents/ancestors and children/descendants) **RETAIN** their original status-based colors (e.g., Blue, Orange, Green). They should NOT turn pink.
        *   All **other tasks** (unrelated) become **DIMMED** (light gray).
        *   **Arrows**:
            *   Verify that arrows connecting the selected task and its related tasks (the whole chain) are **VISIBLE** and colored pink (`#e91e63`).
            *   Verify that arrows for unrelated tasks are HIDDEN or dimmed.

4.  **Deselect / Revert State**:
    *   **Action**: Click on the same selected task again (if toggle is supported) or reload the page.
    *   **Verify**:
        *   The chart immediately reverts to the **Initial State**.
        *   All tasks return to their **status-based colors** (if they looked different).
        *   Dimming disappears.
        *   Standard gray arrows reappear for all dependencies.

## Key Success Criteria
*   **Color**: Selected chain = Status Colors. Unrelated = Dimmed.
*   **Arrows**: Selected chain = Pink Arrows Visible. Unrelated = Hidden/Default.
