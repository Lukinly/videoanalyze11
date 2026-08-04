import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type AppDatabase = NodePgDatabase<typeof schema>;

export function createDatabase(url = process.env.DATABASE_URL ?? "postgres://videoanalyze:videoanalyze@127.0.0.1:5433/videoanalyze") {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { pool, db: drizzle(pool, { schema }) } satisfies { pool: Pool; db: AppDatabase };
}
