import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { createRepositories } from "./repositories/index.js";

type RegistrationCodeRepository = {
  createRegistrationCode(input: { email: string; codeHash: string; expiresAt: Date; createdAt: Date; rateLimitBefore: Date }): Promise<boolean>;
  findRegistrationCode(email: string): Promise<{
    id: string;
    email: string;
    codeHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    attempts: number;
    createdAt: Date;
  } | null>;
  incrementRegistrationAttempts(id: string, codeHash: string, now: Date): Promise<number>;
  markRegistrationCodeUsed(id: string, codeHash: string, usedAt: Date): Promise<boolean>;
};

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("registration verification repository", () => {
  const repositories = createRepositories(pool);
  const registrationCodes = repositories.auth as unknown as RegistrationCodeRepository;

  beforeAll(async () => {
    const { migrateTestDatabase } = await import("./test-database.js");
    await migrateTestDatabase(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM registration_verifications");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("replaces the previous code for the same normalized email", async () => {
    await expect(registrationCodes.createRegistrationCode({
      email: "user@example.com",
      codeHash: "old-hash",
      expiresAt: new Date("2026-08-04T00:10:00Z"),
      createdAt: new Date("2026-08-04T00:00:00Z"),
      rateLimitBefore: new Date("2026-08-03T23:59:00Z")
    })).resolves.toBe(true);
    await expect(registrationCodes.createRegistrationCode({
      email: "user@example.com",
      codeHash: "new-hash",
      expiresAt: new Date("2026-08-04T00:20:00Z"),
      createdAt: new Date("2026-08-04T00:01:00Z"),
      rateLimitBefore: new Date("2026-08-03T23:59:00Z")
    })).resolves.toBe(false);

    await expect(registrationCodes.findRegistrationCode("user@example.com"))
      .resolves.toMatchObject({ codeHash: "old-hash", attempts: 0, usedAt: null });
  });

  it("keeps the old record from consuming a replacement code", async () => {
    await registrationCodes.createRegistrationCode({
      email: "user@example.com",
      codeHash: "hash",
      expiresAt: new Date("2026-08-04T00:10:00Z"),
      createdAt: new Date("2026-08-04T00:00:00Z"),
      rateLimitBefore: new Date("2026-08-03T23:59:00Z")
    });
    const oldRecord = await registrationCodes.findRegistrationCode("user@example.com");
    expect(oldRecord).not.toBeNull();
    await expect(registrationCodes.createRegistrationCode({
      email: "user@example.com",
      codeHash: "new-hash",
      expiresAt: new Date("2026-08-04T00:20:00Z"),
      createdAt: new Date("2026-08-04T00:01:00Z"),
      rateLimitBefore: new Date("2026-08-04T00:00:00Z")
    })).resolves.toBe(true);
    const newRecord = await registrationCodes.findRegistrationCode("user@example.com");
    expect(newRecord?.id).not.toBe(oldRecord?.id);
    await repositories.auth.invalidateRegistrationCode({ email: "user@example.com", codeHash: oldRecord!.codeHash, createdAt: oldRecord!.createdAt });
    expect((await registrationCodes.findRegistrationCode("user@example.com"))?.expiresAt).toEqual(newRecord?.expiresAt);
    await expect(registrationCodes.markRegistrationCodeUsed(oldRecord!.id, oldRecord!.codeHash, new Date("2026-08-04T00:02:00Z"))).resolves.toBe(false);
    await expect(registrationCodes.markRegistrationCodeUsed(newRecord!.id, newRecord!.codeHash, new Date("2026-08-04T00:03:00Z"))).resolves.toBe(true);
  });
});
