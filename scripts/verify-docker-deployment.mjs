/* global console, Buffer */
import process from "node:process";
import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, openSync, closeSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer } from "node:net";

const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, ".local"), { recursive: true });
const directory = mkdtempSync(join(root, ".local/docker-smoke-"));
const secrets = join(directory, "secrets"); mkdirSync(secrets, { mode: 0o700 });
const freePort = () => new Promise((accept, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => accept(String(port))); });
});
const httpsPort = await freePort(), httpPort = await freePort();
const env = {
  ...process.env, SMOKE_DIR: directory, SECRETS_DIR: secrets,
  PUBLIC_HOST: `https://app.smoke.test:${httpsPort}`, STORAGE_HOST: `https://media.smoke.test:${httpsPort}`,
  HTTP_BIND: "127.0.0.1", HTTP_PORT: httpPort, HTTPS_PORT: httpsPort,
  SMTP_USER: "sender@example.test", SMTP_HOST: "smtp-test", SMTP_PORT: "465", SMTP_SECURE: "true",
  MAIL_DAILY_LIMIT: "4", MAIL_RECIPIENT_DAILY_LIMIT: "2", AUTH_REQUESTS_PER_MINUTE: "100",
  LLM_API_BASE_URL: "https://smtp-test/openai/v1", LLM_API_MODEL: "smoke-test", LLM_API_PROTOCOL: "openai",
  S3_BUCKET: "videoanalyze", IMAGE_TAG: "local"
};
const dummySecrets = {
  storage_rpc_secret: randomBytes(32).toString("hex"), db_password: randomBytes(32).toString("hex"),
  s3_access_key: `GK${randomBytes(16).toString("hex")}`, s3_secret_key: randomBytes(32).toString("hex"),
  smtp_password: "smoke-mail-password", groq_api_key: "smoke-asr-key", llm_api_key: "smoke-llm-key"
};
// Only synthetic credentials. World-readable files allow Docker Desktop UID mapping;
// the host parent directory stays private. Real deployment files use mode 0600.
for (const [name, value] of Object.entries(dummySecrets)) writeFileSync(join(secrets, name), value, { mode: 0o644 });
writeFileSync(join(directory, "empty.env"), "");
const base = ["compose", "--env-file", join(directory, "empty.env"), "-p", "videoanalyze-smoke", "-f", "infra/docker-compose.production.yml", "-f", "tests/docker/compose.smoke.yml"];
const run = (command, args, { mergeOutput = false, ...options } = {}) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", maxBuffer: 8_000_000, timeout: 1_800_000, ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}); inspect the local smoke log.`);
  return mergeOutput ? (result.stdout ?? "") + (result.stderr ?? "") : result.stdout;
};
const compose = (...args) => run("docker", [...base, ...args]);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const cookie = join(directory, "cookies");
const headers = join(directory, "headers");
function request(path, { method = "GET", payload, origin = env.PUBLIC_HOST, extra = [] } = {}) {
  const url = path.startsWith("https://") ? path : `${env.PUBLIC_HOST}${path}`;
  const args = ["--silent", "--show-error", "--noproxy", "*", "--max-time", "15", "--cacert", join(directory, "caddy-root.crt"),
    "--resolve", `app.smoke.test:${httpsPort}:127.0.0.1`, "--resolve", `media.smoke.test:${httpsPort}:127.0.0.1`,
    "-X", method, "-b", cookie, "-c", cookie, "-D", headers, "-H", `Origin: ${origin}`];
  if (payload) args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(payload));
  args.push(...extra, "-w", "\n%{http_code}", url);
  const output = run("curl", args); const split = output.lastIndexOf("\n");
  const body = output.slice(0, split);
  return { status: Number(output.slice(split + 1)), body, json: () => JSON.parse(body) };
}
function messages() {
  return JSON.parse(compose("exec", "-T", "api", "node", "-e", "fetch('http://smtp-test:8080').then(r=>r.text()).then(t=>process.stdout.write(t))")).map((raw) => {
    const index = raw.indexOf("\r\n\r\n"), headers = raw.slice(0, index), body = raw.slice(index + 4);
    if (/Content-Transfer-Encoding: base64/i.test(headers)) return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
    return body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  });
}
let started = false;
try {
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, "smtp.key"), "-out", join(directory, "smtp.crt"), "-days", "2", "-subj", "/CN=smtp-test", "-addext", "subjectAltName=DNS:smtp-test,DNS:api.groq.com"]);
  chmodSync(join(directory, "smtp.key"), 0o644);
  const config = JSON.parse(compose("config", "--format", "json"));
  for (const [name, service] of Object.entries(config.services)) {
    check(name === "proxy" || !service.ports?.length, `${name} exposes an internal port`);
  }
  check(!config.services.worker.secrets.some((item) => item.source === "smtp_password"), "worker has SMTP secret access");
  console.log("Production port and secret isolation checks passed.");
  if (!process.argv.includes("--no-build")) {
    console.log("Building deployment images; detailed output is in .local/docker-smoke-build.log.");
    const fd = openSync(join(root, ".local/docker-smoke-build.log"), "w");
    try { run("docker", [...base, "build", "api", "worker", "web", "storage"], { stdio: ["ignore", fd, fd] }); }
    finally { closeSync(fd); }
  }
  console.log("Starting isolated Docker stack with a local TLS SMTP sink."); started = true;
  const fd = openSync(join(root, ".local/docker-smoke-start.log"), "w");
  try { run("docker", [...base, "up", "-d", "--wait", "--wait-timeout", "180"], { stdio: ["ignore", fd, fd] }); }
  finally { closeSync(fd); }
  for (let attempt = 0; attempt < 10; attempt++) {
    try { writeFileSync(join(directory, "caddy-root.crt"), compose("exec", "-T", "proxy", "cat", "/data/caddy/pki/authorities/local/root.crt")); break; }
    catch (error) { if (attempt === 9) throw error; await delay(1000); }
  }
  check(request("/").status === 200, "public homepage unavailable");
  check(request("/api/auth/me").status === 401, "private account endpoint is public");
  check(request("/api/auth/registration-code", { method: "POST", origin: "https://evil.example", payload: { email: "first@example.test" } }).status === 403, "cross-site mail request accepted");
  compose("exec", "-T", "api", "node", "dist/cli/mail-verify.js");
  const email = "first@example.test", password = "smoke strong password", nextPassword = "changed smoke password";
  check(request("/api/auth/registration-code", { method: "POST", payload: { email } }).status === 202, "registration code was not accepted");
  const code = messages()[0]?.match(/\b\d{6}\b/)?.[0]; check(code, "SMTP sink did not receive a code");
  check(request("/api/auth/registration-code", { method: "POST", payload: { email } }).status === 429, "resend cooldown bypassed");
  check(request("/api/auth/register", { method: "POST", payload: { email, password, confirmPassword: password, verificationCode: "000000" } }).status === 400, "invalid code accepted");
  check(request("/api/auth/register", { method: "POST", payload: { email, password, confirmPassword: password, verificationCode: code } }).status === 202, "registration failed");
  check(request("/api/auth/register", { method: "POST", payload: { email, password, confirmPassword: password, verificationCode: code } }).status === 400, "code reused");
  check(request("/api/auth/login", { method: "POST", payload: { email, password } }).status === 200, "login failed");
  const cookieHeaders = readFileSync(headers, "utf8");
  check(/set-cookie:.*HttpOnly/i.test(cookieHeaders) && /set-cookie:.*Secure/i.test(cookieHeaders), "session cookie is not protected");
  check(request("/api/auth/me").status === 200, "session authentication failed");
  console.log("TLS SMTP delivery, code validation, registration, secure cookies and login passed.");

  compose("exec", "-T", "worker", "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=1", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "3", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "/tmp/smoke.mp4");
  const content = Buffer.from(compose("exec", "-T", "worker", "node", "-e", "process.stdout.write(require('node:fs').readFileSync('/tmp/smoke.mp4').toString('base64'))"), "base64");
  const videoFile = join(directory, "video.mp4"); writeFileSync(videoFile, content);
  const upload = request("/api/videos/upload-session", { method: "POST", payload: { fileName: "smoke.mp4", contentType: "video/mp4", contentLength: content.length } });
  check(upload.status === 201, "upload session failed");
  const session = upload.json();
  const preflight = request(session.uploadUrl, { method: "OPTIONS", extra: ["-H", "Access-Control-Request-Method: PUT", "-H", "Access-Control-Request-Headers: content-type"] });
  check(preflight.status >= 200 && preflight.status < 300 && readFileSync(headers, "utf8").includes(env.PUBLIC_HOST), "storage CORS preflight failed");
  check(request(session.uploadUrl, { method: "PUT", extra: ["-H", "Content-Type: video/mp4", "--data-binary", `@${videoFile}`] }).status === 200, "signed upload failed");
  const playback = request(`/api/videos/${session.videoId}/playback-url`).json();
  check(request(playback.url, { extra: ["-H", "Range: bytes=0-5"] }).status === 206, "video range request failed");
  check(request(`${env.STORAGE_HOST}/videoanalyze/${session.objectKey}`).status === 403, "private media can be read anonymously");
  console.log("Private object storage, signed upload, CORS and video range playback passed.");
  const startedRun = request(`/api/videos/${session.videoId}/analysis-runs`, { method: "POST", payload: { retentionMode: "standard" } });
  check(startedRun.status === 202, "analysis enqueue failed");
  const runId = startedRun.json().id;
  let result;
  for (let attempt = 0; attempt < 60; attempt++) {
    result = request(`/api/analysis-runs/${runId}`).json();
    if (["completed", "failed", "cancelled"].includes(result.status)) break;
    await delay(1000);
  }
  check(result.status === "completed" && result.transcript?.segments?.length && result.notes?.sections?.[0]?.frame?.dataUrl, "worker did not complete transcript, summary, notes and frame capture");
  console.log("Worker FFmpeg, ASR, summary, notes and video frame capture passed using local fake AI endpoints.");


  check(request("/api/auth/forgot-password", { method: "POST", payload: { email } }).status === 202, "password reset mail failed");
  const resetUrl = messages().at(-1)?.match(/https:\/\/[^\s]+\/reset-password\?token=[^\s]+/)?.[0]; check(resetUrl, "reset link missing");
  const token = new URL(resetUrl).searchParams.get("token");
  const reset = { token, password: nextPassword, confirmPassword: nextPassword };
  check(request("/api/auth/password-reset", { method: "POST", payload: reset }).status === 200, "password reset failed");
  check(request("/api/auth/password-reset", { method: "POST", payload: reset }).status === 400, "reset token reused");
  check(request("/api/auth/login", { method: "POST", payload: { email, password } }).status === 401, "old password accepted");
  check(request("/api/auth/login", { method: "POST", payload: { email, password: nextPassword } }).status === 200, "new password rejected");
  for (const email of ["second@example.test", "third@example.test"]) check(request("/api/auth/registration-code", { method: "POST", payload: { email } }).status === 202, "budget rejected valid send");
  check(request("/api/auth/registration-code", { method: "POST", payload: { email: "over-budget@example.test" } }).status === 429, "global mail budget bypassed");
  check(messages().length === 4, "unexpected SMTP sends");
  check(compose("exec", "-T", "postgres", "psql", "-U", "videoanalyze", "-d", "videoanalyze", "-tAc", "SELECT expires_at <= created_at FROM registration_verifications WHERE email = 'over-budget@example.test'").trim() === "t", "unsent code remained valid after the mail budget rejected delivery");
  console.log("Password reset, one-time tokens and distributed daily mail budget passed.");
  for (let index = 1; index <= 3; index++) request("/api/auth/login", { method: "POST", payload: { email: "unknown@example.test", password: "invalid" }, extra: ["-H", `X-Forwarded-For: 203.0.113.${index}`] });
  const ipKeys = compose("exec", "-T", "redis", "redis-cli", "--raw", "KEYS", "auth-limit:requests:*").trim().split("\n");
  check(new Set(ipKeys.map((key) => key.split(":").at(-1))).size === 1, "client could spoof its IP through the proxy");
  console.log("Reverse proxy client IP protection passed.");
  compose("stop", "redis");
  check(request("/api/auth/registration-code", { method: "POST", payload: { email: "redis-down@example.test" } }).status === 503, "auth did not fail closed when Redis stopped");
  console.log("Redis failure protection passed. Docker deployment smoke test passed; no external emails sent.");
} finally {
  if (started) {
    try { writeFileSync(join(root, ".local/docker-smoke-services.log"), run("docker", [...base, "logs", "--no-color", "--tail", "100"], { mergeOutput: true })); } catch { /* retain the original failure */ }
    try { compose("down", "--volumes", "--remove-orphans"); }
    catch { console.error("Smoke cleanup needs attention: project videoanalyze-smoke. Production volumes were not touched."); }
  }
  rmSync(directory, { recursive: true, force: true });
}
