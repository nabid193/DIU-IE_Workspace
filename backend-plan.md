# Backend plan — DIU I&E workspace

This plan translates the current frontend prototype into backend data and rules. The frontend is a prototype: its role picker and in-memory arrays are not secure and do not persist after a page reload. The server and database must become the source of truth.

## 1. Users

Store one record per department account:

- `id`: generated unique identifier.
- `name`: person's display name.
- `email`: valid email address, normalized to lowercase and unique. A `@diu.edu.bd` address is recommended but not required.
- `role`: `admin`, `head`, or `member`.
- `account_status`: `invited`, `active`, or `disabled`.
- `created_at`, `updated_at`.

Authentication uses the account email and a separate workspace password. A `@diu.edu.bd` email is recommended but not required. Require email verification and store only a securely hashed password (or use a trusted authentication provider so we do not handle passwords ourselves). Password reset uses a time-limited, single-use token (30-minute expiry) delivered by the configured email provider. Do not store a user's password in plain text.

Account creation should be invite/admin-controlled or require approval. A public signup form must not let someone choose their own role or gain department access automatically.

WhatsApp is a notification channel, not a login identifier. Store an optional phone number in international format and a separate opt-in preference. Keep the phone number private and never send messages unless the user opted in.

## 2. Projects

Store:

- `id`, `name`, optional `description`.
- `created_by_user_id` (references a user).
- `created_at`, `updated_at`, and optional `archived_at`.

A project has many tasks. A task may belong to one project or have no project. For the first version, projects are visible to active department users; task visibility rules still control which tasks a member can open. Heads create, edit, and archive projects.

## 3. Tasks

Store:

- `id`, `title`, `description`.
- `project_id` (optional reference to a project).
- `created_by_user_id` and `assignee_user_id` (references to users).
- `status`: `todo`, `in_progress`, `blocked`, or `done`.
- `priority`: `normal`, `medium`, or `high`.
- `due_at` (optional date/time).
- `visibility`: `department` or `selected`.
- `created_at`, `updated_at`, and optional `completed_at`.

Each task has one primary assignee, matching the current frontend. Optional collaborators can be added later as a separate many-to-many relationship; they are not required for the first backend version.

## 4. Task access

For `department` visibility, every active department user can view the task.

For `selected` visibility, the primary assignee and explicitly selected viewers can view the task. Store selected viewers in a join table such as `task_viewers(task_id, user_id)`, with a unique constraint on the pair. The assignee must always be included in the effective access list, even if the creator forgets to add them as a viewer.

Every request that reads or changes a task must check access on the server. Hiding a task in the browser is not an access control rule. Disabled users cannot sign in or access data.

## 5. Comments and activity

Store comments separately from task fields:

- `id`, `task_id`, `author_user_id`, `body`, `created_at`.

Store a task activity/audit record for important events:

- `id`, `task_id`, `actor_user_id`, `event_type`, `details` (structured data), `created_at`.
- Examples: task created, assignee changed, status changed, due date changed, visibility changed, comment added.

Do not rely on the browser to create trusted activity records. The server should record the event when it successfully performs the corresponding action. Comments and activity are readable only by people allowed to view that task.

## 6. Notifications and preferences

Store in-app notifications:

- `id`, `recipient_user_id`, optional `task_id`, `type`, `title`, `message`, `created_at`, optional `read_at`.

Create notifications for assignment/reassignment, a new comment, a status change, and due-date reminders. Send to users who can access the task and are relevant to the event; avoid notifying the actor about their own action. A scheduled server job will be needed for due-date reminders.

Store per-user channel preferences, including `email_enabled` and `whatsapp_enabled`; default WhatsApp to off. Keep WhatsApp sending as a later phase: first build reliable in-app notifications, then connect an approved WhatsApp Business messaging provider and respect opt-in and delivery rules.

## 7. Relationships (first database draft)

