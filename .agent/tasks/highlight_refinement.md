# Task: Refine Gantt Chart Highlighting

## Status
- [x] Modify `gtrTasksForDisplay` to return original tasks when no task is selected.
- [x] Ensure default arrows are hidden when a task is selected.
- [x] Update `DependencyHighlighter` arrow color to match highlight (`#e91e63`).
- [x] **Refined**: Update `gtrTasksForDisplay` to KEEP status colors for related tasks (instead of pink).
- [x] **Refined**: Update `DependencyHighlighter` to Recursively highlight ALL arrows in the dependency chain (using `getAllRelatedTaskIds`).
- [x] Verify structure (Moved `getAllRelatedTaskIds` to top level effectively).

## Notes
- User requested to keep status colors for selected tasks. Done.
- User requested to show "task's arrows only". Interpreted as showing the full dependency chain arrows to ensure context is valid.
- Unrelated tasks are grayed out.
