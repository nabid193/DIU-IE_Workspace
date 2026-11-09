// The API supplies the authenticated account and all workspace records.
const authResponse = await fetch("/api/auth/me");
if (!authResponse.ok) {
  window.location.replace("/");
  throw new Error("Sign-in required to open the workspace.");
}
const { user: signedInUser } = await authResponse.json();
let currentUserId = signedInUser.id;
let currentRole = signedInUser.role;
let people = [];
let projects = [];
let tasks = [];
let notifications = [];
const settingsByActor = {};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

async function loadWorkspaceData() {
  const [teamData, projectData, taskData, notificationData, preferenceData, adminUsers] = await Promise.all([
    api("/api/team"), api("/api/projects"), api("/api/tasks"), api("/api/notifications"), api("/api/preferences"),
    currentRole === "admin" ? api("/api/admin/users").then((data) => data.users) : Promise.resolve(null),
  ]);
  people = (adminUsers || teamData.users).map((user) => ({
    id: user.id, name: user.name, email: user.email || "", phone: user.phone_e164 || "",
    role: user.role[0].toUpperCase() + user.role.slice(1), accountStatus: user.account_status,
    active: user.account_status === "active", whatsapp: Boolean(user.whatsapp_enabled),
  }));
  projects = projectData.projects;
  tasks = taskData.tasks.map((task) => ({ ...task, dueSoon: isDueSoon(task.isoDate) }));
  notifications = notificationData.notifications;
  settingsByActor[currentUserId] = {
    phone: preferenceData.preferences.phone_e164 || "",
    whatsapp: preferenceData.preferences.whatsapp_enabled,
  };
}

await loadWorkspaceData();

