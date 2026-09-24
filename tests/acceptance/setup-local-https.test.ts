import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("stages a WSL certificate on Windows before importing it", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "videoanalyze-local-https-"));
    const fakeBin = join(fixtureRoot, "bin");
    const scriptPath = fileURLToPath(new URL("../../scripts/setup-local-https.sh", import.meta.url));
    mkdirSync(fakeBin);

    const executable = (name: string, body: string) => {
      const path = join(fakeBin, name);
      writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
      chmodSync(path, 0o755);
    };

    executable("sudo", `
if [[ "\${1:-}" == "docker" ]]; then exec "$@"; fi
exit 0`);
    executable("docker", `
if [[ " $* " == *" exec -T proxy cat "* ]]; then
  printf '%s\\n' '-----BEGIN CERTIFICATE-----' 'test-certificate' '-----END CERTIFICATE-----'
fi`);
    executable("update-ca-certificates", "exit 0");
    executable("wslpath", "printf '%s\\n' '\\\\wsl.localhost\\Ubuntu-24.04\\tmp\\videoanalyze-local-root.crt'");
    executable("powershell.exe", `
command="\${*: -1}"
if [[ " $* " == *" -NonInteractive "* ]]; then
  echo 'Import-Certificate cannot run in non-interactive PowerShell' >&2
  exit 8
fi
if [[ "$command" != *"Copy-Item"* || "$command" != *"GetTempPath"* ]]; then
  echo 'Import-Certificate rejected a WSL UNC path' >&2
  exit 7
fi`);
    writeFileSync(join(fixtureRoot, ".env"), "TEST=true\n");

    try {
      const result = spawnSync("bash", [scriptPath], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          COMPOSE_ENV_FILE: join(fixtureRoot, ".env"),
          LOCAL_HTTPS_CERT_FILE: join(fixtureRoot, "exported.crt")
        }
      });

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
