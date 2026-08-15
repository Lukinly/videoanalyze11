# 积分计费与管理员后台实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有固定试用次数升级为按视频大小扣费的积分系统，并提供人工充值、管理员账户、完整用户管理和审计后台。

**Architecture:** PostgreSQL 保存不可变的积分流水、临时扣费预留、充值申请和管理员审计记录。API 在创建分析任务前以数据库事务锁定用户并预留积分，worker 成功或失败后完成扣费或释放预留。Fastify 提供用户和管理员接口，React 提供余额/充值页面和管理员控制台。

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL 16, pg, pg-mem, React 19, Vite, Vitest, BullMQ/Redis, bcryptjs, Docker Compose。

## Global Constraints

- 十进制 MB：`1 MB = 1,000,000 bytes`。
- 解析费用：`max(1, ceil(file_size_bytes / 10,000,000))`。
- 邮箱验证成功后一次性发放 12 积分，幂等键为 `welcome:{userId}`。
- 充值第一阶段只支持用户申请、管理员审核，不接入真实支付。
- 最终积分变化写入追加式、不可变 `credit_ledger`；临时占用写入 `credit_reservations`。
- 所有分析预留使用 `run_id` 幂等，用户余额检查必须在事务和行锁保护下完成。
- 系统/API/provider 失败释放预留；处理开始前用户取消释放；处理开始后用户主动取消不退款；成功才写入正式扣费。
- 确认密码只用于请求校验，不进入 repository、日志或数据库。
- 管理员 API 必须在服务端验证当前会话、角色和账号状态；前端隐藏菜单不是权限控制。
- 最后一个可用管理员不能降级或禁用。
- 管理员不能查看密码或密码哈希；密码重置使用一次性、过期令牌。
- 不删除用户及积分/审计历史；禁用账号使用 `suspended` 软状态。
- 所有实现先写失败测试，使用 `corepack pnpm` 运行测试。

## 文件结构与职责

### 数据库和积分核心

- Create: `apps/api/src/credits/credit-cost.ts` — 唯一的费用计算纯函数。
- Test: `apps/api/src/credits/credit-cost.test.ts` — 费用边界测试。
- Create: `apps/api/src/db/migrations/0002_credit_billing_admin.sql` — 生产数据库迁移。
- Create: `apps/api/src/db/migrate.ts` — 按顺序执行并记录 SQL 迁移。
- Modify: `apps/api/src/db/schema.ts` — Drizzle 表定义。
- Modify: `apps/api/src/db/test-database.ts` — pg-mem 测试表结构。
- Create: `apps/api/src/db/repositories/credits.ts` — 流水、预留和余额事务。
- Test: `apps/api/src/db/repositories/credits.test.ts` — 并发/幂等/退款测试。

### 认证和管理员后端

- Modify: `apps/api/src/auth/auth-service.ts` — 确认密码、12 积分赠送、账号状态、密码重置。
- Modify: `apps/api/src/auth/tokens.ts` — 复用安全随机令牌和哈希。
- Create: `apps/api/src/auth/authorization.ts` — `requireAdmin` 和管理员检查。
- Modify: `apps/api/src/db/repositories/users.ts` — 角色、状态、用户列表和密码更新。
- Create: `apps/api/src/db/repositories/admin.ts` — 充值申请和审计记录。
- Create: `apps/api/src/routes/credits.ts` — 用户余额、流水和充值申请。
- Create: `apps/api/src/routes/admin.ts` — 管理员接口。
- Create: `apps/api/src/cli/admin-create.ts` — 一次性管理员创建命令。
- Modify: `apps/api/src/routes/auth.ts` — 确认密码和密码重置路由。
- Modify: `apps/api/src/app.ts` — 注册新路由和错误边界。
- Modify: `apps/api/package.json`, `package.json` — CLI 入口。

### 分析计费

- Modify: `apps/api/src/analysis/analysis-service.ts` — 根据视频大小预留积分。
- Modify: `apps/api/src/storage/upload-service.ts` — 返回费用预估。
- Modify: `apps/worker/src/worker-main.ts` — 成功扣费、失败释放、取消处理。
- Modify: `apps/worker/src/analysis/v0-runner.ts` — 在可安全位置检查取消。
- Test: `apps/api/src/analysis/analysis-service.test.ts`, `apps/worker/src/queue/analysis-consumer.test.ts` — 计费生命周期测试。

### 前端

