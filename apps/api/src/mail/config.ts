import { readFileSync } from "node:fs";
import { emailSchema } from "@videoanalyze/domain";

export type MailConfig = {
  transport: "mailpit" | "smtp";
  from: { name: string; address: string };
  mailApiUrl: string;
  smtp: { host: string; port: number; secure: boolean; user: string; password: string };
};

export function parseMailConfig(source: Record<string, string | undefined>): MailConfig {
  const production = source.NODE_ENV === "production";
  const transport = source.MAIL_TRANSPORT ?? (production ? "smtp" : "mailpit");
  if (transport !== "smtp" && transport !== "mailpit") throw new Error("MAIL_TRANSPORT must be smtp or mailpit");
  if (production && transport !== "smtp") throw new Error("production requires SMTP mail transport");
  const user = source.SMTP_USER?.trim() ?? "";
  const address = source.MAIL_FROM_ADDRESS?.trim() || user || "no-reply@videoanalyze.local";
  if (!emailSchema.safeParse(address).success) throw new Error("MAIL_FROM_ADDRESS must be an email address");
  const name = source.MAIL_FROM_NAME ?? "十一视频笔记";
  if (/[\r\n]/.test(name)) throw new Error("MAIL_FROM_NAME must be a single line");
  const host = source.SMTP_HOST?.trim() || "smtp.163.com";
  const port = Number(source.SMTP_PORT ?? "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be a valid port");
  const secureValue = source.SMTP_SECURE ?? "true";
  if (!["true", "false"].includes(secureValue)) throw new Error("SMTP_SECURE must be true or false");
  const secure = secureValue === "true";
  let password = source.SMTP_PASSWORD ?? "";
  if (source.SMTP_PASSWORD_FILE) {
    if (password) throw new Error("set only one of SMTP_PASSWORD and SMTP_PASSWORD_FILE");
    try { password = readFileSync(source.SMTP_PASSWORD_FILE, "utf8").trim(); }
    catch { throw new Error("SMTP_PASSWORD_FILE must be readable by the API user"); }
  }
  if (transport === "smtp") {
    if (!emailSchema.safeParse(user).success || !password) throw new Error("SMTP_USER and SMTP password are required");
    if (host === "smtp.163.com" && (port !== 465 || !secure || address.toLowerCase() !== user.toLowerCase() || !user.toLowerCase().endsWith("@163.com"))) {
      throw new Error("personal 163 SMTP requires port 465, TLS and the same 163 sender account");
    }
    if (production && !secure && port !== 587) throw new Error("production SMTP requires TLS or STARTTLS on port 587");
  }
  return { transport, from: { name, address }, mailApiUrl: source.MAIL_API_URL ?? "http://127.0.0.1:8025/api/v1/send", smtp: { host, port, secure, user, password } };
}
