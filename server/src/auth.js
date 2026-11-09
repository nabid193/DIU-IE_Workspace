import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { pool } from "./db.js";
import { hashPassword, verifyPassword, passwordPolicyError } from "./passwords.js";
import { sendPasswordResetEmail } from "./email.js";

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
});
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many password recovery requests. Try again later." },
});
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many password reset attempts. Try again later." },
});

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

function isValidEmail(email) {
  return typeof email === "string"
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireAuth(request, response, next) {
  if (!request.session.userId) {
    return response.status(401).json({ error: "Sign in is required." });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, role
         FROM users
        WHERE id = $1 AND account_status = 'active'
        LIMIT 1`,
      [request.session.userId],
    );
    if (!result.rows[0]) {
      return response.status(401).json({ error: "Your account is not active." });
    }
    request.user = result.rows[0];
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      return response.status(403).json({ error: "You do not have permission to do that." });
    }
    return next();
  };
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve());
  });
}

function destroySession(request) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => error ? reject(error) : resolve());
  });
}

router.post("/login", loginLimiter, async (request, response) => {
  const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (!isValidEmail(email) || password.length === 0 || password.length > 256) {
    return response.status(400).json({ error: "Enter a valid email address and password." });
  }

  const result = await pool.query(
    `SELECT id, name, email, role, password_hash
       FROM users
      WHERE lower(email) = $1 AND account_status = 'active'
      LIMIT 1`,
    [email],
  );
  const account = result.rows[0];

  // Use one response for unknown emails and wrong passwords to avoid revealing accounts.
  const passwordMatches = account?.password_hash
    ? await verifyPassword(password, account.password_hash)
    : false;

  if (!account || !passwordMatches) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }

  await regenerateSession(request);
  request.session.userId = account.id;
  await saveSession(request);
  return response.json({ user: publicUser(account) });
});

router.post("/forgot-password", recoveryLimiter, async (request, response) => {
  response.set("Cache-Control", "no-store");
  const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";

  if (!isValidEmail(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }

  const mailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
  if (process.env.NODE_ENV === "production" && (!mailConfigured || !process.env.APP_BASE_URL)) {
    return response.status(503).json({
      error: "Password recovery is not configured yet. Please contact a workspace Admin.",
    });
  }

  const genericMessage = "If an active account exists for that email, password reset instructions will be sent.";
  const userResult = await pool.query(
    `SELECT id, email FROM users
      WHERE lower(email) = $1 AND account_status = 'active'
      LIMIT 1`,
    [email],
  );
  const account = userResult.rows[0];

  if (account) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await pool.query(
      `DELETE FROM password_reset_tokens
        WHERE user_id = $1 AND (used_at IS NULL OR expires_at <= now())`,
      [account.id],
    );
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [account.id, tokenHash, expiresAt],
    );

    const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    const resetUrl = new URL("/reset-password.html", baseUrl);
    resetUrl.searchParams.set("token", token);

    if (!mailConfigured && process.env.NODE_ENV !== "production") {
      // Local-only convenience: the link is printed in the server terminal, never returned by the API.
      console.info(`[local password reset] One-time link for ${account.email}: ${resetUrl.toString()}`);
    } else {
      try {
        await sendPasswordResetEmail({ to: account.email, resetUrl: resetUrl.toString() });
      } catch (error) {
        console.error("Password-reset email could not be sent:", error.message);
        await pool.query("DELETE FROM password_reset_tokens WHERE token_hash = $1", [tokenHash]);
      }
    }
  }

  // Same response whether or not the account exists, to prevent email enumeration.
  return response.json({ message: genericMessage });
});

router.post("/reset-password", resetLimiter, async (request, response) => {
  response.set("Cache-Control", "no-store");
  const token = typeof request.body.token === "string" ? request.body.token : "";
  const password = typeof request.body.password === "string" ? request.body.password : "";
  const passwordError = passwordPolicyError(password);

  if (!token || token.length > 256) {
    return response.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });
  }
  if (passwordError) {
    return response.status(400).json({ error: passwordError });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tokenResult = await client.query(
      `SELECT prt.id, prt.user_id
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
        WHERE prt.token_hash = $1
          AND prt.used_at IS NULL
          AND prt.expires_at > now()
          AND u.account_status = 'active'
        FOR UPDATE OF prt`,
      [hashToken(token)],
    );
    const resetRecord = tokenResult.rows[0];

    if (!resetRecord) {
      await client.query("ROLLBACK");
      return response.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });
    }

    const passwordHash = await hashPassword(password);
    await client.query(
      "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
      [passwordHash, resetRecord.user_id],
    );
    await client.query(
      "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
      [resetRecord.user_id],
    );

    // Invalidate all existing login sessions for this account after a password reset.
    const sessionTable = await client.query("SELECT to_regclass('public.session') AS table_name");
    if (sessionTable.rows[0]?.table_name) {
      await client.query(`DELETE FROM "session" WHERE sess->>'userId' = $1`, [resetRecord.user_id]);
    }

    await client.query("COMMIT");
    return response.json({ message: "Your password has been reset. Sign in with your new password." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/invitation", async (request, response) => {
  response.set("Cache-Control", "no-store");
  const token = typeof request.query.token === "string" ? request.query.token : "";
  if (!token) return response.status(400).json({ error: "Invitation link is invalid or expired." });

  const result = await pool.query(
    `SELECT email, name, role
       FROM account_invitations
      WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      LIMIT 1`,
    [hashToken(token)],
  );
  if (!result.rows[0]) return response.status(400).json({ error: "Invitation link is invalid or expired." });

  return response.json({ invitation: result.rows[0] });
});

router.post("/accept-invitation", async (request, response) => {
  response.set("Cache-Control", "no-store");
  const token = typeof request.body.token === "string" ? request.body.token : "";
  const password = typeof request.body.password === "string" ? request.body.password : "";
  const passwordError = passwordPolicyError(password);

  if (!token || passwordError) {
    return response.status(400).json({
      error: passwordError || "Use a valid invitation link.",
    });
  }

  const client = await pool.connect();
  let account;
  try {
    await client.query("BEGIN");
    const inviteResult = await client.query(
      `SELECT id, email, name, role
         FROM account_invitations
        WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [hashToken(token)],
    );
    const invitation = inviteResult.rows[0];
    if (!invitation) {
      await client.query("ROLLBACK");
      return response.status(400).json({ error: "Invitation link is invalid or expired." });
    }

    const passwordHash = await hashPassword(password);
    const userResult = await client.query(
      `INSERT INTO users (name, email, password_hash, role, account_status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, name, email, role`,
      [invitation.name, invitation.email, passwordHash, invitation.role],
    );
    account = userResult.rows[0];
    await client.query(
      "INSERT INTO notification_preferences (user_id) VALUES ($1)",
      [account.id],
    );
    await client.query(
      "UPDATE account_invitations SET accepted_at = now() WHERE id = $1",
      [invitation.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return response.status(409).json({ error: "An account already exists for this invitation." });
    }
    throw error;
  } finally {
    client.release();
  }

  await regenerateSession(request);
  request.session.userId = account.id;
  await saveSession(request);
  return response.status(201).json({ user: publicUser(account) });
});

router.get("/me", async (request, response) => {
  if (!request.session.userId) {
    return response.status(401).json({ error: "You are not signed in." });
  }

  const result = await pool.query(
    `SELECT id, name, email, role
       FROM users
      WHERE id = $1 AND account_status = 'active'
      LIMIT 1`,
    [request.session.userId],
  );
  const account = result.rows[0];

  if (!account) {
    await destroySession(request);
    response.clearCookie("diu_ie.sid", { path: "/" });
    return response.status(401).json({ error: "Your account is not active." });
  }

  return response.json({ user: publicUser(account) });
});

router.post("/logout", async (request, response) => {
  if (request.session) await destroySession(request);
  response.clearCookie("diu_ie.sid", { path: "/" });
  return response.json({ message: "Signed out." });
});

export default router;
