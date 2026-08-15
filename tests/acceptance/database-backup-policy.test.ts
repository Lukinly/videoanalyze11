import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const backupUrl = new URL("../../scripts/backup-database.sh", import.meta.url);
const restoreUrl = new URL("../../scripts/restore-database.sh", import.meta.url);
const fixtures: string[] = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("database backup policy", () => {
  it("streams an ephemeral-free dump through age and uploads only ciphertext without logging secrets", () => {
    expect(existsSync(backupUrl)).toBe(true);
    const root = mkdtempSync(join(tmpdir(), "videoan-backup-")); fixtures.push(root);
    const bin = join(root, "bin");
    const log = join(root, "calls.log");
    spawnSync("mkdir", ["-p", bin]);
    executable(join(bin, "pg_dump"), `#!/bin/sh\nprintf 'plain-database'\nprintf 'pg_dump:%s\\n' "$*" >> "$CALL_LOG"\n`);
    executable(join(bin, "age"), `#!/bin/sh\nprintf 'age:%s\\n' "$*" >> "$CALL_LOG"\nprintf 'AGE-ENCRYPTED:'\ncat\n`);
    executable(join(bin, "mc"), `#!/bin/sh\nprintf 'mc:%s\\n' "$*" >> "$CALL_LOG"\n`);
    const result = spawnSync("bash", [backupUrl.pathname], { encoding: "utf8", env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, CALL_LOG: log,
      DATABASE_URL: "postgres://secret-db", BACKUP_AGE_RECIPIENT: "age1-secret-recipient",
      BACKUP_S3_ENDPOINT: "https://backup.example", BACKUP_S3_BUCKET: "offsite",
      BACKUP_S3_ACCESS_KEY: "secret-access", BACKUP_S3_SECRET_KEY: "secret-key"
    } });

    expect(result.status).toBe(0);
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("--exclude-table-data=public.ephemeral_*");
    expect(calls).toMatch(/mc:cp .*\.dump\.age offsite\/offsite\/database\/daily\//);
    expect(calls).not.toMatch(/mc:cp .*\.dump(?:\s|$)/);
    expect(`${result.stdout}${result.stderr}`).not.toContain("secret-key");
    expect(`${result.stdout}${result.stderr}`).not.toContain("secret-access");
  });

  it("restores behind maintenance mode, then migrates and runs retention before traffic", () => {
    const restore = readFileSync(restoreUrl, "utf8");
    expect(restore).toContain("pg_restore");
    expect(restore).toContain("dist/db/migrate.js");
    expect(restore).toContain("dist/retention/run-once.js");
    expect(restore.indexOf("pg_restore")).toBeLessThan(restore.indexOf("dist/db/migrate.js"));
    expect(restore.indexOf("dist/db/migrate.js")).toBeLessThan(restore.indexOf("dist/retention/run-once.js"));
  });

  it("ships a dedicated backup image and excludes local backup artifacts", () => {
    expect(readFileSync(new URL("../../infra/backup/Dockerfile", import.meta.url), "utf8")).toContain("postgresql-client");
    expect(readFileSync(new URL("../../.gitignore", import.meta.url), "utf8")).toContain("*.dump.age");
  });

  it("passes only backup-specific credentials into the backup container", () => {
    const compose = readFileSync(new URL("../../infra/docker-compose.yml", import.meta.url), "utf8");
    const backup = compose.match(/^ {2}backup:\n(?:(?!^ {2}[A-Za-z0-9._-]+:\s*$)[\s\S])*/m)?.[0] ?? "";
    expect(backup).not.toContain("env_file:");
    expect(backup).toContain("BACKUP_AGE_RECIPIENT: ${BACKUP_AGE_RECIPIENT}");
    expect(backup).toContain("BACKUP_S3_SECRET_KEY: ${BACKUP_S3_SECRET_KEY}");
  });
});

function executable(path: string, content: string) { writeFileSync(path, content); chmodSync(path, 0o755); }
