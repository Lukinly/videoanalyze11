import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createProgressHub } from "../events/progress-hub.js";

describe("analysis event stream lifecycle", () => {
  it("delivers progress over HTTP and closes active streams during shutdown", async () => {
    const progressHub = createProgressHub();
    const app = buildApp({
      authService: {
        sendRegistrationCode: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), login: vi.fn(), logout: vi.fn(),
        authenticate: vi.fn().mockResolvedValue({ id: "user" })
      },
      analysisService: { start: vi.fn(), cancel: vi.fn(), get: vi.fn().mockResolvedValue({ id: "run" }) },
      progressHub
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(`${address}/api/analysis-runs/run/events`, { headers: { cookie: "video_session=test" } });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body!.getReader();
      const initial = await reader.read();
      expect(new TextDecoder().decode(initial.value)).toContain("event: connected");
      progressHub.publish("run", { stage: "transcribing", status: "running", progress: 0.5 });
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"progress":0.5');
      await app.close();
      expect((await reader.read()).done).toBe(true);
    } finally { progressHub.close(); await app.close(); }
  });
});
