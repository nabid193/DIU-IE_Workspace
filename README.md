# DIU I&E Workspace

# This Readme file is made with AI to look clean

**A Centralized Departmental Management Platform**

## Live Demo

[https://github.com/nabid193/DIU-IE_Workspace](https://diu-ie-workspace.vercel.app/)

The application is hosted on Vercel. Access to workspace features requires an authorized account.

---

DIU I&E Workspace is a web-based project and task management platform designed for the Department of Innovation & Entrepreneurship at Daffodil International University.

It provides a centralized environment for managing departmental projects, assigning tasks, coordinating team activities and tracking work progress.

## Overview

The platform is designed around three primary account roles:

- **Administrator:** Workspace administration and user management.
- **Head:** Departmental coordination and management.
- **Member:** Personal tasks, project collaboration and notifications.

Actual permissions are determined by the application's role-based authorization system.

## Key Features

- Secure user authentication and session management.
- Role-based access control.
- Personal workspace dashboard.
- Departmental project management.
- Task creation, assignment and progress tracking.
- Task comments and activity history.
- Task viewer management.
- Notifications and read-status management.
- User preferences.
- Account invitations and administrative user management.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js |
| Server framework | Express.js |
| Database | PostgreSQL |
| Database hosting | Neon |
| Deployment | Vercel |
| Version control | Git and GitHub |

## Project Structure

```text
DIU-IE-Workspace/
├── public/
├── server/
│   └── src/
│       ├── server.js
│       ├── setup-db.js
│       ├── create-admin.js
│       ├── auth.js
│       ├── admin.js
│       └── workspace.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── README.md
└── LICENSE
```

Additional backend modules and frontend files may be present.

## Requirements

- Node.js 20 or newer.
- npm.
- A PostgreSQL database.
- A Neon account for hosted database deployment.

## Installation and Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd DIU-IE-Workspace
```

Replace the repository URL with your actual GitHub repository address.

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure environment variables

Create your local environment file:

```bash
cp .env.example .env
```

Open `.env` and configure the required values:

| Variable | Purpose |
|---|---|
| PORT | Local application port (3000) |
| APP_BASE_URL | Application base URL |
| DATABASE_URL | PostgreSQL connection string |
| SESSION_SECRET | Secure session encryption secret |
| RESEND_API_KEY | Email delivery API key |
| MAIL_FROM | Verified email sender |

Never commit `.env` to GitHub.

### 4. Initialize the database

After configuring `DATABASE_URL`, execute:

```bash
npm run db:setup
```

This initializes the application's database schema.

### 5. Create the first administrator

```bash
npm run admin:create
```

Follow the terminal prompts to create the administrator account.

Use a unique, strong password.

### 6. Start the development server

```bash
npm run dev
```

Open:

http://localhost:3000

### Production start command

```bash
npm start
```

## Environment Configuration

The application uses environment variables to manage database connectivity, sessions and email configuration.

For production:

- Use a Neon PostgreSQL connection string.
- Generate a unique session secret.
- Set `APP_BASE_URL` to your deployed application URL.
- Configure Resend and a verified sender address if email-based password recovery is required.

Never publish production credentials.

## Deployment

The application is designed to work with Vercel and Neon.

General deployment procedure:

1. Push the source code to GitHub.
2. Import the repository into Vercel.
3. Configure the production environment variables.
4. Connect the production Neon database.
5. Initialize the database schema if it is a new database.
6. Create the initial administrator if required.
7. Deploy and test the application.

Use your own database and environment variables when deploying a separate instance.

## Password Recovery

The application supports a password recovery workflow.

For production email delivery, configure:

- A Resend API key.
- A verified sender address.
- The correct production application URL.

Without a configured email provider, production password recovery emails cannot be delivered.

## Security Guidelines

- Never commit passwords or API keys.
- Keep `.env` private.
- Use strong, unique account passwords.
- Use secure database connections.
- Restrict administrator privileges.
- Avoid storing sensitive personal information in public repositories.
- Regularly review access permissions.

## Development Status

DIU I&E Workspace is an actively developed project. Features, functionality and security improvements may continue as the platform evolves.

Contributions, feedback and suggestions are welcome.

## License

See the `LICENSE` file for licensing information.

## Project

**DIU I&E Workspace**

Daffodil International University

Project maintainer: Nabid Morshed