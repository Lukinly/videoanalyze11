import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

describe("Groq ASR curl process lifecycle", () => {
  it("waits for close after terminating an oversized stdout response before cleaning credentials", async () => {
    const { requestGroqAsrWithCurl } = await import("./groq-asr-curl.js");
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn(() => true),
      stderr: new PassThrough(),
      stdout: new PassThrough(),
    });
    spawnMock.mockReturnValueOnce(child);

    let outcome: "pending" | "resolved" | "rejected" = "pending";
    let failure: (Error & { code?: string }) | undefined;
    const request = requestGroqAsrWithCurl({
      apiKey: "output-limit-key",
      audioFile: "/tmp/fake-audio.flac",
      language: null,
      model: "whisper-large-v3-turbo",
      timestampLevel: "segment",
    });
    const observed = request.then(
      () => { outcome = "resolved"; },
      (error: unknown) => {
        outcome = "rejected";
        failure = error as Error & { code?: string };
      },
    );

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    const args = spawnMock.mock.calls[0][1] as readonly string[];
    const options = spawnMock.mock.calls[0][2] as { shell?: boolean };
    const authorizationHeaderPath = args[args.indexOf("--header") + 1].slice(1);
    child.stdout.write(Buffer.alloc(32 * 1024 * 1024 + 1));
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledOnce());
    const settledBeforeClose = await Promise.race([
      observed.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 200)),
    ]);

    try {
      expect(options.shell).toBe(false);
      expect(settledBeforeClose).toBe(false);
      expect(outcome).toBe("pending");
      await expect(stat(authorizationHeaderPath)).resolves.toBeDefined();
    } finally {
      child.emit("close", null, "SIGTERM");
      await observed;
    }

    expect(outcome).toBe("rejected");
    expect(failure).toMatchObject({ code: "network_error" });
    expect(failure?.message).toContain("OUTPUT_LIMIT");
    await expect(stat(authorizationHeaderPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);
});
