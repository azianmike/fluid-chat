import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://fluidchat:fluidchat@localhost:5432/fluidchat";

const globalForDb = globalThis as unknown as {
  fluidchatPool?: pg.Pool;
};

export const pool = globalForDb.fluidchatPool ?? new pg.Pool({ connectionString });

if (process.env.NODE_ENV !== "production") {
  globalForDb.fluidchatPool = pool;
}

export const db = drizzle(pool, { schema });
