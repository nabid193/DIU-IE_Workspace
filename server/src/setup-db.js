import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pool } from "./db.js";

try {
  const schemaUrl = new URL("../db/schema.sql", import.meta.url);
  const schema = await readFile(schemaUrl, "utf8");
  await pool.query(schema);
  console.log("Database schema is ready.");
} catch (error) {
  console.error("Could not set up the database schema:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
