// frontend/src/utils/transformImportData.ts
export function transformImportData(data: any): any {
  const fixId = (prefix: string, id: any) => (typeof id === 'number' ? `${prefix}-${id}` : id);

  const transformed = {
    users: (data.users || []).map((u: any) => ({
      id: fixId("user", u.id),
      username: u.username,
      full_name: u.name || u.full_name || "",
      email: u.email,
      role: u.role,
      password: u.password || "password123"
    })),
    projects: (data.projects || []).map((p: any) => ({
      id: fixId("proj", p.id),
      name: p.name,
      description: p.description,
      status: p.status?.toLowerCase() || "planning",
      display_status: p.display_status || "online",
      color: p.color || "#cccccc",
      startDate: p.start_date?.split("T")[0] || p.startDate || "2025-01-01",
      endDate: p.end_date?.split("T")[0] || p.endDate || "2025-12-31"
    })),
    tasks: (data.tasks || []).map((t: any) => ({
      id: fixId("task", t.id),
      projectId: fixId("proj", t.project_id),
      title: t.name,
      description: t.description,
      status: t.status?.toLowerCase() || "todo",
      display_status: t.display_status || "online",
      taskStartDate: t.start_date?.split("T")[0] || "2025-01-01",
      taskDueDate: t.due_date?.split("T")[0] || "2025-01-10",
      assigned_to: fixId("user", t.assigned_to),
      cost: t.cost || 0,
      priority: (t.priority || "medium").toUpperCase(),
      type: t.type || "asset",
      dependsOn: (t.dependsOn || []).map((d: any) => fixId("task", d)),
      statusHistory: (t.status_history || []).map((s: any) => ({
        status: s.status,
        changed_at: s.changed_at?.split("T")[0],
        changed_by: fixId("user", s.changed_by)
      }))
    })),
    events: data.events || [],
    groups: (data.groups || []).map((g: any) => ({
      id: fixId("group", g.id),
      name: g.name,
      description: g.description
    })),
    user_groups: (data.user_groups || []).map((ug: any) => ({
      user_id: fixId("user", ug.user_id),
      group_id: fixId("group", ug.group_id),
      role: ug.role,
      created_at: ug.created_at || null,
      updated_at: ug.updated_at || null
    }))
  };

  return transformed;
}