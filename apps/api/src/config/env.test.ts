import { describe, expect, it } from "vitest";

describe("application configuration", () => {
  it("rejects production startup without a public storage endpoint", async () => {
    const { parseEnv } = await import("./env.js");
    expect(() => parseEnv({ NODE_ENV: "production", GROQ_API_KEY: "" })).toThrow("S3_PUBLIC_ENDPOINT is required in production");
  });

  it("reads only named configuration values and applies safe operational defaults", async () => {
    const { parseEnv } = await import("./env.js");
    expect(parseEnv({ NODE_ENV: "development", GROQ_API_KEY: "test-key", DATABASE_URL: "postgres://db", MAX_UPLOAD_BYTES: "123" })).toMatchObject({
      nodeEnv: "development",
      databaseUrl: "postgres://db",
      maxUploadBytes: 123,
      maxVideoDurationSeconds: 14_400,
      transientCapacityBytes: 40_000_000_000,
      maxQueuedRunsPerUser: 2,
      maxTotalQueuedRuns: 20,
      maxQueueWaitSeconds: 3_600,
      originalRetentionDays: 7,
      resultRetentionDays: 30
    });
  });

  it("keeps a browser-facing object storage endpoint separate from the internal endpoint", async () => {
    const { parseEnv } = await import("./env.js");
    expect(parseEnv({
      NODE_ENV: "development",
      GROQ_API_KEY: "test-key",
      S3_ENDPOINT: "http://minio:9000",
      S3_PUBLIC_ENDPOINT: "http://localhost:9000"
    }).s3PublicEndpoint).toBe("http://localhost:9000");
  });

  it("requires an explicit browser-facing endpoint in production", async () => {
    const { parseEnv } = await import("./env.js");

    expect(() => parseEnv({
      NODE_ENV: "production",
      GROQ_API_KEY: "test-key"
    })).toThrow("S3_PUBLIC_ENDPOINT is required in production");
  });

  it("rejects a public endpoint with a path prefix", async () => {
    const { parseEnv } = await import("./env.js");

    expect(() => parseEnv({
      NODE_ENV: "development",
      GROQ_API_KEY: "test-key",
      S3_PUBLIC_ENDPOINT: "http://storage.localhost/storage"
    })).toThrow("S3_PUBLIC_ENDPOINT must not contain a path");
  });
});


describe("production configuration safety", () => {
  const source = { NODE_ENV: "production", DATABASE_URL: "postgres://app:test-password@postgres/app", REDIS_URL: "redis://redis:6379", S3_ENDPOINT: "http://storage:3900", S3_ACCESS_KEY: "test-storage-key", S3_SECRET_KEY: "test-storage-secret", S3_PUBLIC_ENDPOINT: "https://media.example.com", VERIFICATION_BASE_URL: "https://app.example.com", SMTP_USER: "sender@163.com", SMTP_PASSWORD: "test-only" };
  it("starts without giving the API worker-only AI credentials", async () => {
    const { parseEnv } = await import("./env.js");
    expect(parseEnv(source).mail.transport).toBe("smtp");
  });
  it("rejects missing secrets, Mailpit and insecure callback origins", async () => {
    const { parseEnv } = await import("./env.js");
    expect(() => parseEnv({ ...source, S3_SECRET_KEY: undefined })).toThrow("S3_SECRET_KEY is required");
    expect(() => parseEnv({ ...source, DATABASE_URL: "postgres://app@postgres/app" })).toThrow("explicit database and storage credentials");
    expect(() => parseEnv({ ...source, MAIL_TRANSPORT: "mailpit" })).toThrow("production requires SMTP");
    for (const value of ["http://app.example.com", "https://localhost", "https://app.example.com/path"]) expect(() => parseEnv({ ...source, VERIFICATION_BASE_URL: value })).toThrow("HTTPS origin");
  });
});
