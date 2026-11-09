import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import authRouter from "./auth.js";
import adminRouter from "./admin.js";
import workspaceRouter from "./workspace.js";

const app = express();
// Vercel terminates HTTPS at its proxy; trust that proxy so secure session cookies work.
app.set("trust proxy", 1);
const publicRoot = fileURLToPath(new URL("../../public/", import.meta.url));
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
  throw new Error("SESSION_SECRET is missing or too short. Add a random secret of at least 32 bytes to .env.");
}

const PgSessionStore = connectPgSimple(session);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(session({
  name: "diu_ie.sid",
  store: new PgSessionStore({ pool, createTableIfMissing: true }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

app.get("/api/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.use("/api", workspaceRouter);

app.get("/dashboard.html", async (request, response, next) => {
  try {
    if (!request.session.userId) return response.redirect("/");
    const account = await pool.query(
      "SELECT 1 FROM users WHERE id = $1 AND account_status = 'active' LIMIT 1",
      [request.session.userId],
    );
    if (account.rowCount === 0) return response.redirect("/");
    return response.sendFile(fileURLToPath(new URL("../../public/dashboard.html", import.meta.url)));
  } catch (error) {
    return next(error);
  }
});

// Keep server source and SQL files out of the public static file path.
app.use("/server", (_request, response) => response.sendStatus(404));
app.use(express.static(publicRoot, { dotfiles: "deny", index: "index.html" }));

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API route not found" });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});

export default app;
