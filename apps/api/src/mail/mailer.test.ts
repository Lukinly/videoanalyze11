import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMailConfig } from "./config.js";
const mock = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), close: vi.fn(), verify: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mock.create } }));
import { createMailer } from "./mailer.js";
const config = parseMailConfig({ MAIL_TRANSPORT: "smtp", SMTP_USER: "sender@163.com", SMTP_PASSWORD: "test-only-password" });

describe("mail delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.send.mockResolvedValue({ accepted: ["user@example.com"], rejected: [] });
    mock.create.mockReturnValue({ sendMail: mock.send, close: mock.close, verify: mock.verify });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("uses one TLS transport for all account mail and closes it", async () => {
    const mailer = createMailer(config);
    await mailer.sendRegistrationCode({ email: "user@example.com", code: "123456", expiresAt: new Date(Date.now() + 600_000) });
    await mailer.sendVerification({ email: "user@example.com", token: "hidden", link: "https://app.example.com/verify-email?token=hidden" });
    await mailer.sendPasswordReset({ email: "user@example.com", token: "hidden", link: "https://app.example.com/reset-password?token=hidden" });
    await mailer.verify();
    mailer.close();
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ secure: true, port: 465, maxConnections: 1, maxRequeues: 0, logger: false, debug: false }));
    expect(mock.send).toHaveBeenCalledTimes(3);
    expect(mock.send.mock.calls[0][0]).toMatchObject({ from: config.from, to: [{ address: "user@example.com" }], text: expect.stringContaining("123456") });
    expect(mock.verify).toHaveBeenCalledOnce();
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it("returns a sanitized failure and checks the shared budget before SMTP", async () => {
    mock.send.mockRejectedValue(Object.assign(new Error("sensitive server response"), { code: "EAUTH" }));
    const reportFailure = vi.fn();
    const beforeSend = vi.fn().mockResolvedValue(undefined);
    const mailer = createMailer(config, { beforeSend, reportFailure });
    await expect(mailer.sendRegistrationCode({ email: "user@example.com", code: "123456", expiresAt: new Date(Date.now() + 600_000) })).rejects.toMatchObject({ code: "MAIL_UNAVAILABLE", status: 503, message: "邮件暂时发送失败，请稍后重试" });
    expect(beforeSend).toHaveBeenCalledWith("user@example.com");
    expect(reportFailure).toHaveBeenCalledWith("authentication");
  });
  it("does not send expired codes or bypass a rejected budget", async () => {
    const mailer = createMailer(config, { beforeSend: async () => { throw new Error("budget rejected"); } });
    await expect(mailer.sendRegistrationCode({ email: "user@example.com", code: "123456", expiresAt: new Date(0) })).rejects.toMatchObject({ code: "MAIL_UNAVAILABLE" });
    await expect(mailer.sendPasswordReset({ email: "user@example.com", token: "x", link: "https://app.example.com" })).rejects.toThrow("budget rejected");
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("keeps Mailpit development delivery available", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const mailer = createMailer(parseMailConfig({}));
    await mailer.sendRegistrationCode({ email: "user@example.com", code: "123456", expiresAt: new Date(Date.now() + 600_000) });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8025/api/v1/send", expect.objectContaining({ method: "POST", body: expect.stringContaining("123456") }));
    expect(mock.create).not.toHaveBeenCalled();
  });
});
