export const BILLING_RULE_VERSION = "duration-tiered-v2" as const;
export const MAX_VIDEO_DURATION_SECONDS = 14_400;

export type BillingSnapshot = {
  billingRuleVersion: typeof BILLING_RULE_VERSION;
  billedDurationSeconds: number;
  billedMinutes: number;
  reservedCredits: number;
};

export function calculateDurationTieredCredits(durationSeconds: number): BillingSnapshot {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(`video duration must be greater than zero and at most ${MAX_VIDEO_DURATION_SECONDS} seconds`);
  }
  const billedMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
  const tier1Minutes = Math.min(billedMinutes, 60);
  const tier2Minutes = Math.min(Math.max(billedMinutes - 60, 0), 60);
  const tier3Minutes = Math.min(Math.max(billedMinutes - 120, 0), 120);
  const sixths = tier1Minutes * 6 + tier2Minutes * 7 + tier3Minutes * 9;
  return {
    billingRuleVersion: BILLING_RULE_VERSION,
    billedDurationSeconds: durationSeconds,
    billedMinutes,
    reservedCredits: Math.ceil(sixths / 6)
  };
}
