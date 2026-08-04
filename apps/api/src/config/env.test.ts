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
      originalRetentionDays: 7,
      resultRetentionDays: 30
    });
  });
});
