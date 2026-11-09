import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";

const router = express.Router();
const allowedRoles = new Set(["admin", "head", "member"]);

function isValidEmail(email) {
  return typeof email === "string"
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

router.use(requireAuth, requireRole("admin"));

router.get("/users", async (_request, response) => {
  const result = await pool.query(
    `SELECT id, name, email, role, account_status, created_at
       FROM users
      ORDER BY name, email`,
  );
  return response.json({ users: result.rows });
});

router.post("/invitations", async (request, response) => {
  const name = typeof request.body.name === "string" ? request.body.name.trim() : "";
  const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const role = typeof request.body.role === "string" ? request.body.role.toLowerCase() : "";

  if (!name || name.length > 120 || !isValidEmail(email) || !allowedRoles.has(role)) {
    return response.status(400).json({ error: "Enter a name, valid email address, and allowed role. A @diu.edu.bd address is recommended." });
  }

  const existingUser = await pool.query("SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1", [email]);
  if (existingUser.rowCount > 0) {
    return response.status(409).json({ error: "An account already exists for this email." });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await pool.query(
    `UPDATE account_invitations
        SET revoked_at = now()
      WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [email],
  );
  await pool.query(
    `INSERT INTO account_invitations (email, name, role, token_hash, invited_by_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [email, name, role, tokenHash, request.user.id, expiresAt],
  );

  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const inviteUrl = new URL("/accept-invitation.html", baseUrl);
  inviteUrl.searchParams.set("token", token);

  response.set("Cache-Control", "no-store");
  return response.status(201).json({
    invitation: { name, email, role, expiresAt: expiresAt.toISOString() },
    inviteUrl: inviteUrl.toString(),
  });
});

export default router;
