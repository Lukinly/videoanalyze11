import nodemailer from "nodemailer";
import { DomainError } from "@videoanalyze/domain";
import type { MailConfig } from "./config.js";

export type Mailer = {
  sendRegistrationCode(input: { email: string; code: string; expiresAt: Date }): Promise<void>;
  sendVerification(input: { email: string; token: string; link: string }): Promise<void>;
  sendPasswordReset(input: { email: string; token: string; link: string }): Promise<void>;
};

export function createMailer(config: MailConfig, options: {
  beforeSend?: (email: string) => Promise<void>;
  reportFailure?: (category: string) => void;
} = {}) {
  const smtp = config.transport === "smtp" ? nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    requireTLS: !config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    pool: true, maxConnections: 1, maxMessages: 20, maxRequeues: 0,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false
  }) : undefined;
  let pending = 0;
  async function send(email: string, subject: string, text: string) {
    if (pending >= 3) throw new DomainError("MAIL_UNAVAILABLE", "邮件服务繁忙，请稍后重试", 503);
    pending++;
    try {
      await options.beforeSend?.(email);
      try {
        if (smtp) {
          const result = await smtp.sendMail({ from: config.from, to: [{ address: email }], subject, text });
          if (!result.accepted?.length || result.rejected?.length) throw new Error("recipient rejected");
        } else {
          const response = await fetch(config.mailApiUrl, {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({ From: { Email: config.from.address, Name: config.from.name }, To: [{ Email: email }], Subject: subject, Text: text })
          });
          if (!response.ok) throw new Error("mailpit unavailable");
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        options.reportFailure?.(code === "EAUTH" ? "authentication" : code === "ETIMEDOUT" ? "timeout" : "delivery");
        throw new DomainError("MAIL_UNAVAILABLE", "邮件暂时发送失败，请稍后重试", 503);
      }
    } finally { pending--; }
  }
  return {
    async sendRegistrationCode(input: { email: string; code: string; expiresAt: Date }) {
      if (input.expiresAt.getTime() <= Date.now()) throw new DomainError("MAIL_UNAVAILABLE", "验证码已过期，请重新获取", 503);
      await send(input.email, "十一视频笔记注册验证码", `你的注册验证码是：${input.code}\n验证码 10 分钟内有效，请勿向他人透露。\n如果你没有申请注册，请忽略此邮件。`);
    },
    async sendVerification(input: { email: string; token: string; link: string }) {
      await send(input.email, "验证你的十一视频笔记账号", `请打开以下链接完成邮箱验证：${input.link}`);
    },
    async sendPasswordReset(input: { email: string; token: string; link: string }) {
      await send(input.email, "重置你的十一视频笔记密码", `请打开以下链接设置新密码：${input.link}\n链接 1 小时内有效，仅可使用一次。\n如果你没有申请重置密码，请忽略此邮件。`);
    },
    async verify() { if (smtp) await smtp.verify(); else throw new Error("SMTP verification requires MAIL_TRANSPORT=smtp"); },
    close() { smtp?.close(); }
  } satisfies Mailer & { verify(): Promise<void>; close(): void };
}
