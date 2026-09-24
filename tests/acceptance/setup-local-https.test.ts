import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("setup-local-https.sh", () => {
  it("recreates the worker together with the HTTPS services", () => {
    const scriptPath = fileURLToPath(new URL("../../scripts/setup-local-https.sh", import.meta.url));
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("api minio proxy worker");
  });

  it("reports a missing Caddy root certificate during validation", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "videoanalyze-local-https-"));
    const scriptPath = fileURLToPath(new URL("../../scripts/setup-local-https.sh", import.meta.url));

    try {
      const result = spawnSync("bash", [scriptPath, "--validate"], {
        encoding: "utf8",
        env: { ...process.env, LOCAL_HTTPS_CERT_FILE: join(fixtureRoot, "missing.crt") }
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("Caddy root certificate");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
