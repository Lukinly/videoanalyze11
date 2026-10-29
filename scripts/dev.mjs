/* global console, URL */
import { spawn } from "node:child_process";
import process from "node:process";
import { loadEnvFile } from "node:process";
try { loadEnvFile(".env"); } catch (error) { if (error.code !== "ENOENT") throw error; }
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = new Set();
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
};
const start = (args, cwd = root) => {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit", env: process.env });
  children.add(child);
  child.once("error", (error) => { console.error(error.message); stop(1); });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) stop(code || (signal ? 1 : 0));
  });
};
// Compile changes as well as restarting built server processes.
start(["node_modules/typescript/bin/tsc", "-b", "--watch", "--preserveWatchOutput"]);
start(["--env-file-if-exists=.env", "--watch", "apps/api/dist/server.js"]);
if (process.env.GROQ_API_KEY && (process.env.LLM_API_KEY || process.env.llm_api_key) && (process.env.LLM_API_BASE_URL || process.env.llm_api_base_url) && (process.env.LLM_API_MODEL || process.env.llm_api_model)) {
  start(["--env-file-if-exists=.env", "--watch", "apps/worker/dist/worker-main.js"]);
} else console.log("Web/API started. Configure Groq and LLM credentials in .env, then restart to enable analysis.");
start(["../../node_modules/vite/bin/vite.js"], `${root}apps/web`);
process.once("exit", () => { for (const child of children) child.kill("SIGTERM"); });
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
