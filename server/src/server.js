import "dotenv/config";
import app from "./app.js";
import { pool } from "./db.js";

const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
  console.log(`DIU I&E workspace is running at http://localhost:${port}`);
});

async function shutDown(signal) {
  console.log(`${signal} received. Closing server connections...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutDown("SIGINT"));
process.on("SIGTERM", () => shutDown("SIGTERM"));
