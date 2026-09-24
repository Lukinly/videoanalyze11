import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { emailSchema } from "@videoanalyze/domain";
import { createDatabase } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import { hashPassword } from "../auth/passwords.js";

function parseEmail(argv: string[]): string {
  const index = argv.indexOf("--email");
  if (index < 0 || !argv[index + 1]) throw new Error("usage: admin:create --email admin@example.com");
  return emailSchema.parse(argv[index + 1]);
}

async function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  if (!stdin.isTTY || !stdin.setRawMode) {
    const line = await createInterface({ input: stdin, output: stdout }).question("");
    return line;
  }
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      const char = chunk.toString("utf8");
      if (char === "\u0003") {
        cleanup();
        reject(new Error("cancelled"));
      } else if (char === "\r" || char === "\n") {
        stdout.write("\n");
        cleanup();
        resolve(value);
      } else if (char === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    const cleanup = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const email = parseEmail(process.argv.slice(2));
  const password = await readHidden("Password: ");
  if (password.length < 8) throw new Error("password must be at least 8 characters");

  const { pool } = createDatabase();
  try {
    const repositories = createRepositories(pool);
    if (await repositories.users.findByEmail(email)) throw new Error("a user with this email already exists");
    await repositories.users.create({ email, passwordHash: await hashPassword(password), role: "admin", status: "active", emailVerifiedAt: new Date() });
    stdout.write(`Created administrator ${email}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
