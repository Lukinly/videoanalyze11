import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrateDatabase(pool: Pool, directory = migrationDirectory): Promise<void> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL)");
  const files = await readdir(directory);
  for (const file of files.filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
    const version = file.split("_", 1)[0];
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
    if (applied.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(join(directory, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [version, new Date()]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  migrateDatabase(pool)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
