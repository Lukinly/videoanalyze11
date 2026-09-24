import { spawn } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderError, type TimestampLevel } from "@videoanalyze/domain";

const GROQ_TRANSCRIPTIONS_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_HEADER_BYTES = 64 * 1024;

export type CurlRunResult = {
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export type CurlRunner = (args: readonly string[]) => Promise<CurlRunResult>;

export type GroqAsrCurlResponse = {
  body: string;
  retryAfter: string | null;
  status: number;
};

export async function requestGroqAsrWithCurl(input: {
  apiKey: string;
  audioFile: string;
  curlRunner?: CurlRunner;
  language: string | null;
  model: string;
  prompt?: string;
  timestampLevel: TimestampLevel;
}): Promise<GroqAsrCurlResponse> {
  if (/[\r\n]/.test(input.apiKey)) {
    throw new ProviderError("unauthorized", "Groq API key contains invalid characters");
  }
  let temporaryDirectory: string | undefined;

  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "videoanalyze-groq-asr-"));
    const authorizationHeaderPath = join(temporaryDirectory, "authorization.headers");
    const responseHeaderPath = join(temporaryDirectory, "response.headers");
    await writeFile(authorizationHeaderPath, `Authorization: Bearer ${input.apiKey}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });

    const args = [
      "--silent",
      "--show-error",
      "--connect-timeout",
      "15",
      "--max-time",
      "600",
      "--header",
      `@${authorizationHeaderPath}`,
      "--dump-header",
      responseHeaderPath,
      "--form",
      curlFileForm(input.audioFile),
      "--form-string",
      `model=${input.model}`,
      "--form-string",
      "response_format=verbose_json",
      "--form-string",
      `timestamp_granularities[]=${input.timestampLevel}`,
    ];
    if (input.language) args.push("--form-string", `language=${input.language}`);
    if (input.prompt) args.push("--form-string", `prompt=${input.prompt}`);
    args.push(GROQ_TRANSCRIPTIONS_ENDPOINT);

    const result = await (input.curlRunner ?? runCurl)(args);
    if (result.exitCode !== 0) {
      throw curlExitError(result.exitCode, result.signal);
    }

    const responseHeaders = await readBoundedResponseHeaders(responseHeaderPath);
    const metadata = parseFinalResponseHeaders(responseHeaders);
    return { body: result.stdout, retryAfter: metadata.retryAfter, status: metadata.status };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw curlTransportError(error, input.apiKey);
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function runCurl(args: readonly string[]): Promise<CurlRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    let outputLimitError: Error | undefined;

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (outputLimitError) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_RESPONSE_BYTES) {
        outputLimitError = Object.assign(new Error("curl response exceeded limit"), { code: "OUTPUT_LIMIT" });
        child.kill();
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", (error) => {
      if (!outputLimitError) rejectOnce(error);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (outputLimitError) {
        reject(outputLimitError);
        return;
      }
      resolve({
        exitCode,
        signal,
        stderr: "",
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      });
    });
  });
}

function curlFileForm(audioFile: string): string {
  const escapedPath = audioFile.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `file=@"${escapedPath}";type=audio/flac`;
}

async function readBoundedResponseHeaders(responseHeaderPath: string): Promise<string> {
  const file = await open(responseHeaderPath, "r");
  try {
    const buffer = Buffer.alloc(MAX_RESPONSE_HEADER_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_RESPONSE_HEADER_BYTES) {
      throw Object.assign(new Error("curl response headers exceeded limit"), { code: "HEADERS_TOO_LARGE" });
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await file.close();
  }
}

function parseFinalResponseHeaders(rawHeaders: string): { retryAfter: string | null; status: number } {
  const responses: Array<{ retryAfter: string | null; status: number }> = [];
  let current: { retryAfter: string | null; status: number } | undefined;

  for (const line of rawHeaders.replaceAll("\r\n", "\n").split("\n")) {
    const statusMatch = line.match(/^HTTP\/\S+\s+(\d{3})(?:\s|$)/);
    if (statusMatch) {
      current = { retryAfter: null, status: Number(statusMatch[1]) };
      responses.push(current);
      continue;
    }
    if (!current || line === "") continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    if (line.slice(0, separator).trim().toLowerCase() === "retry-after") {
      current.retryAfter = line.slice(separator + 1).trim();
    }
  }

  const finalResponse = responses.at(-1);
  if (!finalResponse) throw Object.assign(new Error("curl response omitted HTTP status"), { code: "INVALID_RESPONSE" });
  return finalResponse;
}

function curlExitError(exitCode: number | null, signal?: NodeJS.Signals | null): ProviderError {
  if (Number.isInteger(exitCode)) {
    return new ProviderError("network_error", `Groq ASR curl request failed (exit code ${exitCode})`);
  }
  const safeSignal = typeof signal === "string" && /^[A-Z0-9]+$/.test(signal) ? signal : "unknown";
  return new ProviderError("network_error", `Groq ASR curl request failed (signal ${safeSignal})`);
}

function curlTransportError(error: unknown, apiKey: string): ProviderError {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  const safeCode = typeof code === "string" && code !== apiKey && /^[A-Z0-9_]{1,32}$/.test(code) ? ` (${code})` : "";
  return new ProviderError("network_error", `Groq ASR curl transport failed${safeCode}`);
}
