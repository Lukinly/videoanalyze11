/* global console */
import { spawn } from "node:child_process";
import process from "node:process";
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set TEST_DATABASE_URL or DATABASE_URL before running PostgreSQL integration tests.");
  process.exitCode = 1;
} else {
  const child = spawn("corepack", ["pnpm", "exec", "vitest", "run", "tests/integration"], {
    stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: databaseUrl }
  });
  child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
}
