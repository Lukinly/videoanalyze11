import { parseMailConfig } from "../mail/config.js";
import { createMailer } from "../mail/mailer.js";

let mailer: ReturnType<typeof createMailer> | undefined;
try {
  mailer = createMailer(parseMailConfig(process.env));
  await mailer.verify();
  console.log("SMTP connection and authentication verified; no email sent.");
} catch {
  console.error("SMTP verification failed. Check the SMTP settings, secret file permissions and outbound network access.");
  process.exitCode = 1;
} finally { mailer?.close(); }
