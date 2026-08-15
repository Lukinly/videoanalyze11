import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("credit billing deployment", () => {
  it("materializes workspace packages instead of leaving runtime symlinks", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "videoan-materialize-"));
    const deployRoot = join(fixtureRoot, "deploy");
    const sourceRoot = join(fixtureRoot, "domain");
    const targetRoot = join(deployRoot, "node_modules", "@videoanalyze", "domain");
    const scriptPath = new URL("../../scripts/materialize-workspace-package.mjs", import.meta.url);

    try {
      mkdirSync(join(sourceRoot, "dist"), { recursive: true });
      mkdirSync(join(sourceRoot, "node_modules", ".pnpm", "zod@3.0.0", "node_modules", "zod"), { recursive: true });
      mkdirSync(join(deployRoot, "node_modules", "@videoanalyze"), { recursive: true });
      writeFileSync(join(sourceRoot, "package.json"), '{"name":"@videoanalyze/domain","exports":{".":"./dist/index.js"}}');
      writeFileSync(join(sourceRoot, "dist", "index.js"), "export const materialized = true;\n");
      writeFileSync(join(sourceRoot, "node_modules", ".pnpm", "zod@3.0.0", "node_modules", "zod", "package.json"), '{"name":"zod"}');
      symlinkSync(".pnpm/zod@3.0.0/node_modules/zod", join(sourceRoot, "node_modules", "zod"));
      mkdirSync(join(sourceRoot, "node_modules", ".pnpm", "node_modules", "@videoanalyze"), { recursive: true });
      symlinkSync("/workspace/packages/domain", join(sourceRoot, "node_modules", ".pnpm", "node_modules", "@videoanalyze", "domain"));
      symlinkSync("/workspace/packages/domain", targetRoot);

      const moduleUrl = scriptPath.href;
      const materializer = await import(moduleUrl).catch(() => undefined);

      expect(materializer).toBeDefined();
      if (!materializer) return;
      await materializer.materializeWorkspacePackage(deployRoot, "@videoanalyze/domain", sourceRoot);
      expect(lstatSync(targetRoot).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(targetRoot, "package.json"), "utf8")).toContain('"name":"@videoanalyze/domain"');
      expect(readFileSync(join(targetRoot, "dist", "index.js"), "utf8")).toBe("export const materialized = true;\n");
      const transitiveDependency = join(targetRoot, "node_modules", "zod", "package.json");
      expect(existsSync(transitiveDependency)).toBe(true);
      expect(readlinkSync(join(targetRoot, "node_modules", "zod"))).toBe(".pnpm/zod@3.0.0/node_modules/zod");
      if (existsSync(transitiveDependency)) {
        expect(readFileSync(transitiveDependency, "utf8")).toBe('{"name":"zod"}');
      }
      expect(() => lstatSync(join(targetRoot, "node_modules", ".pnpm", "node_modules", "@videoanalyze", "domain"))).toThrow();
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("ships and runs the database migrations before api and worker", () => {
    const dockerfile = readFileSync(new URL("../../apps/api/Dockerfile", import.meta.url), "utf8");
    const compose = readFileSync(new URL("../../infra/docker-compose.yml", import.meta.url), "utf8");
    expect(dockerfile).toContain("COPY --from=build /workspace/apps/api/src/db/migrations ./dist/db/migrations");
    expect(compose).toContain("migrate:");
    expect(compose).toContain("dist/db/migrate.js");
    expect(compose).toContain("service_completed_successfully");
  });

  it("uses standalone production dependencies in api and worker runtime images", () => {
    const apiDockerfile = readFileSync(new URL("../../apps/api/Dockerfile", import.meta.url), "utf8");
    const workerDockerfile = readFileSync(new URL("../../apps/worker/Dockerfile", import.meta.url), "utf8");

    expect(apiDockerfile).toContain("pnpm --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/api deploy --prod /workspace/deploy");
    expect(workerDockerfile).toContain("pnpm --prefer-offline --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/worker deploy --prod /workspace/deploy");
    expect(apiDockerfile).not.toContain("COPY --from=build /workspace/node_modules ./node_modules");
    expect(workerDockerfile).not.toContain("COPY --from=build /workspace/node_modules ./node_modules");
  });

  it("installs the Groq ASR curl transport with existing worker runtime tools", () => {
    const workerDockerfile = readFileSync(new URL("../../apps/worker/Dockerfile", import.meta.url), "utf8");
    const runtimeStage = workerDockerfile.slice(workerDockerfile.indexOf("\nFROM node:24-bookworm-slim\n") + 1);

    expect(runtimeStage).toContain("apt-get install -y --no-install-recommends ffmpeg ca-certificates curl");
  });

  it("deploys the compiled workspace domain package", () => {
    const apiDockerfile = readFileSync(new URL("../../apps/api/Dockerfile", import.meta.url), "utf8");
    const workerDockerfile = readFileSync(new URL("../../apps/worker/Dockerfile", import.meta.url), "utf8");
    const domainPackage = readFileSync(new URL("../../packages/domain/package.json", import.meta.url), "utf8");

    expect(apiDockerfile).toContain("pnpm --config.inject-workspace-packages=true --filter @videoanalyze/domain build");
    expect(workerDockerfile).toContain("pnpm --config.inject-workspace-packages=true --filter @videoanalyze/domain build");
    expect(apiDockerfile).toContain("pnpm --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/api deploy --prod /workspace/deploy");
    expect(workerDockerfile).toContain("pnpm --prefer-offline --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/worker deploy --prod /workspace/deploy");
    expect(apiDockerfile).toContain("pnpm --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/domain deploy --prod /workspace/domain-deploy");
    expect(workerDockerfile).toContain("pnpm --prefer-offline --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/domain deploy --prod /workspace/domain-deploy");
    expect(apiDockerfile).toContain("node scripts/materialize-workspace-package.mjs /workspace/deploy @videoanalyze/domain /workspace/domain-deploy");
    expect(workerDockerfile).toContain("node scripts/materialize-workspace-package.mjs /workspace/deploy @videoanalyze/domain /workspace/domain-deploy");
    expect(domainPackage).toContain('"development": "./src/index.ts"');
    expect(domainPackage).toContain('"import": "./dist/index.js"');
  });

  it("uses the npm mirror only as fallback for worker image deployment", () => {
    const workerDockerfile = readFileSync(new URL("../../apps/worker/Dockerfile", import.meta.url), "utf8");
    const runtimeStage = workerDockerfile.slice(workerDockerfile.indexOf("\nFROM node:24-bookworm-slim\n") + 1);

    expect(workerDockerfile).toContain(
      "RUN corepack enable\nARG NPM_REGISTRY=https://registry.npmmirror.com\nRUN pnpm config set registry ${NPM_REGISTRY}",
    );
    expect(workerDockerfile).toContain(
      "RUN pnpm --prefer-offline --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/worker deploy --prod /workspace/deploy",
    );
    expect(workerDockerfile).toContain(
      "RUN pnpm --prefer-offline --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/domain deploy --prod /workspace/domain-deploy",
    );
    expect(workerDockerfile).not.toMatch(/^RUN pnpm --offline .* deploy --prod /m);
    expect(runtimeStage).not.toContain("NPM_REGISTRY");
    expect(runtimeStage).not.toContain("pnpm config set registry");
  });

  it("keeps the frozen lockfile aligned with injected workspace packages", () => {
    const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
    const lockfile = readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");

    expect(workspace).toContain("injectWorkspacePackages: true");
    expect(workspace).toContain("forceLegacyDeploy: true");
    expect(lockfile).toContain("injectWorkspacePackages: true");
  });

  it("wires public and storage hosts into the proxy and API", () => {
    const compose = readFileSync(new URL("../../infra/docker-compose.yml", import.meta.url), "utf8");
    const caddy = readFileSync(new URL("../../infra/reverse-proxy/Caddyfile", import.meta.url), "utf8");
    const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

    expect(compose).toContain("S3_PUBLIC_ENDPOINT: ${S3_PUBLIC_ENDPOINT:-https://storage.localhost}");
    expect(compose).toContain("MINIO_API_CORS_ALLOW_ORIGIN: ${MINIO_API_CORS_ALLOW_ORIGIN:-https://localhost,http://localhost}");
    expect(compose).toContain("PUBLIC_HOST: ${PUBLIC_HOST:-https://localhost}");
    expect(compose).toContain("STORAGE_HOST: ${STORAGE_HOST:-https://storage.localhost}");
    expect(caddy).toContain("https://storage.localhost");
    expect(caddy).toContain("reverse_proxy minio:9000");
    expect(caddy).toContain("header_up Host {http.request.host}");
    expect(envExample).toContain("PUBLIC_HOST=https://localhost");
    expect(envExample).toContain("STORAGE_HOST=https://storage.localhost");
    expect(envExample).toContain("S3_PUBLIC_ENDPOINT=https://storage.localhost");
    expect(envExample).toContain("MINIO_API_CORS_ALLOW_ORIGIN=https://localhost,http://localhost");
  });

  it("routes worker Groq traffic through the optional host proxy", () => {
    const workerDockerfile = readFileSync(new URL("../../apps/worker/Dockerfile", import.meta.url), "utf8");
    const compose = readFileSync(new URL("../../infra/docker-compose.yml", import.meta.url), "utf8");
    const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    const workerServiceMatch = compose.match(/^ {2}worker:\n(?:(?!^ {2}[A-Za-z0-9._-]+:\s*$)[\s\S])*/m);
    expect(workerServiceMatch).not.toBeNull();
    const workerService = workerServiceMatch?.[0] ?? "";
    const otherServices = workerServiceMatch ? compose.replace(workerServiceMatch[0], "") : compose;

    expect(workerDockerfile.match(/FROM node:24-bookworm-slim/g)).toHaveLength(2);
    expect(workerDockerfile).toContain("COPY apps/worker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh");
    expect(workerDockerfile).toContain("RUN chmod +x /usr/local/bin/docker-entrypoint.sh");
    expect(workerDockerfile).toContain('ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]');
    expect(workerService).toContain("env_file:\n      - ../.env");
    expect(workerService).toContain('NODE_USE_ENV_PROXY: "1"');
    expect(workerService).not.toMatch(/^ {6}HTTP_PROXY:/m);
    expect(workerService).not.toMatch(/^ {6}HTTPS_PROXY:/m);
    expect(workerService).not.toMatch(/^ {6}NO_PROXY:/m);
    expect(workerService).toContain('"host.docker.internal:host-gateway"');
    expect(otherServices).not.toContain('NODE_USE_ENV_PROXY: "1"');
    expect(otherServices).not.toContain('"host.docker.internal:host-gateway"');
    expect(envExample).toContain("WORKER_HTTP_PROXY=");
    expect(envExample).toContain("WORKER_HTTPS_PROXY=");
    expect(envExample).toContain("WORKER_NO_PROXY=postgres,redis,minio,localhost,127.0.0.1");
  });

  it("maps worker proxy variables before starting the worker command", () => {
    const entrypoint = new URL("../../apps/worker/docker-entrypoint.sh", import.meta.url);
    const result = spawnSync(
      "sh",
      [entrypoint.pathname, "/bin/sh", "-c", 'printf "%s\\n" "$HTTP_PROXY" "$HTTPS_PROXY" "$NO_PROXY"'],
      {
        encoding: "utf8",
        env: {
          WORKER_HTTP_PROXY: "http://proxy.test:8080",
          WORKER_HTTPS_PROXY: "http://secure-proxy.test:8443",
          WORKER_NO_PROXY: "internal.test,127.0.0.1",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "http://proxy.test:8080\nhttp://secure-proxy.test:8443\ninternal.test,127.0.0.1\n",
    );
  });

  it("unsets standard proxy variables when worker proxy variables are empty or absent", () => {
    const entrypoint = new URL("../../apps/worker/docker-entrypoint.sh", import.meta.url);
    const result = spawnSync(
      "sh",
      [entrypoint.pathname, "/bin/sh", "-c", 'printf "%s\\n" "${HTTP_PROXY+set}" "${HTTPS_PROXY+set}" "$NO_PROXY"'],
      {
        encoding: "utf8",
        env: {
          HTTP_PROXY: "http://stale-http.test:8080",
          HTTPS_PROXY: "http://stale-https.test:8443",
          WORKER_HTTP_PROXY: "",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("\n\npostgres,redis,minio,localhost,127.0.0.1\n");
  });

  it("configures trusted local HTTPS without using the local CA in production", () => {
    const compose = readFileSync(new URL("../../infra/docker-compose.yml", import.meta.url), "utf8");
    const localCaddy = readFileSync(new URL("../../infra/reverse-proxy/Caddyfile", import.meta.url), "utf8");
    const productionCaddyPath = new URL("../../infra/reverse-proxy/Caddyfile.production", import.meta.url);
    const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

    expect(compose).toContain("./reverse-proxy/${CADDYFILE:-Caddyfile}:/etc/caddy/Caddyfile:ro");
    expect(envExample).toContain("CADDYFILE=Caddyfile");
    expect(envExample).toContain("PUBLIC_HOST=https://localhost");
    expect(envExample).toContain("STORAGE_HOST=https://storage.localhost");
    expect(envExample).toContain("S3_PUBLIC_ENDPOINT=https://storage.localhost");
    expect(localCaddy).toContain("https://localhost");
    expect(localCaddy).toContain("https://storage.localhost");
    expect(localCaddy.match(/tls internal/g)?.length).toBe(2);
    expect(existsSync(productionCaddyPath)).toBe(true);

    if (existsSync(productionCaddyPath)) {
      const productionCaddy = readFileSync(productionCaddyPath, "utf8");
      expect(productionCaddy).toContain("{$PUBLIC_HOST}");
      expect(productionCaddy).toContain("{$STORAGE_HOST}");
      expect(productionCaddy).not.toContain("tls internal");
    }
  });
});
