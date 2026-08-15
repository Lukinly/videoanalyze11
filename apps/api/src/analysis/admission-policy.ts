export type AdmissionSnapshot = { userRunning: number; userQueued: number; totalQueued: number; estimatedWaitSeconds: number };
export type AdmissionLimits = { maxQueuedPerUser: number; maxTotalQueued: number; maxEstimatedWaitSeconds: number };

const defaultLimits: AdmissionLimits = { maxQueuedPerUser: 2, maxTotalQueued: 20, maxEstimatedWaitSeconds: 3_600 };

export function evaluateAdmission(snapshot: AdmissionSnapshot, limits: AdmissionLimits = defaultLimits):
  | { accepted: true; estimatedWaitSeconds: number }
  | { accepted: false; code: "USER_QUEUE_LIMIT" | "GLOBAL_QUEUE_LIMIT" | "QUEUE_WAIT_LIMIT"; message: string } {
  if (snapshot.userQueued >= limits.maxQueuedPerUser) return { accepted: false, code: "USER_QUEUE_LIMIT", message: "你已有两个分析在排队，请等待其中一个开始后再提交。" };
  if (snapshot.totalQueued >= limits.maxTotalQueued) return { accepted: false, code: "GLOBAL_QUEUE_LIMIT", message: "当前分析队列已满，请稍后重试。" };
  if (snapshot.estimatedWaitSeconds > limits.maxEstimatedWaitSeconds) return { accepted: false, code: "QUEUE_WAIT_LIMIT", message: "预计等待超过一小时，请稍后重试。" };
  return { accepted: true, estimatedWaitSeconds: Math.max(0, Math.round(snapshot.estimatedWaitSeconds)) };
}
