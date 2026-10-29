import { URL } from "node:url";
import process from "node:process";
import { readFileSync } from "node:fs";

// NODE_OPTIONS imports this before server, worker, migration and admin CLI modules.
export function loadContainerSecrets(env = process.env) {
  const read = (name) => {
    try {
      const value = readFileSync(env[name], "utf8").trim();
      if (!value) throw new Error();
      return value;
    } catch { throw new Error(`${name} must point to a nonempty secret readable by the container user`); }
  };
  for (const name of ["S3_ACCESS_KEY", "S3_SECRET_KEY", "GROQ_API_KEY", "LLM_API_KEY"]) {
    if (env[`${name}_FILE`]) env[name] = read(`${name}_FILE`);
  }
  if (env.DATABASE_PASSWORD_FILE) {
    let url;
    try { url = new URL(env.DATABASE_URL); }
    catch { throw new Error("DATABASE_URL must be a valid database URL"); }
    url.password = encodeURIComponent(read("DATABASE_PASSWORD_FILE"));
    env.DATABASE_URL = url.toString();
  }
}
loadContainerSecrets();
