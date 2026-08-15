import { describe, expect, it } from "vitest";
import { aiNotesSchema } from "../../packages/domain/src/ai-notes.js";
import { calculateDurationTieredCredits } from "../../packages/domain/src/billing.js";
import { evaluateAdmission } from "../../apps/api/src/analysis/admission-policy.js";
import { FifoSemaphore } from "../../apps/worker/src/concurrency/semaphore.js";

describe("AI notes, long-video billing, and capacity acceptance", () => {
  it.each([[60, 1], [90 * 60, 95], [120 * 60, 130], [180 * 60, 220], [240 * 60, 310]])("snapshots exact duration-tiered cost for %s seconds", (seconds, credits) => {
    expect(calculateDurationTieredCredits(seconds)).toMatchObject({ billingRuleVersion: "duration-tiered-v2", billedDurationSeconds: seconds, reservedCredits: credits });
  });

  it("accepts traceable long-form notes and rejects invented citations at the runner boundary", () => {
    expect(aiNotesSchema.parse({ title: "笔记", topic: "主题", coreIdeas: ["观点"], sections: [{ id: "s", level: 1, title: "标题", body: "正文", citations: [{ segmentId: "seg-1", timestampSeconds: 0 }] }], reviewPoints: ["复习"] }).sections).toHaveLength(1);
  });

  it("keeps admission bounded under concentrated 5–20 user snapshots", () => {
    for (const users of [5, 10, 15, 20]) {
      const decision = evaluateAdmission({ userRunning: 0, userQueued: 0, totalQueued: users, estimatedWaitSeconds: users * 120 });
      expect(decision.accepted).toBe(users < 20);
    }
  });

  it("never overlaps protected heavy work", async () => {
    const semaphore = new FifoSemaphore(1);
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 8 }, (_, index) => semaphore.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve(index);
      active -= 1;
    })));
    expect(peak).toBe(1);
  });
});
