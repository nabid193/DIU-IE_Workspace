import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pool } from "./db.js";
import { hashPassword, passwordPolicyError } from "./passwords.js";

async function ask(question) {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

async function askHidden(question) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this command directly in Terminal so the password can be hidden.");
  }

  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let password = "";

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
    }

    function onData(buffer) {
      const input = buffer.toString("utf8");

      if (input === "\u0003") {
        cleanup();
        reject(new Error("Cancelled."));
        return;
      }

      if (input === "\r" || input === "\n") {
        cleanup();
        resolve(password);
        return;
      }

      if (input === "\u007f" || input === "\b") {
        password = password.slice(0, -1);
        return;
      }

      if (input >= " ") password += input;
    }

    stdin.on("data", onData);
  });
}

function isValidEmail(email) {
  return typeof email === "string"
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

async function main() {
  const existingAdmin = await pool.query(
    "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1",
  );
  if (existingAdmin.rowCount > 0) {
    throw new Error("An Admin account already exists. Use the invitation flow to add another account.");
  }

  const name = (await ask("Admin full name: ")).trim();
  const email = (await ask("Email address (a @diu.edu.bd address is recommended): "))
    .trim()
    .toLowerCase();

  if (!name) throw new Error("Name cannot be empty.");
  if (!isValidEmail(email)) throw new Error("Enter a valid email address.");

  const password = await askHidden(
    "Create a password (8+ characters, uppercase, lowercase, number and symbol): ",
  );
  const passwordError = passwordPolicyError(password);
  if (passwordError) throw new Error(passwordError);

  const confirmation = await askHidden("Re-enter your password to confirm: ");
  if (password !== confirmation) {
    throw new Error("Passwords do not match. No Admin account was created. Run the command again.");
  }

  const duplicate = await pool.query(
    "SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1",
    [email],
  );
  if (duplicate.rowCount > 0) {
    throw new Error("An account with this email already exists.");
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO users (name, email, password_hash, role, account_status)
       VALUES ($1, $2, $3, 'admin', 'active')
       RETURNING id`,
      [name, email, passwordHash],
    );

    await client.query(
      "INSERT INTO notification_preferences (user_id) VALUES ($1)",
      [result.rows[0].id],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.log(`Created the first Admin account for ${email}.`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
