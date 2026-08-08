import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { createRepositories } from "./repositories/index.js";

type RegistrationCodeRepository = {
  createRegistrationCode(input: { email: string; codeHash: string; expiresAt: Date; createdAt: Date }): Promise<void>;
  findRegistrationCode(email: string): Promise<{
    id: string;
    email: string;
    codeHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    attempts: number;
    createdAt: Date;
  } | null>;
  incrementRegistrationAttempts(id: string, now: Date): Promise<number>;
  markRegistrationCodeUsed(id: string, usedAt: Date): Promise<boolean>;
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
    await registrationCodes.createRegistrationCode({
      email: "user@example.com",
      codeHash: "old-hash",
      expiresAt: new Date("2026-08-04T00:10:00Z"),
      createdAt: new Date("2026-08-04T00:00:00Z")
    });
    await registrationCodes.createRegistrationCode({
      email: "user@example.com",
      codeHash: "new-hash",
      expiresAt: new Date("2026-08-04T00:20:00Z"),
      createdAt: new Date("2026-08-04T00:01:00Z")
    });

    await expect(registrationCodes.findRegistrationCode("user@example.com"))
      .resolves.toMatchObject({ codeHash: "new-hash", attempts: 0, usedAt: null });
  });

  it("increments attempts and consumes a code only once", async () => {
    await registrationCodes.createRegistrationCode({
      email: "user@example.com",
      codeHash: "hash",
      expiresAt: new Date("2026-08-04T00:10:00Z"),
      createdAt: new Date("2026-08-04T00:00:00Z")
    });
    const record = await registrationCodes.findRegistrationCode("user@example.com");
    expect(record).not.toBeNull();
    await expect(registrationCodes.incrementRegistrationAttempts(record!.id, new Date("2026-08-04T00:01:00Z"))).resolves.toBe(1);
    await expect(registrationCodes.markRegistrationCodeUsed(record!.id, new Date("2026-08-04T00:02:00Z"))).resolves.toBe(true);
    await expect(registrationCodes.markRegistrationCodeUsed(record!.id, new Date("2026-08-04T00:03:00Z"))).resolves.toBe(false);
  });
});
