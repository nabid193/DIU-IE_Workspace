import pg from "pg";

const { Pool } = pg;

// A single pool reuses a small set of PostgreSQL connections across requests.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (error) => {
  console.error("Unexpected error from an idle PostgreSQL client", error);
});