- One user creates many projects and tasks.
- One project has zero or many tasks; each task belongs to zero or one project.
- One user can be the assignee of many tasks; each task has one primary assignee.
- A task has many selected viewers and a user can view many selected tasks (`task_viewers`).
- A task has many comments and activity events.
- A user receives many notifications and has one notification-preferences record.

## 8. Permissions

All rules below must be checked by the backend on every request.

| Action | Admin | Head | Member |
|---|---|---|---|
| Manage accounts and roles | Yes | No | No |
| Create/edit/archive projects | No | Yes | No |
| Create tasks and choose assignee/viewers | No | Yes | No |
| Edit task details or reassign | No | Yes | No |
| View a task, including selected tasks | If active | If active | If department-visible, assigned, or selected |
| Change task status | No by default | Yes | Only when assigned |
| Comment on a task | If allowed to view | If allowed to view | If allowed to view |
| Read own notifications and change own preferences | Yes | Yes | Yes |

For this first version, Admins can view all tasks for department oversight, including `selected` tasks. Heads can also view all tasks so they can assign and coordinate work. Admins manage accounts but do not create or edit task workflow data; Heads own that workflow.

## 9. Server actions (initial API outline)

- `POST /auth/register-request` — submit an account request; does not create an active account or let the requester choose a role.
- `POST /auth/login`, `POST /auth/logout`, `POST /auth/forgot-password`, `POST /auth/reset-password`.
- `GET /me`, `PATCH /me/preferences`.
- `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`.
- `GET /tasks` — return only tasks the signed-in user may access; support status/project filters.
- `POST /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`.
- `POST /tasks/:id/status` — validate role and assignment before changing status.
- `GET /tasks/:id/comments`, `POST /tasks/:id/comments`.
- `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`.
- Admin-only account actions such as `GET /admin/users`, `POST /admin/invitations`, and `PATCH /admin/users/:id`.

The server must validate input, authenticate the caller, check the caller's role and task access, then read/write the database. Never trust a user ID, role, visibility decision, or permission sent by the browser without checking it against the signed-in account and database.

## First-version scope and chosen defaults

Implemented: accounts/invitations, project creation/edit APIs, tasks, task visibility, status updates, comments/activity, in-app notifications, and stored WhatsApp opt-in preferences. Remaining: provider-backed WhatsApp delivery, project archiving, production deployment configuration, backups/monitoring, and a real-world user acceptance pass. Password recovery is implemented using Resend and single-use database tokens. File uploads, multiple assignees/collaborators, and advanced reporting remain out of first-version scope.

Use these initial rules while learning and building:

1. Admins and Heads can view every task; Members follow task visibility.
2. Heads can assign and update any task; Members can change status only on tasks assigned to them.
3. Admins invite accounts. Public self-registration is deferred.
4. Project names need not be unique. Archived projects remain attached to existing tasks but cannot receive new tasks.

## Learning sequence

1. Review this model and settle the open decisions.
2. Set up a Node.js + Express server and connect PostgreSQL using environment variables for secrets.
3. Create database tables and constraints from the relationships above.
4. Add authentication and server-side role/access checks.
5. Add project and task endpoints, then comments and notifications.
6. Replace the frontend sample arrays with API requests. (Done.)
7. Add WhatsApp after opt-in, in-app notifications, and backend permissions are working.


## Password policy and recovery implementation

New passwords require at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character (maximum 128 characters). Existing password hashes remain valid; the stronger policy is applied when an account creates or resets a password.

Password recovery:
- `POST /api/auth/forgot-password` accepts any valid email address and returns a generic response to avoid account enumeration.
- Reset tokens are random, single-use, expire after 30 minutes, and are stored only as SHA-256 hashes.
- Production email delivery uses Resend (`RESEND_API_KEY` and `MAIL_FROM`).
- In local development only, the reset link is printed in the server terminal when Resend is not configured.
- `POST /api/auth/reset-password` validates the token, hashes the new password, consumes outstanding tokens, and invalidates existing sessions.
