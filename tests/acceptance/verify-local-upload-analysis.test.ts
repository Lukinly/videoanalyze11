import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  assertStatus,
  extractSessionCookie,
  isTerminalAnalysisStatus,
  lookupLocalStorage,
  readUploadResponse,
  redactSignedQueryParameters,
  redactPresignedUrl,
  validatePresignedUploadUrl
} from "../../scripts/verify-local-upload-analysis.mjs";

describe("local upload and analysis verifier helpers", () => {
  it("extracts the video session cookie from a Set-Cookie header", () => {
    expect(extractSessionCookie("video_session=session-token; Path=/; HttpOnly; Secure")).toBe("video_session=session-token");
  });

  it("accepts only HTTPS storage presigned URLs without SDK checksum placeholders", () => {
    expect(validatePresignedUploadUrl("https://storage.localhost/videoanalyze/object?X-Amz-Signature=redacted").hostname).toBe("storage.localhost");
    expect(() => validatePresignedUploadUrl("http://storage.localhost/object")).toThrow(/HTTPS/);
    expect(() => validatePresignedUploadUrl("https://minio:9000/object")).toThrow(/storage\.localhost/);
    expect(() => validatePresignedUploadUrl("https://storage.localhost/object?x-amz-checksum-crc32=AAAAAA%3D%3D")).toThrow(/checksum/i);
  });

  it("maps only storage.localhost to IPv4 loopback in both DNS callback shapes", async () => {
    const delegatedLookup = vi.fn((hostname, options, callback) => callback(null, "192.0.2.10", 4));

    await expect(new Promise((resolvePromise, reject) => {
      lookupLocalStorage("storage.localhost", {}, (error, address, family) => {
        if (error) return reject(error);
        resolvePromise({ address, family });
      }, delegatedLookup);
    })).resolves.toEqual({ address: "127.0.0.1", family: 4 });

    await expect(new Promise((resolvePromise, reject) => {
      lookupLocalStorage("storage.localhost", { all: true }, (error, addresses) => {
        if (error) return reject(error);
        resolvePromise(addresses);
      }, delegatedLookup);
    })).resolves.toEqual([{ address: "127.0.0.1", family: 4 }]);

    await expect(new Promise((resolvePromise, reject) => {
      lookupLocalStorage("api.example.test", { family: 4 }, (error, address, family) => {
        if (error) return reject(error);
        resolvePromise({ address, family });
      }, delegatedLookup);
    })).resolves.toEqual({ address: "192.0.2.10", family: 4 });
    expect(delegatedLookup).toHaveBeenCalledTimes(1);
    expect(delegatedLookup).toHaveBeenCalledWith("api.example.test", { family: 4 }, expect.any(Function));
  });

  it("recognizes analysis terminal statuses", () => {
    expect(isTerminalAnalysisStatus("completed")).toBe(true);
    expect(isTerminalAnalysisStatus("failed")).toBe(true);
    expect(isTerminalAnalysisStatus("running")).toBe(false);
  });

  it("redacts the query string before printing a presigned URL", () => {
    expect(redactPresignedUrl("https://storage.localhost/object?X-Amz-Credential=secret&X-Amz-Signature=secret")).toBe("https://storage.localhost/object?[redacted]");
  });

  it("redacts case-insensitive signed query values before including a capped response body in a status error", () => {
    const reflectedResponse = "storage rejected request: https://storage.localhost/object?x-AmZ-Signature=masked-input&plain=kept";
    const sanitized = redactSignedQueryParameters(reflectedResponse);

    expect(sanitized).toContain("x-AmZ-Signature=[redacted]");
    expect(sanitized).toContain("plain=kept");
    expect(sanitized).not.toContain("masked-input");
    expect(() => assertStatus(502, reflectedResponse, 201)).toThrow(/x-AmZ-Signature=\[redacted\]/);
    expect(() => assertStatus(500, "x".repeat(300), 201)).toThrow(new RegExp(`x{240}$`));
  });

  it("settles incomplete upload responses while allowing close after end", async () => {
    const abortedResponse = new EventEmitter();
    const aborted = readUploadResponse(abortedResponse);
    abortedResponse.emit("aborted");
    await expect(aborted).rejects.toThrow(/aborted/);

    const closedResponse = new EventEmitter();
    const closed = readUploadResponse(closedResponse);
    closedResponse.emit("close");
    await expect(closed).rejects.toThrow(/closed before completion/);

    const completedResponse = new EventEmitter();
    completedResponse.statusCode = 204;
    const completed = readUploadResponse(completedResponse);
    completedResponse.emit("end");
    completedResponse.emit("close");
    await expect(completed).resolves.toEqual({ status: 204, body: "" });
  });

  it("throws a useful error for an unexpected status", () => {
    expect(() => assertStatus(500, "internal error", 201)).toThrow(/expected HTTP 201, got 500/);
  });
});
