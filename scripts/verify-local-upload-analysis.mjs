/* global URL, console, fetch, setTimeout */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const baseUrl = process.env.E2E_BASE_URL ?? "https://localhost";
const mailpitUrl = process.env.MAILPIT_URL ?? "http://localhost:8025";
const videoPath = process.env.VIDEO_PATH ?? "/mnt/v/Vworkspace/videoanlast/test.mp4";
const pollIntervalMs = Number(process.env.E2E_POLL_INTERVAL_MS ?? 5_000);
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 45 * 60 * 1_000);

export function assertStatus(status, body, expectedStatus) {
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(status)) {
    throw new Error(`expected HTTP ${expected.join(" or ")}, got ${status}: ${safeBody(body)}`);
  }
}

export function extractSessionCookie(setCookieHeader) {
  const value = Array.isArray(setCookieHeader) ? setCookieHeader.join(", ") : setCookieHeader ?? "";
  const match = value.match(/(?:^|,\s*)video_session=([^;,\s]+)/);
  if (!match) throw new Error("login response did not include a video_session cookie");
  return `video_session=${match[1]}`;
}

export function validatePresignedUploadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("upload URL is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("upload URL must use HTTPS");
  if (url.hostname !== "storage.localhost") throw new Error("upload URL must use storage.localhost");
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (normalized === "x-amz-sdk-checksum-algorithm" || normalized === "x-amz-checksum-crc32") {
      throw new Error("upload URL contains an unsupported checksum placeholder");
    }
  }
  return url;
}

export function lookupLocalStorage(hostname, options, callback, lookup = dnsLookup) {
  if (hostname === "storage.localhost") {
    if (options?.all) {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
    } else {
      callback(null, "127.0.0.1", 4);
    }
    return;
  }
  lookup(hostname, options, callback);
}

export function isTerminalAnalysisStatus(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function redactPresignedUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}`;
}

export function redactSignedQueryParameters(value) {
  return value.replace(/(x-amz-[^=&#?\s]+)=([^&#\s]*)/gi, "$1=[redacted]");
}

export function buildSafeVerificationReport(value) {
  return {
    runId: value.runId,
    terminalStatus: value.terminalStatus,
    originalDeleted: value.originalDeleted === true,
    resultAvailability: value.resultAvailability,
    transcriptSegmentCount: Number(value.transcriptSegmentCount),
    chapterCount: Number(value.chapterCount)
  };
}

async function requestJson(path, options = {}, expectedStatus = 200, cookie = "") {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // Preserve a short text body for useful failures.
  }
  assertStatus(response.status, body, expectedStatus);
  return { response, body };
}

function responseSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

async function waitForRegistrationCode(email) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const listingResponse = await fetch(`${mailpitUrl}/api/v1/messages?limit=50`);
    const listingText = await listingResponse.text();
    assertStatus(listingResponse.status, listingText, 200);
    const listing = JSON.parse(listingText);
    for (const message of listing.messages ?? []) {
      if (!JSON.stringify(message).toLowerCase().includes(email.toLowerCase())) continue;
      const id = message.ID ?? message.Id ?? message.id;
      if (!id) continue;
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(id)}`);
      const detailText = await detailResponse.text();
      assertStatus(detailResponse.status, detailText, 200);
      const detail = JSON.parse(detailText);
      const content = [detail.Text, detail.text, detail.HTML, detail.html, detail.Body, detail.body].filter(Boolean).join("\n");
      const matches = [...content.matchAll(/(?<!\d)\d{6}(?!\d)/g)].map((match) => match[0]);
      if (matches.length > 0) return matches.at(-1);
    }
    await sleep(1_000);
  }
  throw new Error(`timed out waiting for the Mailpit registration code for ${email}`);
}

async function authenticate() {
  const configuredEmail = process.env.E2E_EMAIL;
  const configuredPassword = process.env.E2E_PASSWORD;
  const email = configuredEmail ?? `e2e-${Date.now()}@example.test`;
  const password = configuredPassword ?? `Videoanalyze-E2E-${Date.now()}!`;

  if (!configuredEmail || !configuredPassword) {
    await requestJson("/api/auth/registration-code", { method: "POST", body: JSON.stringify({ email }) }, 202);
    const verificationCode = await waitForRegistrationCode(email);
    await requestJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, confirmPassword: password, verificationCode })
    }, 202);
  }

  const login = await requestJson("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  return extractSessionCookie(responseSetCookies(login.response));
}

