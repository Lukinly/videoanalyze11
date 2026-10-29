import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("container secrets bootstrap", () => {
  it("loads file credentials before startup and encodes database password characters safely", () => {
    const directory = mkdtempSync(join(tmpdir(), "container-secrets-"));
    const script = new URL("../../scripts/load-container-secrets.mjs", import.meta.url).pathname;
    const password = join(directory, "password");
    writeFileSync(password, "test@password:#/?%\n");
    try {
      const result = spawnSync(process.execPath, ["--import", script, "--input-type=module", "-e", "const u=new URL(process.env.DATABASE_URL);console.log(JSON.stringify({password:decodeURIComponent(u.password),host:u.hostname,key:process.env.LLM_API_KEY}))"], {
        encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgres://app@postgres/db", DATABASE_PASSWORD_FILE: password, LLM_API_KEY_FILE: password }
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ password: "test@password:#/?%", host: "postgres", key: "test@password:#/?%" });
    } finally { rmSync(directory, { recursive: true }); }
  });
  it("does not overwrite existing production credentials on a repeated initialization", () => {
    const directory = mkdtempSync(join(tmpdir(), "initialize-secrets-"));
    const script = new URL("../../scripts/init-production-secrets.mjs", import.meta.url).pathname;
    writeFileSync(join(directory, "db_password"), "existing-test-password");
    try {
      const result = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(readFileSync(join(directory, "db_password"), "utf8")).toBe("existing-test-password");
      expect(readFileSync(join(directory, "s3_access_key"), "utf8")).toMatch(/^GK[0-9a-f]{32}\n$/);
      expect(result.stdout).not.toContain("existing-test-password");
    } finally { rmSync(directory, { recursive: true }); }
  });
});
