import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://openchat:openchat@localhost:5432/openchat";

const globalForDb = globalThis as unknown as {
  openchatPool?: pg.Pool;
};

export const pool = globalForDb.openchatPool ?? new pg.Pool({ connectionString });

if (process.env.NODE_ENV !== "production") {
  globalForDb.openchatPool = pool;
}

export const db = drizzle(pool, { schema });