async function uploadVideo(cookie) {
  const file = await stat(videoPath);
  if (!file.isFile()) throw new Error(`VIDEO_PATH is not a regular file: ${videoPath}`);
  const session = await requestJson("/api/videos/upload-session", {
    method: "POST",
    body: JSON.stringify({ fileName: videoPath.split("/").at(-1), contentType: "video/mp4", contentLength: file.size })
  }, 201, cookie);
  const uploadUrl = validatePresignedUploadUrl(session.body.uploadUrl);

  const uploadResponse = await putPresignedVideo(uploadUrl, file.size);
  assertStatus(uploadResponse.status, uploadResponse.body, [200, 201, 204]);
  return session.body;
}

function putPresignedVideo(uploadUrl, contentLength) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let request;
    let fileStream;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (fileStream && !fileStream.destroyed) fileStream.destroy();
      if (request && !request.destroyed) request.destroy();
      reject(error);
    };

    request = httpsRequest({
      protocol: uploadUrl.protocol,
      hostname: uploadUrl.hostname,
      port: uploadUrl.port || undefined,
      path: `${uploadUrl.pathname}${uploadUrl.search}`,
      method: "PUT",
      headers: {
        host: uploadUrl.host,
        "content-type": "video/mp4",
        "content-length": String(contentLength)
      },
      servername: uploadUrl.hostname,
      lookup: lookupLocalStorage
    }, (response) => {
      readUploadResponse(response).then((result) => {
        if (settled) return;
        settled = true;
        resolvePromise(result);
      }, fail);
    });
    request.once("error", fail);
    fileStream = createReadStream(videoPath);
    fileStream.once("error", fail);
    fileStream.pipe(request);
  });
}

export function readUploadResponse(response) {
  return new Promise((resolvePromise, reject) => {
    const bodyChunks = [];
    let bodyLength = 0;
    let settled = false;
    let ended = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    response.on("data", (chunk) => {
      if (bodyLength >= 240) return;
      const remaining = 240 - bodyLength;
      const safeChunk = Buffer.isBuffer(chunk) ? chunk.subarray(0, remaining) : Buffer.from(String(chunk)).subarray(0, remaining);
      bodyChunks.push(safeChunk);
      bodyLength += safeChunk.length;
    });
    response.once("error", fail);
    response.once("aborted", () => fail(new Error("upload response was aborted")));
    response.once("close", () => {
      if (!ended) fail(new Error("upload response closed before completion"));
    });
    response.once("end", () => {
      if (settled) return;
      ended = true;
      settled = true;
      resolvePromise({ status: response.statusCode ?? 0, body: Buffer.concat(bodyChunks).toString("utf8") });
    });
  });
}

async function runAnalysis(cookie, videoId) {
  const started = await requestJson(`/api/videos/${encodeURIComponent(videoId)}/analysis-runs`, { method: "POST" }, 202, cookie);
  const runId = started.body.id;
  if (typeof runId !== "string" || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("analysis response did not include a valid run id");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await requestJson(`/api/analysis-runs/${encodeURIComponent(runId)}`, {}, 200, cookie);
    const status = current.body.status;
    if (isTerminalAnalysisStatus(status)) {
      if (status !== "completed") throw new Error(`analysis ended with ${status}: ${safeBody(current.body)}`);
      return { runId, terminalStatus: status };
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`analysis did not finish within ${timeoutMs}ms: run=${runId}`);
}

async function waitForTerminalLifecycle(cookie, videoId, terminal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = await requestJson(`/api/analysis-runs/${encodeURIComponent(terminal.runId)}`, {}, 200, cookie);
    const playback = await requestJson(`/api/videos/${encodeURIComponent(videoId)}/playback-url`, {}, [200, 410], cookie);
    if (playback.response.status === 410 && detail.body.originalDeletedAt && detail.body.resultAvailability === "available") {
      const report = buildSafeVerificationReport({
        ...terminal,
        originalDeleted: true,
        resultAvailability: detail.body.resultAvailability,
        transcriptSegmentCount: detail.body.transcript?.segments?.length ?? 0,
        chapterCount: detail.body.summary?.chapters?.length ?? 0
      });
      if (report.transcriptSegmentCount < 1) throw new Error("completed analysis contains no transcript segments");
      return report;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error("terminal analysis did not finish deleting its original media before the verification timeout");
}

function safeBody(body) {
  const text = typeof body === "string" ? body : body === undefined ? "" : JSON.stringify(body);
  return redactSignedQueryParameters(text).slice(0, 240);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function main() {
  if (!baseUrl.startsWith("https://")) throw new Error("E2E_BASE_URL must use https:// for the local verifier");
  if (!process.env.NODE_EXTRA_CA_CERTS) throw new Error("NODE_EXTRA_CA_CERTS must point to .local/videoanalyze-local-root.crt");
  const cookie = await authenticate();
  const session = await uploadVideo(cookie);
  const terminal = await runAnalysis(cookie, session.videoId);
  const report = await waitForTerminalLifecycle(cookie, session.videoId, terminal);
  console.log(JSON.stringify(report));
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
