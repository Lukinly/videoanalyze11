/* global console, URL, setTimeout */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { Pool } from "pg";
import { connect } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import S3rver from "s3rver";

const root = fileURLToPath(new URL("../", import.meta.url));
const local = join(root, ".local");
const pgBin = process.env.POSTGRES_BIN_DIR ?? (process.platform === "darwin" ? "/opt/homebrew/opt/postgresql@16/bin" : "/usr/lib/postgresql/16/bin");
const children = new Set();
let storage;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  if (storage) await storage.close();
}
function start(command, args, log) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: log ? ["ignore", log, log] : "inherit" });
  if (log !== undefined) closeSync(log);
  children.add(child);
  child.once("error", (error) => { console.error(error.message); void stop(1); });
  child.once("exit", (code) => { children.delete(child); if (!stopping) void stop(code || 1); });
  return child;
}
const portOpen = (port) => new Promise((resolve) => {
  const socket = connect({ host: "127.0.0.1", port });
  socket.setTimeout(500);
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
  socket.once("timeout", () => { socket.destroy(); resolve(false); });
});
async function waitFor(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stopping) throw new Error("a local service stopped; inspect .local/*.log");
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`service on port ${port} did not start; inspect .local/*.log`);
}
process.once("exit", () => { for (const child of children) child.kill("SIGTERM"); });
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
try {
  if (process.env.NODE_ENV === "production") throw new Error("local:dev requires NODE_ENV=development; use the Docker stack for production");
  const platformBin = join(local, "platform-tools", "bin");
  try { await access(platformBin); process.env.PATH = `${platformBin}:${process.env.PATH}`; } catch { /* Platform import tools are optional for uploads. */ }
  const defaults = {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://videoanalyze:videoanalyze@127.0.0.1:5433/videoanalyze",
    REDIS_URL: "redis://127.0.0.1:6379",
    S3_ENDPOINT: "http://127.0.0.1:9000", S3_PUBLIC_ENDPOINT: "http://127.0.0.1:9000",
    S3_BUCKET: "videoanalyze", S3_ACCESS_KEY: "S3RVER", S3_SECRET_KEY: "S3RVER",
    MAIL_API_URL: "http://127.0.0.1:8025/api/v1/send", VERIFICATION_BASE_URL: "http://localhost:5173"
  };
  for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;
  for (const [key, expected] of Object.entries(defaults)) {
    if (["DATABASE_URL", "REDIS_URL", "S3_ENDPOINT", "S3_PUBLIC_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "MAIL_API_URL"].includes(key) && process.env[key] !== expected) {
      throw new Error(`${key} does not match local:dev; use the local environment example or pnpm dev with your own services`);
    }
  }
  for (const binary of [join(pgBin, "initdb"), join(pgBin, "postgres"), "redis-server", "mailpit"]) {
    const result = spawnSync(binary, [binary === "mailpit" ? "--help" : "--version"], { stdio: "ignore" });
    if (result.error || result.status !== 0) throw new Error(`Missing ${binary}. Install PostgreSQL 16, Redis, and Mailpit; set POSTGRES_BIN_DIR if needed.`);
  }
  for (const port of [5433, 6379, 9000, 8025, 1025, 3000, 5173]) {
    if (await portOpen(port)) throw new Error(`port ${port} is already in use; stop the existing service before local:dev`);
  }
  await mkdir(local, { recursive: true });
  const data = join(local, "postgres");
  try { await access(join(data, "PG_VERSION")); }
  catch {
    const result = spawnSync(join(pgBin, "initdb"), ["-D", data, "-U", "videoanalyze", "-A", "trust", "--locale=C", "-E", "UTF8"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("PostgreSQL initialization failed");
  }
  start(join(pgBin, "postgres"), ["-D", data, "-h", "127.0.0.1", "-p", "5433", "-k", local], openSync(join(local, "postgres.log"), "a"));
  await mkdir(join(local, "redis"), { recursive: true });
  start("redis-server", ["--bind", "127.0.0.1", "--port", "6379", "--appendonly", "yes", "--dir", join(local, "redis")], openSync(join(local, "redis.log"), "a"));
  start("mailpit", ["--listen", "127.0.0.1:8025", "--smtp", "127.0.0.1:1025", "--database", join(local, "mailpit.db")], openSync(join(local, "mailpit.log"), "a"));
  await mkdir(join(local, "objects"), { recursive: true });
  storage = new S3rver({ address: "127.0.0.1", port: 9000, silent: true, directory: join(local, "objects"), configureBuckets: [{
    name: process.env.S3_BUCKET,
    configs: [`<CORSConfiguration><CORSRule><AllowedOrigin>http://localhost:5173</AllowedOrigin><AllowedOrigin>http://127.0.0.1:5173</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>`]
  }] });
  await storage.run();
  await waitFor(5433);
  for (let attempt = 0; ; attempt++) {
    const ready = spawnSync(join(pgBin, "pg_isready"), ["-h", "127.0.0.1", "-p", "5433", "-U", "videoanalyze"], { stdio: "ignore" });
    if (ready.status === 0) break;
    if (attempt >= 100 || stopping) throw new Error("PostgreSQL did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await waitFor(6379);
  await waitFor(8025);
  const admin = new Pool({ connectionString: "postgres://videoanalyze@127.0.0.1:5433/postgres" });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'videoanalyze'");
    if (!existing.rowCount) await admin.query("CREATE DATABASE videoanalyze");
  } finally { await admin.end(); }
  // Build before migration, then start the shared development supervisor.
  for (const args of [["pnpm", "build"], ["pnpm", "db:migrate"]]) {
    const result = spawnSync("corepack", args, { cwd: root, env: process.env, stdio: "inherit" });
    if (result.status !== 0) throw new Error("local build or database migration failed");
  }
  console.log("Local services ready. Web: http://localhost:5173 | Mail: http://localhost:8025");
  start(process.execPath, ["scripts/dev.mjs"]);
} catch (error) {
  console.error(error.message);
  await stop(1);
}
