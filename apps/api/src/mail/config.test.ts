import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMailConfig } from "./config.js";

const smtp = { MAIL_TRANSPORT: "smtp", SMTP_USER: "sender@163.com", SMTP_PASSWORD: "test-authorization", MAIL_FROM_ADDRESS: "sender@163.com" };
describe("mail configuration", () => {
  it("keeps Mailpit in development and requires SMTP in production", () => {
    expect(parseMailConfig({}).transport).toBe("mailpit");
    expect(() => parseMailConfig({ NODE_ENV: "production", MAIL_TRANSPORT: "mailpit" })).toThrow("production requires SMTP");
    expect(parseMailConfig({ ...smtp, NODE_ENV: "production" }).smtp).toMatchObject({ host: "smtp.163.com", port: 465, secure: true });
  });
  it("reads an authorization code from a file and rejects ambiguous or unreadable credentials", () => {
    const directory = mkdtempSync(join(tmpdir(), "smtp-config-"));
    try {
      const file = join(directory, "password");
      writeFileSync(file, "file-password\n");
      expect(parseMailConfig({ ...smtp, SMTP_PASSWORD: undefined, SMTP_PASSWORD_FILE: file }).smtp.password).toBe("file-password");
      expect(() => parseMailConfig({ ...smtp, SMTP_PASSWORD_FILE: file })).toThrow("only one");
      expect(() => parseMailConfig({ ...smtp, SMTP_PASSWORD: undefined, SMTP_PASSWORD_FILE: join(directory, "missing") })).toThrow("readable");
    } finally { rmSync(directory, { recursive: true }); }
  });
  it.each([{ SMTP_SECURE: "false" }, { SMTP_PORT: "587" }, { MAIL_FROM_ADDRESS: "spoof@example.com" }, { SMTP_USER: "sender@example.com" }])("enforces personal 163 TLS and sender settings: %j", (override) => {
    expect(() => parseMailConfig({ ...smtp, ...override })).toThrow("personal 163");
  });
  it("parses false as false and permits enforced STARTTLS for another provider", () => {
    expect(parseMailConfig({ ...smtp, NODE_ENV: "production", SMTP_HOST: "smtp.example.com", SMTP_PORT: "587", SMTP_SECURE: "false" }).smtp.secure).toBe(false);
    expect(() => parseMailConfig({ ...smtp, SMTP_SECURE: "yes" })).toThrow("true or false");
  });
});