- Modify: `apps/web/src/api/client.ts` — 积分、充值、管理员 API 类型和方法。
- Modify: `apps/web/src/auth/RegisterPage.tsx` — 确认密码输入和前端拦截。
- Create: `apps/web/src/credits/CreditsPanel.tsx` — 余额、流水、费用和充值申请。
- Create: `apps/web/src/admin/AdminPage.tsx` — 用户、充值申请、积分调整和审计界面。
- Create: `apps/web/src/auth/ResetPasswordPage.tsx` — 强制/令牌密码重置。
- Modify: `apps/web/src/app.tsx`, `apps/web/src/library/UploadVideo.tsx`, `apps/web/src/styles.css` — 路由、余额和费用展示。
- Test: `apps/web/src/auth/RegisterPage.test.tsx`, `apps/web/src/credits/CreditsPanel.test.tsx`, `apps/web/src/admin/AdminPage.test.tsx`。

---

### Task 1: 实现费用计算纯函数

**Files:**
- Create: `apps/api/src/credits/credit-cost.ts`
- Test: `apps/api/src/credits/credit-cost.test.ts`

**Interfaces:**
- Produces: `calculateAnalysisCost(fileSizeBytes: number): number`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { calculateAnalysisCost } from "./credit-cost.js";

describe("calculateAnalysisCost", () => {
  it("charges one point for a file up to 10 MB", () => {
    expect(calculateAnalysisCost(1)).toBe(1);
    expect(calculateAnalysisCost(10_000_000)).toBe(1);
  });

  it("rounds every additional 10 MB upward", () => {
    expect(calculateAnalysisCost(10_000_001)).toBe(2);
    expect(calculateAnalysisCost(20_000_000)).toBe(2);
    expect(calculateAnalysisCost(100_000_000)).toBe(10);
  });

  it("rejects non-finite or negative sizes", () => {
    expect(() => calculateAnalysisCost(0)).toThrow("file size must be positive");
    expect(() => calculateAnalysisCost(-1)).toThrow("file size must be positive");
    expect(() => calculateAnalysisCost(Number.NaN)).toThrow("file size must be positive");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `corepack pnpm vitest run apps/api/src/credits/credit-cost.test.ts`

Expected: FAIL because `credit-cost.ts` and `calculateAnalysisCost` do not exist.

- [ ] **Step 3: 写最小实现**

```ts
const BYTES_PER_BILLING_UNIT = 10_000_000;

export function calculateAnalysisCost(fileSizeBytes: number): number {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new Error("file size must be positive");
  }
  return Math.max(1, Math.ceil(fileSizeBytes / BYTES_PER_BILLING_UNIT));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `corepack pnpm vitest run apps/api/src/credits/credit-cost.test.ts`

Expected: PASS.

- [ ] **Step 5: 提交独立变更**

```bash
git add apps/api/src/credits/credit-cost.ts apps/api/src/credits/credit-cost.test.ts
git commit -m "feat: add size-based analysis cost calculation"
```

### Task 2: 建立积分数据库模型和事务 repository

**Files:**
- Create: `apps/api/src/db/migrations/0002_credit_billing_admin.sql`
- Create: `apps/api/src/db/migrate.ts`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/test-database.ts`
- Create: `apps/api/src/db/repositories/credits.ts`
- Test: `apps/api/src/db/repositories/credits.test.ts`
- Modify: `apps/api/src/db/repositories/index.ts`

**Interfaces:**
- Produces `CreditRepository`:

```ts
type CreditRepository = {
  getBalance(userId: string): Promise<{ ledgerBalance: number; held: number; available: number }>;
  listLedger(userId: string, limit: number): Promise<CreditLedgerRecord[]>;
  grant(input: { userId: string; amount: number; type: "welcome_grant" | "admin_grant" | "admin_debit" | "refund"; referenceId?: string; idempotencyKey: string; reason: string; createdBy?: string }): Promise<void>;
  reserveAnalysis(input: { userId: string; runId: string; amount: number }): Promise<"held" | "already_held" | "exhausted">;
  consumeReservation(runId: string): Promise<void>;
  releaseReservation(runId: string, reason: string): Promise<void>;
};
```
- Consumes: the existing `pg.Pool` and `videos/users` foreign keys.

- [ ] **Step 1: 写迁移和 repository 的失败测试**

Add the new tables to `migrateTestDatabase` only enough for the tests to run after the production SQL is defined. Add tests covering:

```ts
it("adds a grant to the available balance exactly once", async () => {
  await repositories.credits.grant({ userId: user.id, amount: 12, type: "welcome_grant", idempotencyKey: `welcome:${user.id}`, reason: "email_verified" });
  await repositories.credits.grant({ userId: user.id, amount: 12, type: "welcome_grant", idempotencyKey: `welcome:${user.id}`, reason: "email_verified" });
  await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ available: 12 });
});

it("does not allow two reservations to spend the same balance", async () => {
  await repositories.credits.grant({ userId: user.id, amount: 12, type: "welcome_grant", idempotencyKey: `welcome:${user.id}`, reason: "email_verified" });
  const result = await Promise.all([
    repositories.credits.reserveAnalysis({ userId: user.id, runId: "run_a", amount: 10 }),
    repositories.credits.reserveAnalysis({ userId: user.id, runId: "run_b", amount: 10 })
  ]);
  expect(result.sort()).toEqual(["exhausted", "held"]);
  await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ available: 2, held: 10 });
});

it("releases a failed reservation without creating a debit", async () => {
  await repositories.credits.grant({ userId: user.id, amount: 12, type: "welcome_grant", idempotencyKey: `welcome:${user.id}`, reason: "email_verified" });
  await repositories.credits.reserveAnalysis({ userId: user.id, runId: "run_a", amount: 2 });
  await repositories.credits.releaseReservation("run_a", "provider_failed");
  await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ ledgerBalance: 12, held: 0, available: 12 });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `corepack pnpm vitest run apps/api/src/db/repositories/credits.test.ts`

Expected: FAIL because the new repository and tables are absent.

- [ ] **Step 3: 写生产迁移**

`0002_credit_billing_admin.sql` must be idempotent and add:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended'));

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  type TEXT NOT NULL CHECK (type IN ('welcome_grant', 'admin_grant', 'admin_debit', 'analysis_charge', 'refund')),
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK ((type IN ('welcome_grant', 'admin_grant', 'refund') AND amount > 0) OR
         (type IN ('admin_debit', 'analysis_charge') AND amount < 0))
);
CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('held', 'consumed', 'released')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  release_reason TEXT
);
CREATE TABLE IF NOT EXISTS credit_topup_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_amount INTEGER NOT NULL CHECK (requested_amount > 0),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES users(id),
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id),
  target_record_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
```

Use foreign keys to `users`, `analysis_runs` where applicable, unique indexes for `run_id` and idempotency keys, and checks for positive reservation amounts and valid statuses. Do not drop `usage_ledger`.

- [ ] **Step 4: Implement the migration runner**

Create `migrate.ts` that:

1. connects using `DATABASE_URL`;
2. creates `schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL)`;
3. reads `0001_initial.sql` and `0002_credit_billing_admin.sql` in lexical order;
4. runs each unapplied file in a transaction;
5. records the version only after the SQL succeeds;
6. closes the pool and exits non-zero on failure.

Do not re-run a migration already recorded. Keep all migration SQL idempotent for recovery from the current init-script deployment.

- [ ] **Step 5: Implement the transaction repository**

`reserveAnalysis` must use one transaction:

```sql
BEGIN;
SELECT id FROM users WHERE id = $1 FOR UPDATE;
SELECT status FROM credit_reservations WHERE run_id = $2;
-- if an existing held/consumed row exists, return already_held
-- otherwise compute ledger sum minus held reservations
-- return 'exhausted' when the computed available amount is less than $4
INSERT INTO credit_reservations
  (id, user_id, run_id, amount, status, idempotency_key, created_at)
VALUES ($3, $1, $2, $4, 'held', $5, NOW());
COMMIT;
```

`consumeReservation` must insert one negative `analysis_charge` ledger row and mark the reservation consumed in the same transaction. `releaseReservation` must mark only a held reservation released, preserving the reason. `grant` must use `ON CONFLICT (idempotency_key) DO NOTHING`.

- [ ] **Step 6: Run repository tests**

Run: `corepack pnpm vitest run apps/api/src/credits apps/api/src/db/repositories/credits.test.ts`

Expected: PASS, including the concurrent reservation test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/migrations/0002_credit_billing_admin.sql apps/api/src/db/migrate.ts apps/api/src/db/schema.ts apps/api/src/db/test-database.ts apps/api/src/db/repositories/credits.ts apps/api/src/db/repositories/credits.test.ts apps/api/src/db/repositories/index.ts
git commit -m "feat: add transactional credit ledger"
```

### Task 3: Update authentication and account security

**Files:**
- Modify: `apps/api/src/auth/auth-service.ts`
- Modify: `apps/api/src/auth/tokens.ts`
- Modify: `apps/api/src/db/repositories/users.ts`
- Modify: `apps/api/src/db/repositories/auth.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/domain/src/auth.ts`
- Modify/Test: `apps/api/src/auth/auth.test.ts`, `apps/api/src/routes/auth.test.ts`
- Create: `apps/api/src/cli/admin-create.ts`
- Modify: `apps/api/package.json`, `package.json`

**Interfaces:**
- `AuthServiceContract.register(input)` accepts `{ email, password, confirmPassword }`.
- `publicUserSchema` includes `role`, `status`, and `mustChangePassword` without exposing hashes.
- `authenticate` rejects `suspended` users with `ACCOUNT_SUSPENDED`.

- [ ] **Step 1: Write failing auth tests**

Add tests before changing service code:

```ts
it("rejects mismatched registration passwords before creating a user", async () => {
  await expect(auth.register({ email: "user@example.com", password: "correct horse battery staple", confirmPassword: "different password" }))
    .rejects.toMatchObject({ code: "PASSWORD_MISMATCH", status: 400 });
  expect(repositories.users.create).not.toHaveBeenCalled();
  expect(mailer.sendVerification).not.toHaveBeenCalled();
});

it("grants exactly twelve points after first email verification", async () => {
  const registered = await auth.register({ email: "user@example.com", password: "correct horse battery staple", confirmPassword: "correct horse battery staple" });
  const token = mailer.sendVerification.mock.calls[0][0].token as string;
  expect((await auth.verifyEmail(token)).trialCreditsGranted).toBe(true);
  expect((await auth.verifyEmail(token)).trialCreditsGranted).toBe(false);
  await expect(repositories.credits.getBalance(registered.userId)).resolves.toMatchObject({ available: 12 });
});

it("rejects suspended users at authentication time", async () => {
  await repositories.users.setStatus(userId, "suspended");
  await expect(auth.authenticate(sessionToken)).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
});
```

- [ ] **Step 2: Run auth tests to verify RED**

Run: `corepack pnpm vitest run apps/api/src/auth/auth.test.ts apps/api/src/routes/auth.test.ts`

Expected: FAIL because the request shape, 12-point grant, status, and role fields do not exist.

- [ ] **Step 3: Implement registration and verification changes**

Validate `confirmPassword` immediately after the password length check. Throw:

```ts
new DomainError("PASSWORD_MISMATCH", "passwords do not match", 400)
```

On successful verification, call `credits.grant({ userId, amount: 12, type: "welcome_grant", idempotencyKey: `welcome:${userId}`, reason: "email_verified" })`. Keep the existing verification record idempotency guard.

- [ ] **Step 4: Implement role/status and password-reset repository methods**

Add methods with exact behavior:

```ts
findById(id): Promise<UserRecord | null>
list(input): Promise<UserRecord[]>
setRole(id, role): Promise<void>
setStatus(id, status): Promise<void>
setMustChangePassword(id, value): Promise<void>
updatePassword(id, passwordHash): Promise<void>
```

Add auth repository methods to create/find/consume password reset tokens using SHA-256 token hashes and expiry checks. Never return `passwordHash` from public user objects.

- [ ] **Step 5: Implement the one-time admin CLI**

Create a CLI that parses `--email`, prompts for the password without echo, validates the email and minimum 8-character password, refuses to overwrite an existing user, creates a verified `admin`/`active` user, and exits non-zero on invalid input. Add:

```json
"admin:create": "tsx src/cli/admin-create.ts"
```

Use the existing TypeScript compiler: add `"admin:create": "pnpm build && node dist/cli/admin-create.js"` to `apps/api/package.json` and `"admin:create": "pnpm --filter @videoanalyze/api admin:create"` to the root `package.json`. Do not add `tsx`.

- [ ] **Step 6: Implement reset routes and tests**

Add:

```text
POST /api/auth/password-reset
POST /api/auth/change-password
```

The reset route accepts a one-time token and a new password. The authenticated change route clears `must_change_password`. Both routes validate minimum length and never return a password.

- [ ] **Step 7: Run auth tests and commit**

Run: `corepack pnpm vitest run apps/api/src/auth apps/api/src/routes/auth.test.ts`

Expected: PASS.

```bash
git add apps/api/src/auth apps/api/src/db/repositories/users.ts apps/api/src/db/repositories/auth.ts apps/api/src/routes/auth.ts apps/api/src/app.ts packages/domain/src/auth.ts apps/api/src/cli apps/api/package.json package.json
git commit -m "feat: add account roles and secure password reset"
```

### Task 4: Integrate size-based reservations into analysis

**Files:**
- Modify: `apps/api/src/analysis/analysis-service.ts`
- Modify: `apps/api/src/analysis/analysis-service.test.ts`
- Modify: `apps/api/src/storage/upload-service.ts`
- Modify: `apps/api/src/routes/uploads.ts`
- Modify: `apps/api/src/db/repositories/videos.ts`
- Modify: `apps/worker/src/worker-main.ts`
- Modify: `apps/worker/src/analysis/v0-runner.ts`
- Create/Test: `apps/worker/src/analysis/cancellation.ts`, `apps/worker/src/analysis/cancellation.test.ts`

**Interfaces:**
- `videos.findOwnedById` returns `{ id, userId, fileSize }`.
- `analysisService.start` returns `{ id, status, estimatedCost }`.
- `CreditRepository.reserveAnalysis` is called with the server-stored file size cost.

- [ ] **Step 1: Write failing analysis billing tests**

Add service tests:

```ts
it("reserves the cost calculated from the stored video size", async () => {
  videos.findOwnedById.mockResolvedValue({ id: "video_1", userId: "user_1", fileSize: 100_000_000 });
  usage.reserveAnalysis.mockResolvedValue("held");
  const run = await service.start({ userId: "user_1", videoId: "video_1" });
  expect(usage.reserveAnalysis).toHaveBeenCalledWith({ userId: "user_1", runId: run.id, amount: 10 });
});

it("releases the reservation when run creation or queueing fails", async () => {
  videos.findOwnedById.mockResolvedValue({ id: "video_1", userId: "user_1", fileSize: 20_000_000 });
  usage.reserveAnalysis.mockResolvedValue("held");
  runs.create.mockRejectedValue(new Error("database unavailable"));
  await expect(service.start({ userId: "user_1", videoId: "video_1" })).rejects.toThrow("database unavailable");
  expect(usage.releaseReservation).toHaveBeenCalledWith(expect.any(String), "analysis creation failed");
});

it("rejects when available points are insufficient", async () => {
  videos.findOwnedById.mockResolvedValue({ id: "video_1", userId: "user_1", fileSize: 100_000_000 });
  usage.reserveAnalysis.mockResolvedValue("exhausted");
  await expect(service.start({ userId: "user_1", videoId: "video_1" })).rejects.toMatchObject({ code: "CREDITS_EXHAUSTED", status: 402 });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm vitest run apps/api/src/analysis/analysis-service.test.ts`

Expected: FAIL because the service does not read `fileSize` or reserve variable costs.

- [ ] **Step 3: Implement API reservation flow**

Generate `runId`, read the owned video, calculate cost with `calculateAnalysisCost`, reserve before creating the run, create the run and queue job, and release on any creation/queueing error. Return the cost in the accepted response. Map exhausted reservations to `CREDITS_EXHAUSTED` and include `{ required, available }` only if the repository exposes a safe balance snapshot.

- [ ] **Step 4: Return upload cost estimate**

Have `createUploadService.start` calculate `estimatedCost` from the validated `contentLength` and return it with the upload session. The analysis endpoint remains authoritative and recalculates from `videos.file_size`.

- [ ] **Step 5: Implement worker settlement**

Create the worker-side credit repository using the same PostgreSQL tables. On successful runner completion call `consumeReservation(runId)`. In the catch path, mark the run failed and call `releaseReservation(runId, "analysis_failed")` unless the error represents a user cancellation after processing started. Ensure settlement errors are logged and do not create a second charge on retry.

- [ ] **Step 6: Implement cancellation classification**

Add a small cancellation helper used by the runner/worker:

```ts
type CancellationOutcome = "before_processing" | "after_processing";
```

Check `analysis_runs.status = 'cancelling'` before media work and before each chunk. A cancellation before the first processing stage releases the reservation; a cancellation after processing has started consumes it and marks the run `cancelled`.

- [ ] **Step 7: Run API/worker billing tests**

Run: `corepack pnpm vitest run apps/api/src/analysis apps/worker/src/analysis apps/worker/src/queue`

Expected: PASS, including successful charge, provider failure refund, pre-processing cancel refund, post-processing cancel charge, and idempotent retry behavior.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/analysis apps/api/src/storage/upload-service.ts apps/api/src/routes/uploads.ts apps/api/src/db/repositories/videos.ts apps/worker/src/worker-main.ts apps/worker/src/analysis
git commit -m "feat: charge analysis credits by video size"
```

### Task 5: Add user credits and administrator APIs

**Files:**
- Create: `apps/api/src/auth/authorization.ts`
- Create: `apps/api/src/db/repositories/admin.ts`
- Create: `apps/api/src/routes/credits.ts`
- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/db/repositories/users.ts`
- Modify: `apps/api/src/db/repositories/index.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/credits.test.ts`, `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- `requireAdmin(authService, request): Promise<{ id: string; role: "admin" }>` throws/returns `UNAUTHORIZED` or `FORBIDDEN`.
- `adminRepository` owns top-up requests and audit writes.
- Admin credit adjustments call `credits.grant` and `adminRepository.createAudit` in one transaction.

- [ ] **Step 1: Write failing authorization and route tests**

Cover:

```ts
it("denies a normal user from every admin route", async () => {
  authService.authenticate.mockResolvedValue({ id: "user_1", role: "user", status: "active" });
  const response = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: "video_session=session" } });
  expect(response.statusCode).toBe(403);
});

it("approving a top-up creates one grant and one audit event", async () => {
  const response = await app.inject({ method: "POST", url: "/api/admin/credit-requests/request_1/approve", headers: { cookie: "video_session=admin-session" }, payload: { note: "bank transfer received" } });
  expect(response.statusCode).toBe(200);
  expect(credits.grant).toHaveBeenCalledWith(expect.objectContaining({ type: "admin_grant", amount: 50 }));
  expect(adminRepository.createAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "approve_topup" }));
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm vitest run apps/api/src/routes/credits.test.ts apps/api/src/routes/admin.test.ts`

Expected: FAIL because the routes and authorization helper do not exist.

- [ ] **Step 3: Implement user credit endpoints**

Implement:

```text
GET  /api/credits              -> { ledgerBalance, held, available }
GET  /api/credits/ledger      -> paginated user-owned ledger entries
POST /api/credit-requests     -> creates positive pending request
GET  /api/credit-requests     -> lists current user’s own requests
```

Reject non-positive or unsafe amounts, cap page sizes, and never allow a user to choose `createdBy`, `type`, status, or target user.

- [ ] **Step 4: Implement admin user and credit endpoints**

Implement the routes from the spec. Use server-side target lookup and transactions. `POST /api/admin/users/:id/credits` accepts `{ direction: "grant" | "debit", amount, reason, idempotencyKey }`; the server converts it to a signed ledger amount and writes an audit record. Reject changing the final active admin.

- [ ] **Step 5: Implement top-up approval/rejection**

Approval must lock the request row, require `pending`, create exactly one `admin_grant`, mark approved, and audit in one transaction. Rejection marks rejected with a required reason and creates no credit ledger row.

- [ ] **Step 6: Implement audit and user status routes**

Return only the metadata needed for administration. Enforce that suspended users cannot use upload/analysis routes by reusing the authenticated user check rather than relying only on login.

- [ ] **Step 7: Run API tests and commit**

Run: `corepack pnpm vitest run apps/api/src/routes/credits.test.ts apps/api/src/routes/admin.test.ts apps/api/src/auth`

Expected: PASS, including normal-user denial, idempotent approval, positive/negative adjustments, role/status protection, and audit records.

```bash
git add apps/api/src/auth/authorization.ts apps/api/src/db/repositories/admin.ts apps/api/src/routes/credits.ts apps/api/src/routes/admin.ts apps/api/src/db/repositories/users.ts apps/api/src/db/repositories/index.ts apps/api/src/app.ts apps/api/src/routes/credits.test.ts apps/api/src/routes/admin.test.ts
git commit -m "feat: add credit and admin APIs"
```

### Task 6: Build user credit and registration UI

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/auth/RegisterPage.tsx`
- Create: `apps/web/src/auth/RegisterPage.test.tsx`
- Create: `apps/web/src/credits/CreditsPanel.tsx`
- Create: `apps/web/src/credits/CreditsPanel.test.tsx`
- Modify: `apps/web/src/library/UploadVideo.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `api.getCredits(): Promise<CreditBalance>`.
- `api.createCreditRequest(input): Promise<CreditTopupRequest>`.
- `api.register(input)` sends `{ email, password, confirmPassword }`.
- `UploadedVideo` includes `{ estimatedCost, fileSize }`.

- [ ] **Step 1: Write failing component tests**

```tsx
it("blocks registration when passwords do not match", async () => {
  const register = vi.spyOn(api, "register");
  render(<RegisterPage onLogin={() => undefined} />);
  await userEvent.type(screen.getByLabelText("密码"), "correct horse battery staple");
  await userEvent.type(screen.getByLabelText("确认密码"), "different password");
  await userEvent.click(screen.getByRole("button", { name: "创建账号" }));
  expect(screen.getByText("两次输入的密码不一致")).toBeVisible();
  expect(register).not.toHaveBeenCalled();
});

it("shows the current balance and allows a top-up request", async () => {
  vi.spyOn(api, "getCredits").mockResolvedValue({ ledgerBalance: 12, held: 2, available: 10 });
  render(<CreditsPanel />);
  expect(await screen.findByText("10 积分")).toBeVisible();
  expect(screen.getByRole("button", { name: "提交充值申请" })).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm vitest run apps/web/src/auth/RegisterPage.test.tsx apps/web/src/credits/CreditsPanel.test.tsx`

Expected: FAIL because the confirm field, API methods, and panel do not exist.

- [ ] **Step 3: Implement API client types and methods**

Add typed methods for credits, ledger, and top-up requests. Preserve `credentials: "include"` and map API error codes to the existing `ApiError`.

- [ ] **Step 4: Implement registration confirmation**

Add `confirmPassword` state and a `new-password` input. Compare before setting busy or invoking `api.register`; then send the complete request. Keep the backend as the authoritative second check.

- [ ] **Step 5: Implement CreditsPanel and upload cost display**

Show available points, held points, recent ledger rows, the current video’s estimated cost, and a form for a positive top-up request with a note. Disable the analysis action or display an actionable insufficient-balance error when `available < estimatedCost`.

- [ ] **Step 6: Integrate balance refresh into App**

Load credits after authentication, pass balance refresh callbacks to `Workspace`, refresh after analysis completion and after a top-up request, and keep the main media workflow unchanged.

- [ ] **Step 7: Run web tests and commit**

Run: `corepack pnpm vitest run apps/web/src/auth/RegisterPage.test.tsx apps/web/src/credits/CreditsPanel.test.tsx`

Expected: PASS.

```bash
git add apps/web/src/api/client.ts apps/web/src/auth/RegisterPage.tsx apps/web/src/auth/RegisterPage.test.tsx apps/web/src/credits apps/web/src/library/UploadVideo.tsx apps/web/src/app.tsx apps/web/src/styles.css
git commit -m "feat: add user credit experience"
```

### Task 7: Build the administrator console and password reset UI

**Files:**
- Create: `apps/web/src/admin/AdminPage.tsx`
- Create: `apps/web/src/admin/AdminPage.test.tsx`
- Create: `apps/web/src/auth/ResetPasswordPage.tsx`
- Create: `apps/web/src/auth/ResetPasswordPage.test.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Admin API methods are available from Task 5.
- `PublicUser.role` and `PublicUser.status` drive route visibility only; every operation still relies on API authorization.

- [ ] **Step 1: Write failing admin UI tests**

```tsx
it("renders user management and top-up review controls for an admin", async () => {
  vi.spyOn(api, "listAdminUsers").mockResolvedValue({ items: [{ id: "u1", email: "user@example.com", role: "user", status: "active", availableCredits: 12 }] });
  vi.spyOn(api, "listAdminCreditRequests").mockResolvedValue({ items: [] });
  render(<AdminPage />);
  expect(await screen.findByText("user@example.com")).toBeVisible();
  expect(screen.getByRole("button", { name: "调整积分" })).toBeVisible();
});

it("submits a reset password form", async () => {
  const reset = vi.spyOn(api, "resetPassword").mockResolvedValue({ ok: true });
  render(<ResetPasswordPage token="reset-token" onDone={() => undefined} />);
  await userEvent.type(screen.getByLabelText("新密码"), "new secure password");
  await userEvent.type(screen.getByLabelText("确认密码"), "new secure password");
  await userEvent.click(screen.getByRole("button", { name: "保存新密码" }));
  expect(reset).toHaveBeenCalledWith({ token: "reset-token", password: "new secure password", confirmPassword: "new secure password" });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm vitest run apps/web/src/admin/AdminPage.test.tsx apps/web/src/auth/ResetPasswordPage.test.tsx`

Expected: FAIL because the components and client methods do not exist.

- [ ] **Step 3: Implement admin API client methods**

Add typed list/detail/role/status/credit/reset/top-up/audit methods. Ensure mutations require a reason and refresh the affected list after success.

- [ ] **Step 4: Implement AdminPage**

Create a focused admin console with tabs or sections for users, pending top-ups, and audit logs. Each mutation uses a confirmation state, requires a reason where specified, displays API errors, and never renders password hashes or reset tokens.

- [ ] **Step 5: Implement reset-password page and routing**

Handle `/reset-password?token=<token>`, validate password and confirmation locally, call the API, and return to login after success. If the authenticated user has `mustChangePassword`, route them to the same change-password form without exposing a token.

- [ ] **Step 6: Run UI tests and commit**

Run: `corepack pnpm vitest run apps/web/src/admin apps/web/src/auth/ResetPasswordPage.test.tsx`

Expected: PASS.

```bash
git add apps/web/src/admin apps/web/src/auth/ResetPasswordPage.tsx apps/web/src/auth/ResetPasswordPage.test.tsx apps/web/src/api/client.ts apps/web/src/app.tsx apps/web/src/styles.css
git commit -m "feat: add administrator console"
```

### Task 8: Wire migrations, Compose startup, docs, and full verification

**Files:**
- Modify: `apps/api/Dockerfile`
- Modify: `infra/docker-compose.yml`
- Modify: `docs/operations.md`
- Modify: root and API `package.json` scripts for migration and admin creation
- Test: `tests/acceptance/v0-v1.acceptance.test.ts`, `tests/acceptance/credit-admin.acceptance.test.ts`, and `tests/acceptance/deployment-config.test.ts`

- [ ] **Step 1: Write deployment/configuration checks**

Create `tests/acceptance/deployment-config.test.ts` with `readFileSync` assertions that `apps/api/Dockerfile` copies `apps/api/src/db/migrations` into the runtime image, `infra/docker-compose.yml` defines a `migrate` service running `node dist/db/migrate.js`, and both `api` and `worker` depend on `migrate` with `condition: service_completed_successfully`.

- [ ] **Step 2: Run the check to verify RED**

Run: `corepack pnpm vitest run tests/acceptance`

Expected: the new migration/admin/credit acceptance cases fail before the Compose and deployment wiring is complete.

- [ ] **Step 3: Wire migration execution**

Copy compiled migration runner and SQL files into the API runtime image. Add a Compose `migrate` service that waits for PostgreSQL health, runs `node dist/db/migrate.js`, and make `api` and `worker` depend on successful migration completion. Keep Postgres named volumes unchanged.

- [ ] **Step 4: Add operations documentation**

Document:

```bash
corepack pnpm admin:create --email admin@example.com
sudo docker compose -f infra/docker-compose.yml up -d --build
sudo docker compose -f infra/docker-compose.yml logs -f migrate api worker
```

Document that `down` preserves named volumes, `down -v` deletes user/video data, and migration files must not be edited after they are applied.

- [ ] **Step 5: Run focused verification**

Run:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:acceptance
docker compose -f infra/docker-compose.yml config --quiet
```

Expected: all commands exit 0. If Docker socket permissions block the image build, report that limitation explicitly and still run the non-Docker checks.

- [ ] **Step 6: Review data safety**

Before any local reset, back up PostgreSQL and verify that no command uses `down -v`, `docker volume rm`, or a destructive database reset. Confirm that the migration preserves existing `usage_ledger` rows and existing user/video volumes.

- [ ] **Step 7: Final commit**

```bash
git add apps/api/Dockerfile infra/docker-compose.yml docs/operations.md README.md tests
git commit -m "feat: wire credit billing and admin deployment"
```

## Plan Self-Review

- Spec coverage: pricing, 12-point verification grant, immutable ledger, reservations, settlement rules, manual top-ups, admin bootstrap, user management, password reset, UI, migration, audit, and tests are mapped to Tasks 1–8.
- Placeholder scan: no unresolved feature choices are left; real payment is explicitly out of scope.
- Type consistency: `CreditRepository`, `calculateAnalysisCost`, `confirmPassword`, `role`, `status`, reservation states, and API paths are named consistently across tasks.
- Safety check: existing `usage_ledger` and named volumes are preserved; no destructive reset is part of the plan.
