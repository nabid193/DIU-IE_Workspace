import express from "express";
import { pool } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";

const router = express.Router();
router.use(requireAuth);

const statuses = new Set(["todo", "in_progress", "blocked", "done"]);
const priorities = new Set(["normal", "medium", "high"]);

function parseStatus(value) {
  return String(value || "").toLowerCase().replaceAll("-", "_");
}

function parsePriority(value) {
  return String(value || "").toLowerCase();
}

function parseVisibility(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized === "selected people" || normalized === "selected" ? "selected" :
    normalized === "department" ? "department" : "";
}

function formatDue(date) {
  if (!date) return "TBD";
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function getTaskForUser(taskId, user) {
  const result = await pool.query(
    `SELECT t.*, p.name AS project_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = $1`,
    [taskId],
  );
  const task = result.rows[0];
  if (!task) return { task: null, allowed: false };
  if (user.role === "admin" || user.role === "head" || task.visibility === "department" || task.assignee_user_id === user.id) {
    return { task, allowed: true };
  }
  const viewer = await pool.query(
    "SELECT 1 FROM task_viewers WHERE task_id = $1 AND user_id = $2",
    [taskId, user.id],
  );
  return { task, allowed: viewer.rowCount > 0 };
}

async function validateActiveUsers(userIds) {
  const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (!ids.length) return [];
  const result = await pool.query(
    "SELECT id FROM users WHERE id = ANY($1::uuid[]) AND account_status = 'active'",
    [ids],
  );
  if (result.rowCount !== ids.length) return null;
  return ids;
}

async function writeActivity(client, taskId, actorId, eventType, text) {
  await client.query(
    "INSERT INTO task_activity (task_id, actor_user_id, event_type, details) VALUES ($1, $2, $3, $4::jsonb)",
    [taskId, actorId, eventType, JSON.stringify({ text })],
  );
}

async function notifyAudience(client, task, actorId, type, title, message, onlyUserIds = null) {
  let recipients;
  if (onlyUserIds) {
    recipients = [...new Set(onlyUserIds)];
  } else if (task.visibility === "department") {
    const result = await client.query("SELECT id FROM users WHERE account_status = 'active'");
    recipients = result.rows.map((row) => row.id);
  } else {
    const viewers = await client.query("SELECT user_id FROM task_viewers WHERE task_id = $1", [task.id]);
    recipients = [task.assignee_user_id, ...viewers.rows.map((row) => row.user_id)];
  }
  for (const userId of new Set(recipients)) {
    if (userId === actorId) continue;
    await client.query(
      `INSERT INTO notifications (recipient_user_id, task_id, type, title, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, task.id, type, title, message],
    );
  }
}

async function serializeTasks(rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [viewerResult, activityResult] = await Promise.all([
    pool.query("SELECT task_id, user_id FROM task_viewers WHERE task_id = ANY($1::uuid[])", [ids]),
    pool.query(
      `SELECT task_id, 'event'::text AS type, actor_user_id AS author_id,
              users.name AS author_name, COALESCE(details->>'text', event_type) AS text, created_at AS time
         FROM task_activity LEFT JOIN users ON users.id = task_activity.actor_user_id
        WHERE task_id = ANY($1::uuid[])
        UNION ALL
       SELECT task_id, 'comment'::text AS type, author_user_id AS author_id,
              users.name AS author_name, body AS text, created_at AS time
         FROM comments JOIN users ON users.id = comments.author_user_id
        WHERE task_id = ANY($1::uuid[])
        ORDER BY time ASC`,
      [ids],
    ),
  ]);
  const viewersByTask = new Map();
  for (const row of viewerResult.rows) {
    const list = viewersByTask.get(row.task_id) || [];
    list.push(row.user_id);
    viewersByTask.set(row.task_id, list);
  }
  const activityByTask = new Map();
  for (const row of activityResult.rows) {
    const list = activityByTask.get(row.task_id) || [];
    list.push({ type: row.type, author: row.author_id, authorName: row.author_name, text: row.text, time: row.time });
    activityByTask.set(row.task_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description || "No description provided.",
    project: row.project_name || "No project",
    projectId: row.project_id,
    isoDate: row.due_at ? String(row.due_at).slice(0, 10) : "",
    due: formatDue(row.due_at),
    dueSoon: false,
    status: row.status.replaceAll("_", "-"),
    priority: row.priority[0].toUpperCase() + row.priority.slice(1),
    visibility: row.visibility === "department" ? "Department" : "Selected people",
    visibleTo: viewersByTask.get(row.id) || [],
    assigneeId: row.assignee_user_id,
    assignee: row.assignee_name,
    activity: activityByTask.get(row.id) || [],
  }));
}

router.get("/preferences", async (request, response) => {
  const result = await pool.query(
    `SELECT u.phone_e164, COALESCE(p.whatsapp_enabled, u.whatsapp_enabled) AS whatsapp_enabled,
            COALESCE(p.email_enabled, TRUE) AS email_enabled
       FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE u.id=$1`,
    [request.user.id],
  );
  return response.json({ preferences: result.rows[0] || { phone_e164: null, whatsapp_enabled: false, email_enabled: true } });
});

router.put("/preferences", async (request, response) => {
  const phone = typeof request.body.phone === "string" && request.body.phone.trim() ? request.body.phone.trim() : null;
  const whatsappEnabled = Boolean(request.body.whatsappEnabled);
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
    return response.status(400).json({ error: "Enter the phone number in international format, for example +8801XXXXXXXXX." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET phone_e164=$1, whatsapp_enabled=$2, updated_at=now() WHERE id=$3", [phone, whatsappEnabled, request.user.id]);
    await client.query(
      `INSERT INTO notification_preferences (user_id, whatsapp_enabled) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET whatsapp_enabled=EXCLUDED.whatsapp_enabled, updated_at=now()`,
      [request.user.id, whatsappEnabled],
    );
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return response.json({ ok: true });
});

router.get("/team", async (request, response) => {
  const result = await pool.query(
    `SELECT id, name, role, account_status
       FROM users
      WHERE account_status = 'active'
      ORDER BY name`,
  );
  return response.json({ users: result.rows });
});

router.get("/projects", async (_request, response) => {
  const result = await pool.query(
    `SELECT id, name, description, created_at
       FROM projects WHERE archived_at IS NULL
      ORDER BY name`,
  );
  return response.json({ projects: result.rows });
});

router.post("/projects", requireRole("head"), async (request, response) => {
  const name = typeof request.body.name === "string" ? request.body.name.trim() : "";
  const description = typeof request.body.description === "string" ? request.body.description.trim() : "";
  if (!name || name.length > 160 || description.length > 5000) {
    return response.status(400).json({ error: "Enter a project name of 1–160 characters." });
  }
  const result = await pool.query(
    `INSERT INTO projects (name, description, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id, name, description, created_at`,
    [name, description, request.user.id],
  );
  return response.status(201).json({ project: result.rows[0] });
});

router.patch("/projects/:id", requireRole("head"), async (request, response) => {
  const name = typeof request.body.name === "string" ? request.body.name.trim() : "";
  const description = typeof request.body.description === "string" ? request.body.description.trim() : "";
  if (!name || name.length > 160 || description.length > 5000) {
    return response.status(400).json({ error: "Enter a project name of 1–160 characters." });
  }
  const result = await pool.query(
    `UPDATE projects SET name = $1, description = $2, updated_at = now()
      WHERE id = $3 AND archived_at IS NULL
      RETURNING id, name, description, created_at`,
    [name, description, request.params.id],
  );
  if (!result.rows[0]) return response.status(404).json({ error: "Project not found." });
  return response.json({ project: result.rows[0] });
});

router.get("/tasks", async (request, response) => {
  const values = [];
  const filters = [];
  if (request.user.role === "member") {
    values.push(request.user.id);
    filters.push(`(t.visibility = 'department' OR t.assignee_user_id = $${values.length}
      OR EXISTS (SELECT 1 FROM task_viewers v WHERE v.task_id = t.id AND v.user_id = $${values.length}))`);
  }
  if (request.query.status) {
    const status = parseStatus(request.query.status);
    if (!statuses.has(status)) return response.status(400).json({ error: "Invalid task status." });
    values.push(status);
    filters.push(`t.status = $${values.length}`);
  }
  if (request.query.projectId) {
    values.push(request.query.projectId);
    filters.push(`t.project_id = $${values.length}`);
  }
  const result = await pool.query(
    `SELECT t.*, p.name AS project_name, u.name AS assignee_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = t.assignee_user_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY t.due_at NULLS LAST, t.created_at DESC`,
    values,
  );
  return response.json({ tasks: await serializeTasks(result.rows) });
});

router.post("/tasks", requireRole("head"), async (request, response) => {
  const title = typeof request.body.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body.description === "string" ? request.body.description.trim() : "";
  const assigneeId = typeof request.body.assigneeId === "string" ? request.body.assigneeId : "";
  const projectId = typeof request.body.projectId === "string" && request.body.projectId ? request.body.projectId : null;
  const priority = parsePriority(request.body.priority || "normal");
  const visibility = parseVisibility(request.body.visibility);
  const dueAt = typeof request.body.dueAt === "string" && request.body.dueAt ? request.body.dueAt : null;
  const requestedViewers = Array.isArray(request.body.visibleTo) ? request.body.visibleTo : [];
  if (!title || title.length > 240 || description.length > 10000 || !assigneeId || !priorities.has(priority) || !visibility) {
    return response.status(400).json({ error: "Check the task title, assignee, priority, and visibility." });
  }
  const activeUsers = await validateActiveUsers([assigneeId, ...requestedViewers]);
  if (!activeUsers) return response.status(400).json({ error: "Choose active department accounts only." });
  const viewerIds = visibility === "selected" ? [...new Set([...requestedViewers, assigneeId])] : [];

  const client = await pool.connect();
  let taskId;
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO tasks (title, description, project_id, created_by_user_id, assignee_user_id, priority, due_at, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [title, description, projectId, request.user.id, assigneeId, priority, dueAt, visibility],
    );
    taskId = inserted.rows[0].id;
    for (const viewerId of viewerIds) {
      await client.query(
        "INSERT INTO task_viewers (task_id, user_id, added_by_user_id) VALUES ($1, $2, $3)",
        [taskId, viewerId, request.user.id],
      );
    }
    await writeActivity(client, taskId, request.user.id, "task_created", "Task created");
    if (assigneeId !== request.user.id) {
      await notifyAudience(client, { id: taskId, assignee_user_id: assigneeId, visibility, }, request.user.id,
        "task_assigned", "Task assigned to you", title, [assigneeId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const created = await getTaskForUser(taskId, request.user);
  const rows = await pool.query(
    `SELECT t.*, p.name AS project_name, u.name AS assignee_name FROM tasks t
     LEFT JOIN projects p ON p.id=t.project_id JOIN users u ON u.id=t.assignee_user_id WHERE t.id=$1`, [created.task.id],
  );
  return response.status(201).json({ task: (await serializeTasks(rows.rows))[0] });
});

router.patch("/tasks/:id", requireRole("head"), async (request, response) => {
  const current = await getTaskForUser(request.params.id, request.user);
  if (!current.task) return response.status(404).json({ error: "Task not found." });
  const body = request.body;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const assigneeId = typeof body.assigneeId === "string" ? body.assigneeId : "";
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  const priority = parsePriority(body.priority);
  const visibility = parseVisibility(body.visibility);
  const dueAt = typeof body.dueAt === "string" && body.dueAt ? body.dueAt : null;
  const requestedViewers = Array.isArray(body.visibleTo) ? body.visibleTo : [];
  if (!title || title.length > 240 || description.length > 10000 || !assigneeId || !priorities.has(priority) || !visibility) {
    return response.status(400).json({ error: "Check the task title, assignee, priority, and visibility." });
  }
  const activeUsers = await validateActiveUsers([assigneeId, ...requestedViewers]);
  if (!activeUsers) return response.status(400).json({ error: "Choose active department accounts only." });
  const viewerIds = visibility === "selected" ? [...new Set([...requestedViewers, assigneeId])] : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tasks SET title=$1, description=$2, project_id=$3, assignee_user_id=$4, priority=$5,
       due_at=$6, visibility=$7, updated_at=now() WHERE id=$8`,
      [title, description, projectId, assigneeId, priority, dueAt, visibility, request.params.id],
    );
    await client.query("DELETE FROM task_viewers WHERE task_id=$1", [request.params.id]);
    for (const viewerId of viewerIds) {
      await client.query(
        "INSERT INTO task_viewers (task_id,user_id,added_by_user_id) VALUES ($1,$2,$3)",
        [request.params.id, viewerId, request.user.id],
      );
    }
    await writeActivity(client, request.params.id, request.user.id, "task_updated", "Task details updated");
    const updatedTask = { ...current.task, id: request.params.id, assignee_user_id: assigneeId, visibility };
    if (assigneeId !== current.task.assignee_user_id) {
      await notifyAudience(client, updatedTask, request.user.id, "task_assigned", "Task assigned to you", title, [assigneeId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const row = await pool.query(
    `SELECT t.*, p.name AS project_name, u.name AS assignee_name FROM tasks t
     LEFT JOIN projects p ON p.id=t.project_id JOIN users u ON u.id=t.assignee_user_id WHERE t.id=$1`,
    [request.params.id],
  );
  return response.json({ task: (await serializeTasks(row.rows))[0] });
});

router.patch("/tasks/:id/status", async (request, response) => {
  const status = parseStatus(request.body.status);
  if (!statuses.has(status)) return response.status(400).json({ error: "Invalid task status." });
  const current = await getTaskForUser(request.params.id, request.user);
  if (!current.task) return response.status(404).json({ error: "Task not found." });
  if (request.user.role !== "head" && !(request.user.role === "member" && current.task.assignee_user_id === request.user.id)) {
    return response.status(403).json({ error: "Only a Head or the task assignee can change its status." });
  }
  const label = status.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE tasks SET status=$1, updated_at=now(), completed_at=$2 WHERE id=$3",
      [status, status === "done" ? new Date() : null, request.params.id],
    );
    await writeActivity(client, request.params.id, request.user.id, "status_changed", `Status changed to ${label}`);
    await notifyAudience(client, current.task, request.user.id, "status_changed", "Task status changed", `${current.task.title} is now ${label}.`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return response.json({ status });
});

router.get("/tasks/:id/comments", async (request, response) => {
  const access = await getTaskForUser(request.params.id, request.user);
  if (!access.task) return response.status(404).json({ error: "Task not found." });
  if (!access.allowed) return response.status(403).json({ error: "You cannot view this task." });
  const result = await pool.query(
    `SELECT c.id, c.body, c.created_at, u.id AS author_id, u.name AS author_name
       FROM comments c JOIN users u ON u.id=c.author_user_id
      WHERE c.task_id=$1 ORDER BY c.created_at`,
    [request.params.id],
  );
  return response.json({ comments: result.rows });
});

router.post("/tasks/:id/comments", async (request, response) => {
  const body = typeof request.body.body === "string" ? request.body.body.trim() : "";
  if (!body || body.length > 5000) return response.status(400).json({ error: "Comments must be 1–5000 characters." });
  const access = await getTaskForUser(request.params.id, request.user);
  if (!access.task) return response.status(404).json({ error: "Task not found." });
  if (!access.allowed) return response.status(403).json({ error: "You cannot comment on this task." });
  const result = await pool.query(
    "INSERT INTO comments (task_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at",
    [request.params.id, request.user.id, body],
  );
  const client = await pool.connect();
  try {
    await notifyAudience(client, access.task, request.user.id, "comment", "New comment",
      `${request.user.name} commented on ${access.task.title}`);
  } finally {
    client.release();
  }
  return response.status(201).json({ comment: { ...result.rows[0], author_id: request.user.id, author_name: request.user.name } });
});

router.get("/notifications", async (request, response) => {
  const result = await pool.query(
    `SELECT id, task_id, type, title, message, created_at, read_at
       FROM notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [request.user.id],
  );
  return response.json({ notifications: result.rows.map((row) => ({
    id: row.id, taskId: row.task_id, type: row.type, title: row.title,
    body: row.message, time: row.created_at, read: Boolean(row.read_at),
  })) });
});

router.patch("/notifications/:id/read", async (request, response) => {
  const result = await pool.query(
    "UPDATE notifications SET read_at=now() WHERE id=$1 AND recipient_user_id=$2 RETURNING id",
    [request.params.id, request.user.id],
  );
  if (!result.rowCount) return response.status(404).json({ error: "Notification not found." });
  return response.json({ ok: true });
});

router.post("/notifications/read-all", async (request, response) => {
  await pool.query("UPDATE notifications SET read_at=now() WHERE recipient_user_id=$1 AND read_at IS NULL", [request.user.id]);
  return response.json({ ok: true });
});

export default router;
