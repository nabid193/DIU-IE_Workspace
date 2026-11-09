# DIU I&E Workspace

A department workspace for managing projects, tasks, team accounts, comments, and notifications for the Department of Innovation & Entrepreneurship.

## Technology

- Node.js and Express
- PostgreSQL (Neon-compatible)
- Express sessions stored in PostgreSQL
- HTML, CSS, and browser JavaScript

## Start from a new database

1. Create a **new Neon PostgreSQL project**.
2. Copy its pooled connection string.
3. Copy `.env.example` to `.env` in the project root.
4. Put the new Neon connection string in `DATABASE_URL`.
5. Generate a session secret with `openssl rand -base64 48` and put it in `SESSION_SECRET`.
6. Keep `APP_BASE_URL=http://localhost:3000` for local development.
7. Install dependencies with `npm install`.
8. Create the tables with `npm run db:setup`.
9. Create the first Admin with `npm run admin:create`.
10. Start the app with `npm run dev`.
11. Visit `http://localhost:3000` and check `http://localhost:3000/api/health`.

The database setup uses `CREATE TABLE IF NOT EXISTS`. It creates missing tables; it does not delete existing data.

## Email policy

Any valid email address is accepted. A `@diu.edu.bd` address is recommended but not mandatory.

## Password policy

New passwords must be 8–128 characters and include:
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

Passwords are stored as scrypt hashes. They are never stored as plain text.

## Forgot password

Password reset uses a random, single-use token that expires after 30 minutes. Only a SHA-256 hash of the token is stored in PostgreSQL.

For local development, if Resend is not configured, a reset link for an existing active account is printed in the Terminal running the server. The link is not returned by the API.

For production email delivery:
1. Verify a sending domain with Resend.
2. Set `RESEND_API_KEY`.
3. Set `MAIL_FROM` to an address on the verified domain.
4. Set `APP_BASE_URL` to the deployed HTTPS website URL.
5. Add the variables in Vercel and redeploy.

## Admin and team accounts

Run `npm run admin:create` only after `npm run db:setup`. This creates the first Admin in the new database. Further users are invited from the Admin Team area.

## Deployment

The project includes a root `server.js` Express entrypoint for Vercel. Use the repository root as the Vercel Root Directory. Configure:
- `DATABASE_URL`: Neon pooled connection string
- `SESSION_SECRET`: a unique production secret (do not reuse the local value)
- `APP_BASE_URL`: the deployed HTTPS URL
- `RESEND_API_KEY` and `MAIL_FROM`: for production password-reset email

Never commit `.env`, `.env.save`, database passwords, API keys, or session secrets. Only `.env.example` belongs in GitHub.
