/* global console */
import process from "node:process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? ".local/production-secrets");
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
for (const [name, value] of Object.entries({
  storage_rpc_secret: randomBytes(32).toString("hex"),
  db_password: randomBytes(32).toString("hex"),
  s3_access_key: `GK${randomBytes(16).toString("hex")}`,
  s3_secret_key: randomBytes(32).toString("hex"),
  smtp_password: "", groq_api_key: "", llm_api_key: ""
})) {
  try { await writeFile(resolve(directory, name), value ? `${value}\n` : "", { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}
console.log("Secret files prepared without overwriting existing files. Fill smtp_password, groq_api_key and llm_api_key with an editor. Values are never printed.");
console.log("Linux: API and worker run as UID 1000. Give this UID read access to the secret files before starting Compose; do not make files world-readable.");
