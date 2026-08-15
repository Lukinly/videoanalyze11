import { describe, expect, it } from "vitest";
import { evaluateAdmission } from "./admission-policy.js";

describe("analysis admission policy", () => {
  it("allows one running job plus up to two already admitted queued jobs", () => {
    expect(evaluateAdmission({ userRunning: 1, userQueued: 1, totalQueued: 19, estimatedWaitSeconds: 3600 })).toEqual({ accepted: true, estimatedWaitSeconds: 3600 });
  });

  it.each([
    [{ userRunning: 1, userQueued: 2, totalQueued: 2, estimatedWaitSeconds: 100 }, "USER_QUEUE_LIMIT"],
    [{ userRunning: 0, userQueued: 0, totalQueued: 20, estimatedWaitSeconds: 100 }, "GLOBAL_QUEUE_LIMIT"],
    [{ userRunning: 0, userQueued: 0, totalQueued: 19, estimatedWaitSeconds: 3601 }, "QUEUE_WAIT_LIMIT"]
  ] as const)("rejects an overloaded snapshot", (snapshot, code) => {
    expect(evaluateAdmission(snapshot)).toMatchObject({ accepted: false, code });
  });
});
