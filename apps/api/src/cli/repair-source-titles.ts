import { Pool } from "pg";
import { emailSchema } from "@videoanalyze/domain";
import { repairSourceTitles } from "../links/source-title-repair.js";
import { createPlatformInspector } from "../links/platform-inspector.js";

async function main() {
  const options: { url?: string; email?: string; limit?: number } = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value) throw new Error("invalid repair options");
    if (args[i] === "--url") options.url = value;
    else if (args[i] === "--email") options.email = emailSchema.parse(value);
    else if (args[i] === "--limit") options.limit = Number(value);
    else throw new Error("invalid repair options");
  }
  if (!process.env.DATABASE_URL) throw new Error("database configuration is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const report = await repairSourceTitles({ pool, inspector: createPlatformInspector({ allowBrowserFallback: false, maxConcurrent: 1 }), ...options });
    console.log(JSON.stringify(report));
    if (report.failed) process.exitCode = 1;
  } finally { await pool.end(); }
}

main().catch(() => {
  console.error("Title repair failed. Check DATABASE_URL and options: [--url VIDEO_URL] [--email USER_EMAIL] [--limit 1..200].");
  process.exitCode = 1;
});
