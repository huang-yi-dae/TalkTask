import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Only meaningful locally — on Vercel the env vars are already injected.
config({ path: ".env" });

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/myapp";

/**
 * Serverless-safe Postgres client.
 *
 * Each Vercel function instance is its own process, so a default postgres.js
 * pool (10 sockets) multiplied by every warm instance will exhaust Neon's
 * free-tier connection budget almost immediately. Three adjustments:
 *
 *   max: 1          — one socket per instance; Neon's own pooler does the
 *                     real pooling on the other side of the wire.
 *   idle_timeout    — hand the socket back quickly once a request is done.
 *   prepare: false  — required when talking to a PgBouncer-style pooler in
 *                     transaction mode (the `-pooler` Neon host); named
 *                     prepared statements don't survive across transactions.
 *
 * The globalThis cache keeps `next dev` HMR from leaking a new pool on every
 * file save.
 */
const globalForDb = globalThis as unknown as {
  __autotaskSql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__autotaskSql ??
  postgres(connectionString, {
    max: 1,
    idle_timeout: 300,        // 覆盖 analyze 路由最长 300s 的 AI Pipeline
    connect_timeout: 15,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__autotaskSql = client;
}

export const db = drizzle(client);