// ── Date helpers ──────────────────────────────────────────────────────────────
function formatDueDate(isoDate) {
  if (!isoDate) return "TBD";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isDueSoon(isoDate) {
  if (!isoDate) return false;
  const [y, m, d] = isoDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = (due - today) / 86_400_000;
  return diff >= 0 && diff <= 7;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFERENCES
// ─────────────────────────────────────────────────────────────────────────────
const taskList    = document.querySelector("#task-list");
const emptyState  = document.querySelector("#empty-state");
const searchInput = document.querySelector("#task-search");
const filterButtons = document.querySelectorAll(".filter-button");
const taskDialog  = document.querySelector("#task-dialog");
const newTaskButton = document.querySelector("#new-task-btn");
const statusEditor = document.querySelector("#status-editor");
const peopleError = document.querySelector("#people-error");
const taskEditButton = document.querySelector("#task-edit");
const appPages = document.querySelectorAll(".app-page");
const pageButtons = document.querySelectorAll(".workspace-nav__button");
const adminPageElements = document.querySelectorAll("[data-admin-page]");

// New-task dialog
const newTaskDialog = document.querySelector("#new-task-dialog");
const newTaskForm   = document.querySelector("#new-task-form");
const fieldTitle    = document.querySelector("#field-title");
const fieldDesc     = document.querySelector("#field-description");
const fieldAssignee = document.querySelector("#field-assignee");
const fieldProject  = document.querySelector("#field-project");
const fieldDue      = document.querySelector("#field-due");
const fieldPriority = document.querySelector("#field-priority");
const fieldViz      = document.querySelector("#field-visibility");
const fieldPeople   = document.querySelector("#field-people");
const peoplePickerRow = document.querySelector("#people-picker-row");
const titleError    = document.querySelector("#title-error");
const assigneeError = document.querySelector("#assignee-error");
const newTaskTitle  = document.querySelector("#new-task-title");
const newTaskSubmit = document.querySelector("#new-task-submit");

let activeFilter    = "all";
let lastFocusedCard = null;
let openTaskId      = null; // ID of the task currently open in the detail dialog
let editingTaskId   = null;
let activePage      = "work";
let selectedProject = null;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getStatusLabel(status) {
  return { todo: "To do", "in-progress": "In progress", blocked: "Blocked", done: "Done" }[status];
}

function makeBadge(label, className) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = label;
  return badge;
}

function getVisibleTasks() {
  if (currentRole === "head" || currentRole === "admin") return tasks;
  // Department-visible tasks are readable by all Members. Selected-people tasks
  // are readable only by their assignee and the people chosen by the Head.
  return tasks.filter((task) =>
    task.visibility === "Department" || task.assigneeId === currentUserId ||
      task.visibleTo?.includes(currentUserId),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK CARD
// ─────────────────────────────────────────────────────────────────────────────
function createTaskCard(task) {
  const card = document.createElement("article");
  card.className = "task-card";
  card.dataset.taskId = String(task.id);
  card.setAttribute("tabindex", "0");
  card.setAttribute("role", "button");
  card.setAttribute("aria-haspopup", "dialog");
  card.setAttribute("aria-label", `View details for: ${task.title}`);

  // Left column — title + project + assignee
  const taskInfo = document.createElement("div");

  const titleRow = document.createElement("div");
  titleRow.className = "task-title-row";

  const statusDot = document.createElement("span");
  statusDot.className = `task-status-dot task-status-dot--${task.status}`;
  statusDot.setAttribute("aria-hidden", "true");

  const titleEl = document.createElement("h3");
  titleEl.className = "task-title";
  titleEl.textContent = task.title;
  titleRow.append(statusDot, titleEl);

  const projectEl = document.createElement("p");
  projectEl.className = "task-project";
  projectEl.textContent = task.project;

  const assigneeEl = document.createElement("p");
  assigneeEl.className = "task-assignee";
  assigneeEl.textContent = `Assigned to ${task.assignee || "Unassigned"}`;

  taskInfo.append(titleRow, projectEl, assigneeEl);

  // Right column — due, priority badge, status badge
  const metadata = document.createElement("div");
  metadata.className = "task-meta";

  const due = document.createElement("span");
  due.className = "task-due";
  due.textContent = `Due ${task.due}`;

  metadata.append(
    due,
    makeBadge(task.priority, `priority-badge priority--${task.priority.toLowerCase()}`),
    makeBadge(getStatusLabel(task.status), `status-badge status--${task.status}`),
  );

  card.append(taskInfo, metadata);
  return card;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK DETAIL DIALOG
// ─────────────────────────────────────────────────────────────────────────────
function updateDialogStatus(status) {
  document.querySelector("#dialog-status-dot").className =
    `dialog-status-dot task-status-dot--${status}`;
  const statusEl = document.querySelector("#dialog-status");
  statusEl.textContent = getStatusLabel(status);
  statusEl.className = `status-badge status--${status}`;
}

function openTaskDialog(task) {
  openTaskId = task.id;

  document.querySelector("#dialog-title").textContent = task.title;
  document.querySelector("#dialog-description").textContent =
    task.description || "No description provided.";
  document.querySelector("#dialog-project").textContent = task.project;
  document.querySelector("#dialog-due").textContent = `Due ${task.due}`;
  document.querySelector("#dialog-assignee").textContent = task.assignee || "Unassigned";
  document.querySelector("#dialog-visibility").textContent = task.visibility;

  const priorityEl = document.querySelector("#dialog-priority");
  priorityEl.textContent = task.priority;
  priorityEl.className = `priority-badge priority--${task.priority.toLowerCase()}`;

  updateDialogStatus(task.status);
  document.querySelector("#status-select").value = task.status;

  // Members can update only their own assigned tasks. Shared tasks are view-only;
  // Head can update any department task; Admin has read-only access.
  statusEditor.hidden = currentRole === "admin" ||
    (currentRole === "member" && task.assigneeId !== currentUserId);
  taskEditButton.hidden = currentRole !== "head";

  renderActivity(task);

  // Update composer avatar to match the current user
  commentAvatar.textContent = getInitials(getCurrentActorId());
  commentInput.value = "";
  commentActions.hidden = true;

  taskDialog.showModal();
}


// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY & COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

const activityList   = document.querySelector("#activity-list");
const commentForm    = document.querySelector("#comment-form");
const commentInput   = document.querySelector("#comment-input");
const commentActions = document.querySelector("#comment-actions");
const commentAvatar  = document.querySelector("#comment-avatar");

function formatActivityTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getInitials(personId) {
  const p = people.find((x) => x.id === personId);
  if (!p) return "?";
  return p.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function getPersonName(personId) {
  return people.find((x) => x.id === personId)?.name || "Someone";
}

function getCurrentActorId() {
  return currentUserId;
}

function renderActivity(task) {
  activityList.replaceChildren();
  if (!task.activity || task.activity.length === 0) {
    const empty = document.createElement("li");
    empty.className = "activity-empty";
    empty.textContent = "No activity yet.";
    activityList.appendChild(empty);
    return;
  }

  // Keep document order and visual order aligned for assistive technology.
  [...task.activity].reverse().forEach((entry) => {
    const li = document.createElement("li");
    li.className = `activity-item activity-item--${entry.type}`;

    if (entry.type === "comment") {
      const avatar = document.createElement("span");
      avatar.className = "act-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = getInitials(entry.author);

      const body = document.createElement("div");
      body.className = "act-body";
      const meta = document.createElement("p");
      meta.className = "act-meta";
      const name = document.createElement("strong");
      name.className = "act-name";
      name.textContent = entry.authorName || getPersonName(entry.author);
      const time = document.createElement("span");
      time.className = "act-time";
      time.textContent = formatActivityTime(entry.time);
      meta.append(name, time);

      const comment = document.createElement("p");
      comment.className = "act-text";
      comment.textContent = entry.text;
      body.append(meta, comment);
      li.append(avatar, body);
    } else {
      const dot = document.createElement("span");
      dot.className = "act-dot";
      dot.setAttribute("aria-hidden", "true");
      const eventText = document.createElement("p");
      eventText.className = "act-event";
      const time = document.createElement("span");
      time.className = "act-time";
      time.textContent = formatActivityTime(entry.time);
      eventText.append(time, document.createTextNode(` — ${entry.text}`));
      li.append(dot, eventText);
    }
    activityList.appendChild(li);
  });
}

// Show/hide comment action buttons when textarea is focused / typed in
commentInput.addEventListener("focus", () => { commentActions.hidden = false; });
commentInput.addEventListener("input", () => {
  commentActions.hidden = commentInput.value.trim() === "";
});

document.querySelector("#comment-cancel").addEventListener("click", () => {
  commentInput.value = "";
  commentActions.hidden = true;
});

commentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = commentInput.value.trim();
  if (!text || !openTaskId) return;
  try {
    await api(`/api/tasks/${openTaskId}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
    await loadWorkspaceData();
    const task = tasks.find((entry) => entry.id === openTaskId);
    commentInput.value = "";
    commentActions.hidden = true;
    if (task) renderActivity(task);
    updateNotificationBadge();
  } catch (error) {
    window.alert(error.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// COUNTS & RENDER
// ─────────────────────────────────────────────────────────────────────────────
function updateCounts() {
  const visible = getVisibleTasks();
  const counts = {
    all:          visible.length,
    todo:         visible.filter((t) => t.status === "todo").length,
    "in-progress":visible.filter((t) => t.status === "in-progress").length,
    blocked:      visible.filter((t) => t.status === "blocked").length,
    done:         visible.filter((t) => t.status === "done").length,
  };

  document.querySelector("#open-count").textContent =
    String(visible.filter((t) => t.status !== "done").length);
  document.querySelector("#due-count").textContent =
    String(visible.filter((t) => t.dueSoon && t.status !== "done").length);
  document.querySelector("#done-count").textContent = String(counts.done);

  document.querySelector("#count-all").textContent          = String(counts.all);
  document.querySelector("#count-todo").textContent         = String(counts.todo);
  document.querySelector("#count-in-progress").textContent  = String(counts["in-progress"]);
  document.querySelector("#count-blocked").textContent      = String(counts.blocked);
  document.querySelector("#count-done").textContent         = String(counts.done);
}

function renderTasks() {
  const searchTerm   = searchInput.value.trim().toLowerCase();
  const visibleTasks = getVisibleTasks().filter((task) => {
    const matchesStatus = activeFilter === "all" || task.status === activeFilter;
    const searchableText = `${task.title} ${task.project} ${task.priority} ${getStatusLabel(task.status)} ${task.assignee}`.toLowerCase();
    return matchesStatus && searchableText.includes(searchTerm);
  });

  const fragment = document.createDocumentFragment();
  visibleTasks.forEach((task) => fragment.append(createTaskCard(task)));
  taskList.replaceChildren(fragment);
  emptyState.hidden = visibleTasks.length > 0;
}

function updatePanelHeading() {
  const heading = document.querySelector("#tasks-heading");
  const subtext = document.querySelector("#tasks-subtext");
  if (currentRole === "head") {
    heading.textContent = "All department tasks";
    subtext.textContent = "Every task assigned across the Department of Innovation & Entrepreneurship.";
  } else if (currentRole === "admin") {
    heading.textContent = "Department task overview";
    subtext.textContent = "Review task progress across the Department of Innovation & Entrepreneurship.";
  } else {
    heading.textContent = "Tasks visible to me";
    subtext.textContent = "Department-wide tasks, tasks shared with you, and work assigned to you.";
  }
}

function updateRoleChrome() {
  const selectedPerson = people.find((person) => person.id === currentUserId);
  const displayName = selectedPerson?.name || signedInUser.name;
  const roleLabel = selectedPerson?.role || currentRole[0].toUpperCase() + currentRole.slice(1);

  document.querySelector("#profile-name").textContent = displayName;
  document.querySelector("#profile-role").textContent = roleLabel;
  document.querySelector("#profile-avatar").textContent = displayName
    .split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  document.querySelector("#page-title").textContent = currentRole === "member" ? "My Work"
    : currentRole === "head" ? "Department Tasks" : "Department Overview";
  document.querySelector("#workspace-eyebrow").textContent = currentRole === "member"
    ? "Your workspace" : "Department workspace";
  document.querySelector("#workspace-view-label").textContent = currentRole === "member"
    ? "Personal task view" : currentRole === "head" ? "Head view" : "Admin overview";
  document.querySelector("#open-footnote").textContent = currentRole === "member"
    ? "Visible to you" : "Across the department";
  newTaskButton.hidden = currentRole !== "head";
  const newProjectButton = document.querySelector("#new-project-button");
  if (newProjectButton) newProjectButton.hidden = currentRole !== "head";
  adminPageElements.forEach((element) => {
    element.hidden = currentRole !== "admin" ||
      (element.classList.contains("app-page") && activePage !== "team");
  });
}

function refreshDashboard() {
  renderPeopleControls();
  updateRoleChrome();
  updatePanelHeading();
  updateCounts();
  renderTasks();
  updateNotificationBadge();
  if (activePage === "projects") renderProjects();
  if (activePage === "notifications") renderNotifications();
  if (activePage === "team") renderTeam();
  if (activePage === "settings") loadSettings();
}

function showPage(pageName) {
  if (pageName === "team" && currentRole !== "admin") pageName = "work";
  activePage = pageName;
  appPages.forEach((page) => { page.hidden = page.id !== `page-${pageName}`; });
  pageButtons.forEach((button) => {
    const active = button.dataset.page === pageName;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  adminPageElements.forEach((element) => {
    element.hidden = currentRole !== "admin" ||
      (element.classList.contains("app-page") && pageName !== "team");
  });
  if (pageName === "projects") renderProjects();
  if (pageName === "notifications") renderNotifications();
  if (pageName === "team") renderTeam();
  if (pageName === "settings") loadSettings();
}

function renderPeopleControls() {
  const selectedAssignee = fieldAssignee.value;
  fieldAssignee.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a person";
  placeholder.disabled = true;
  fieldAssignee.append(placeholder);
  people.filter((person) => person.active).forEach((person) => {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = person.name;
    fieldAssignee.append(option);
  });
  fieldAssignee.value = selectedAssignee;

  fieldPeople.replaceChildren();
  people.filter((person) => person.active).forEach((person) => {
    const label = document.createElement("label");
    label.className = "people-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "visibleTo";
    checkbox.value = person.id;
    label.append(checkbox, document.createTextNode(person.name));
    fieldPeople.append(label);
  });
}

function getVisibleNotifications() {
  return notifications;
}

function updateNotificationBadge() {
  const unread = getVisibleNotifications().filter((notice) => !notice.read).length;
  const badge = document.querySelector("#notification-badge");
  badge.textContent = String(unread);
  badge.hidden = unread === 0;
}

function renderNotifications() {
  const list = document.querySelector("#notification-list");
  list.replaceChildren();
  const visible = getVisibleNotifications();
  document.querySelector("#notifications-empty").hidden = visible.length > 0;
  visible.forEach((notice) => {
    const item = document.createElement("article");
    item.className = `notification-item${notice.read ? " is-read" : ""}`;
    const marker = document.createElement("span");
    marker.className = "notification-marker";
    marker.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "notification-copy";
    const title = document.createElement("h3");
    title.textContent = notice.title;
    const body = document.createElement("p");
    body.textContent = notice.body;
    const time = document.createElement("time");
    time.textContent = formatActivityTime(notice.time);
    content.append(title, body, time);
    const action = document.createElement("button");
    action.className = "notification-action";
    action.type = "button";
    action.textContent = notice.read ? "Read" : "Mark read";
    action.disabled = notice.read;
    action.addEventListener("click", async () => {
      try {
        await api(`/api/notifications/${notice.id}/read`, { method: "PATCH" });
        notice.read = true;
        renderNotifications();
        updateNotificationBadge();
      } catch (error) { window.alert(error.message); }
    });
    if (notice.taskId) {
      const open = document.createElement("button");
      open.className = "notification-open";
      open.type = "button";
      open.textContent = "Open task";
      open.addEventListener("click", () => {
        const task = tasks.find((entry) => entry.id === notice.taskId);
        if (task && getVisibleTasks().includes(task)) {
          showPage("work");
          lastFocusedCard = taskList.querySelector(`[data-task-id="${task.id}"]`);
          openTaskDialog(task);
          if (!notice.read) {
            api(`/api/notifications/${notice.id}/read`, { method: "PATCH" }).then(loadWorkspaceData).then(refreshDashboard).catch((error) => window.alert(error.message));
          }
        }
      });
      content.append(open);
    }
    item.append(marker, content, action);
    list.append(item);
  });
}

function renderProjects() {
  const grid = document.querySelector("#project-grid");
  const detail = document.querySelector("#project-detail");
  grid.replaceChildren();
  detail.hidden = !selectedProject;
  grid.hidden = Boolean(selectedProject);
  if (!selectedProject) {
    projects.forEach((project) => {
      const projectTasks = getVisibleTasks().filter((task) => task.projectId === project.id);
      const card = document.createElement("article");
      card.className = "project-card";
      const title = document.createElement("h2");
      title.textContent = project.name;
      const count = document.createElement("p");
      count.textContent = `${projectTasks.length} visible ${projectTasks.length === 1 ? "task" : "tasks"}`;
      const progress = document.createElement("div");
      progress.className = "project-progress";
      const done = projectTasks.filter((task) => task.status === "done").length;
      const fill = document.createElement("span");
      fill.style.width = `${projectTasks.length ? Math.round(done / projectTasks.length * 100) : 0}%`;
      progress.append(fill);
      const button = document.createElement("button");
      button.className = "project-open";
      button.type = "button";
      button.textContent = "View project";
      button.addEventListener("click", () => {
        selectedProject = project.id;
        renderProjects();
      });
      card.append(title, count, progress, button);
      grid.append(card);
    });
    return;
  }

  const title = document.querySelector("#project-detail-title");
  const project = projects.find((entry) => entry.id === selectedProject);
  title.textContent = project?.name || "Project";
  const list = document.querySelector("#project-task-list");
  list.replaceChildren();
  const projectTasks = getVisibleTasks().filter((task) => task.projectId === selectedProject);
  if (!projectTasks.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tasks in this project are visible to this account yet.";
    list.append(empty);
  }
  projectTasks.forEach((task) => {
    const row = document.createElement("button");
    row.className = "project-task-row";
    row.type = "button";
    const name = document.createElement("strong");
    name.textContent = task.title;
    const meta = document.createElement("span");
    meta.textContent = `${task.assignee} · ${getStatusLabel(task.status)} · Due ${task.due}`;
    row.append(name, meta);
    row.addEventListener("click", () => {
      lastFocusedCard = row;
      openTaskDialog(task);
    });
    list.append(row);
  });
}

function renderTeam() {
  const body = document.querySelector("#team-table-body");
  body.replaceChildren();
  people.forEach((person) => {
    const row = document.createElement("tr");
    const name = document.createElement("td"); name.textContent = person.name;
    const email = document.createElement("td"); email.textContent = person.email || "No email added";
    const roleCell = document.createElement("td");
    roleCell.textContent = person.role;
    const statusCell = document.createElement("td");
    statusCell.textContent = person.accountStatus || (person.active ? "Active" : "Inactive");
    row.append(name, email, roleCell, statusCell);
    body.append(row);
  });
}

function getCurrentPerson() {
  return people.find((person) => person.id === currentUserId) || {
    name: currentRole === "head" ? "Department Head" : "Workspace Admin",
    email: "", phone: "", whatsapp: false,
  };
}

function loadSettings() {
  const person = getCurrentPerson();
  const saved = settingsByActor[currentUserId] || person;
  document.querySelector("#settings-name").value = person.name;
  document.querySelector("#settings-email").value = person.email || "";
  document.querySelector("#settings-phone").value = saved.phone || "";
  document.querySelector("#settings-whatsapp").checked = Boolean(saved.whatsapp);
  document.querySelector("#settings-message").textContent = "";
}

pageButtons.forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

document.querySelector("#project-back").addEventListener("click", () => {
  selectedProject = null;
  renderProjects();
});

document.querySelector("#mark-all-read").addEventListener("click", async () => {
  try { await api("/api/notifications/read-all", { method: "POST" }); await loadWorkspaceData(); renderNotifications(); updateNotificationBadge(); }
  catch (error) { window.alert(error.message); }
});

document.querySelector("#invite-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const nameInput = document.querySelector("#invite-name");
  const emailInput = document.querySelector("#invite-email");
  const error = document.querySelector("#invite-error");
  const email = emailInput.value.trim().toLowerCase();
  error.hidden = true;
  document.querySelector("#invite-result").hidden = true;
  if (currentRole !== "admin") return;
  if (!nameInput.value.trim() || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) {
    error.textContent = "Enter a name and a valid email address. A @diu.edu.bd address is recommended.";
    error.hidden = false;
    return;
  }
  const submit = event.currentTarget.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const response = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        email,
        role: document.querySelector("#invite-role").value.toLowerCase(),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not create invitation.");

    document.querySelector("#invite-url").value = result.inviteUrl;
    document.querySelector("#invite-result").hidden = false;
    error.textContent = `Invitation created for ${result.invitation.email}. Copy the link and send it directly; it expires in 48 hours.`;
    error.hidden = false;
    error.dataset.kind = "success";
    event.currentTarget.reset();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    error.dataset.kind = "error";
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#copy-invite-link").addEventListener("click", async () => {
  const linkInput = document.querySelector("#invite-url");
  await navigator.clipboard.writeText(linkInput.value);
  document.querySelector("#copy-invite-link").textContent = "Copied";
});

document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const phoneInput = document.querySelector("#settings-phone").value.trim().replace(/[\s()-]/g, "");
  const whatsappEnabled = document.querySelector("#settings-whatsapp").checked;
  const message = document.querySelector("#settings-message");
  let phone = phoneInput;
  if (/^01\d{9}$/.test(phone)) phone = `+88${phone}`;
  else if (/^8801\d{9}$/.test(phone)) phone = `+${phone}`;
  if (whatsappEnabled && !phone) {
    message.textContent = "Add your WhatsApp number in international format before enabling updates.";
    message.dataset.kind = "error"; return;
  }
  try {
    await api("/api/preferences", { method: "PUT", body: JSON.stringify({ phone, whatsappEnabled }) });
    await loadWorkspaceData();
    loadSettings();
    message.textContent = "Preferences saved. WhatsApp message delivery still needs a provider connection.";
    message.dataset.kind = "success";
  } catch (error) { message.textContent = error.message; message.dataset.kind = "error"; }
});

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL RENDER
// ─────────────────────────────────────────────────────────────────────────────

// Populate assignee and project selects in the new-task form
function renderProjectOptions(selected = "") {
  fieldProject.replaceChildren(new Option("No project", ""));
  projects.forEach((project) => fieldProject.add(new Option(project.name, project.id)));
  fieldProject.value = selected;
}
renderPeopleControls();
renderProjectOptions();

refreshDashboard();

document.querySelector("#new-project-button").addEventListener("click", async () => {
  if (currentRole !== "head") return;
  const name = window.prompt("Project name");
  if (!name || !name.trim()) return;
  const description = window.prompt("Short project description (optional)") || "";
  try {
    const result = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: name.trim(), description: description.trim() }) });
    await loadWorkspaceData();
    renderProjectOptions();
    selectedProject = result.project.id;
    renderProjects();
  } catch (error) { window.alert(error.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// FILTER BUTTONS
// ─────────────────────────────────────────────────────────────────────────────
filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((fb) => {
      const isActive = fb === button;
      fb.classList.toggle("is-active", isActive);
      fb.setAttribute("aria-pressed", String(isActive));
    });
    renderTasks();
  });
});

searchInput.addEventListener("input", renderTasks);

// ─────────────────────────────────────────────────────────────────────────────
// TASK CARD INTERACTIONS
// ─────────────────────────────────────────────────────────────────────────────
taskList.addEventListener("click", (event) => {
  const card = event.target.closest(".task-card");
  if (!card) return;
  lastFocusedCard = card;
  const task = tasks.find((t) => t.id === card.dataset.taskId);
  if (task) openTaskDialog(task);
});

taskList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".task-card");
  if (!card) return;
  event.preventDefault();
  lastFocusedCard = card;
  const task = tasks.find((t) => t.id === card.dataset.taskId);
  if (task) openTaskDialog(task);
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK DETAIL DIALOG — CLOSE / SAVE
// ─────────────────────────────────────────────────────────────────────────────
document.querySelector("#dialog-close").addEventListener("click", () => taskDialog.close());

taskDialog.addEventListener("click", (event) => {
  if (event.target === taskDialog) taskDialog.close();
});

taskDialog.addEventListener("close", () => {
  if (lastFocusedCard && lastFocusedCard.isConnected) lastFocusedCard.focus();
});

// Save status changes through the authenticated API.
document.querySelector("#status-save").addEventListener("click", async () => {
  const task = tasks.find((entry) => entry.id === openTaskId);
  if (!task) return;
  const status = document.querySelector("#status-select").value;
  try {
    if (status !== task.status) await api(`/api/tasks/${task.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadWorkspaceData();
    refreshDashboard();
    const updated = tasks.find((entry) => entry.id === openTaskId);
    if (updated) {
      updateDialogStatus(updated.status);
      document.querySelector("#status-select").value = updated.status;
      renderActivity(updated);
      renderTasks(); updateCounts();
    }
    taskDialog.close();
  } catch (error) { window.alert(error.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW TASK DIALOG
// ─────────────────────────────────────────────────────────────────────────────

// Toggle people-picker visibility when visibility select changes
fieldViz.addEventListener("change", () => {
  peoplePickerRow.hidden = fieldViz.value !== "Selected people";
  peopleError.hidden = true;
});

// Clear title error as the user types
fieldTitle.addEventListener("input", () => {
  if (fieldTitle.value.trim()) titleError.hidden = true;
});

function openTaskForm(task = null) {
  editingTaskId = task?.id ?? null;
  newTaskForm.reset();
  titleError.hidden = true;
  assigneeError.hidden = true;
  peopleError.hidden = true;
  fieldPeople.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = Boolean(task?.visibleTo?.includes(cb.value));
  });

  if (task) {
    newTaskTitle.textContent = "Edit task";
    newTaskSubmit.textContent = "Save task";
    fieldTitle.value = task.title;
    fieldDesc.value = task.description === "No description provided." ? "" : task.description;
    fieldAssignee.value = task.assigneeId;
    fieldProject.value = task.projectId || "";
    fieldDue.value = task.isoDate || "";
    fieldPriority.value = task.priority;
    fieldViz.value = task.visibility;
    peoplePickerRow.hidden = task.visibility !== "Selected people";
  } else {
    newTaskTitle.textContent = "Create a task";
    newTaskSubmit.textContent = "Add task";
    peoplePickerRow.hidden = true;
  }
  newTaskDialog.showModal();
  fieldTitle.focus();
}

// Open
document.querySelector("#new-task-btn").addEventListener("click", () => {
  if (currentRole !== "head") return;
  openTaskForm();
});

taskEditButton.addEventListener("click", () => {
  if (currentRole !== "head") return;
  const task = tasks.find((entry) => entry.id === openTaskId);
  if (!task) return;
  taskDialog.close();
  openTaskForm(task);
});

// Close / Cancel
document.querySelector("#new-task-close").addEventListener("click",  () => newTaskDialog.close());
document.querySelector("#new-task-cancel").addEventListener("click", () => newTaskDialog.close());
newTaskDialog.addEventListener("click", (e) => { if (e.target === newTaskDialog) newTaskDialog.close(); });

// Submit
newTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (currentRole !== "head") return;
  const title = fieldTitle.value.trim();
  const assigneeId = fieldAssignee.value;
  const assigneePerson = people.find((person) => person.id === assigneeId);
  if (!title) { titleError.textContent = "Please enter a task title."; titleError.hidden = false; fieldTitle.focus(); return; }
  titleError.hidden = true;
  if (!assigneePerson) { assigneeError.textContent = "Choose a person responsible for this task."; assigneeError.hidden = false; fieldAssignee.focus(); return; }
  assigneeError.hidden = true;
  const visibility = fieldViz.value;
  const visibleTo = visibility === "Selected people"
    ? [...fieldPeople.querySelectorAll("input[type=checkbox]:checked")].map((checkbox) => checkbox.value) : [];
  if (visibility === "Selected people" && visibleTo.length === 0) {
    peopleError.textContent = "Select at least one person who can see this task."; peopleError.hidden = false; return;
  }
  if (visibility === "Selected people" && !visibleTo.includes(assigneeId)) visibleTo.push(assigneeId);
  const payload = {
    title, description: fieldDesc.value.trim(), projectId: fieldProject.value || null,
    dueAt: fieldDue.value || null, priority: fieldPriority.value.toLowerCase(), visibility, visibleTo, assigneeId,
  };
  try {
    const endpoint = editingTaskId ? `/api/tasks/${editingTaskId}` : "/api/tasks";
    const result = await api(endpoint, { method: editingTaskId ? "PATCH" : "POST", body: JSON.stringify(payload) });
    const savedId = result.task.id;
    editingTaskId = null;
    await loadWorkspaceData();
    refreshDashboard();
    newTaskDialog.close();
    if (payload.title && tasks.some((entry) => entry.id === savedId)) openTaskDialog(tasks.find((entry) => entry.id === savedId));
  } catch (error) {
    window.alert(error.message);
  }
});

// Sign out only when the explicit sign-out button is pressed.
document.querySelector("#sign-out-button").addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.replace("/");
  }
});
