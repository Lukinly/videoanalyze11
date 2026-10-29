import { createHash } from "node:crypto";
import { DomainError } from "@videoanalyze/domain";

// Check every budget before incrementing any; TTLs and updates are atomic across API replicas.
const script = `
local retry = 0
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[(i-1)*2+1]) then
    retry = math.max(retry, redis.call('PTTL', key))
  end
end
if retry > 0 then return retry end
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('PEXPIRE', key, ARGV[(i-1)*2+2]) end
end
return 0`;

type Budget = { scope: string; identity: string; limit: number; windowMs: number };
export function createAuthRateLimiter(evaluate: (script: string, keys: string[], args: string[]) => Promise<unknown>, now = Date.now) {
  return async (budgets: Budget[]) => {
    const time = now();
    const keys = budgets.map((budget) => `auth-limit:${budget.scope}:${Math.floor(time / budget.windowMs)}:${createHash("sha256").update(budget.identity).digest("hex")}`);
    const args = budgets.flatMap((budget) => [String(budget.limit), String(budget.windowMs - time % budget.windowMs)]);
    let retry: number;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      retry = Number(await Promise.race([
        evaluate(script, keys, args),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("limit unavailable")), 2_000); timer.unref(); })
      ]));
    }
    catch { throw new DomainError("MAIL_UNAVAILABLE", "验证服务暂时不可用，请稍后重试", 503); }
    finally { clearTimeout(timer); }
    if (!Number.isFinite(retry)) throw new DomainError("MAIL_UNAVAILABLE", "验证服务暂时不可用，请稍后重试", 503);
    if (retry > 0) throw new DomainError("AUTH_RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
  };
}
