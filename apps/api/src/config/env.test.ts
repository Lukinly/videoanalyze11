import { describe, expect, it } from "vitest";

describe("application configuration", () => {
  it("rejects production startup without the server Groq key", async () => {
    const { parseEnv } = await import("./env.js");
    expect(() => parseEnv({ NODE_ENV: "production", GROQ_API_KEY: "" })).toThrow("GROQ_API_KEY is required");
  });

  it("reads only named configuration values and applies safe operational defaults", async () => {
    const { parseEnv } = await import("./env.js");
    expect(parseEnv({ NODE_ENV: "development", GROQ_API_KEY: "test-key", DATABASE_URL: "postgres://db", MAX_UPLOAD_BYTES: "123" })).toMatchObject({
      nodeEnv: "development",
      groqApiKey: "test-key",
      databaseUrl: "postgres://db",
      maxUploadBytes: 123,
      maxVideoDurationSeconds: 14_400,
      transientCapacityBytes: 40_000_000_000,
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
