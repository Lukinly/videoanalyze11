# Admin Top-up Applicant Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the applicant email, user ID, request time, amount, and note on every administrator top-up request.

**Architecture:** Extend only the administrator repository list query with a `LEFT JOIN users`, returning `userEmail` alongside the existing top-up record. Preserve the route pass-through behavior, update the Web API type, and render the identity fields in the existing administrator list.

**Tech Stack:** TypeScript, PostgreSQL, pg/pg-mem, Fastify 5, React 19, Vitest, Testing Library.

## Global Constraints

- Do not add or modify database migrations.
- Approval and rejection continue to use the stored `userId`; email is display-only.
- Ordinary users' top-up request response contract does not require `userEmail`.
- Missing joined users display as `未知用户`, while the request's `userId` remains visible.
- Do not change credit grant, approval, rejection, or audit semantics.

---

### Task 1: Repository Applicant Email

**Files:**
- Modify: `apps/api/src/db/repositories/admin.ts`
- Test: `apps/api/src/db/repositories/admin.test.ts`

**Interfaces:**
- Consumes: `credit_topup_requests.user_id` and `users.id/email`.
- Produces: `AdminTopupRecord = TopupRecord & { userEmail: string | null }` from `listTopups`.

- [ ] **Step 1: Write the failing repository test**

```ts
it("lists a top-up with its applicant email", async () => {
  const user = await repositories.users.create({ email: "applicant@example.com", passwordHash: "hash" });
  await repositories.admin.createTopup({ userId: user.id, requestedAmount: 30, note: "transfer" });

  await expect(repositories.admin.listTopups({ status: "pending" })).resolves.toMatchObject([
    { userId: user.id, userEmail: "applicant@example.com", requestedAmount: 30 }
  ]);
});
```

- [ ] **Step 2: Run the repository test and verify it fails**

Run: `corepack pnpm --filter @videoanalyze/api exec vitest run src/db/repositories/admin.test.ts`

Expected: FAIL because `userEmail` is absent.

- [ ] **Step 3: Implement the joined administrator list query**

Add:

```ts
export type AdminTopupRecord = TopupRecord & { userEmail: string | null };
```

Change only `listTopups` to select aliased request columns and `u.email AS "userEmail"`:

```sql
SELECT r.id, r.user_id AS "userId", u.email AS "userEmail",
       r.requested_amount AS "requestedAmount", r.note, r.status,
       r.reviewed_by AS "reviewedBy", r.review_note AS "reviewNote",
       r.created_at AS "createdAt", r.reviewed_at AS "reviewedAt"
FROM credit_topup_requests r
LEFT JOIN users u ON u.id = r.user_id
```

Prefix dynamic predicates and ordering columns with `r.`.

- [ ] **Step 4: Run the repository test and verify it passes**

Run: `corepack pnpm --filter @videoanalyze/api exec vitest run src/db/repositories/admin.test.ts`

Expected: PASS.

### Task 2: Administrator API Contract

**Files:**
- Modify: `apps/api/src/routes/admin.test.ts`
- Modify: `apps/api/src/routes/admin.ts`

**Interfaces:**
- Consumes: `adminRepository.listTopups()` records with `userId` and `userEmail`.
- Produces: `GET /api/admin/credit-requests` response `{ items: AdminTopupRecord[] }` without transformation.

- [ ] **Step 1: Write the failing route response test**

```ts
it("returns the applicant identity for top-up review", async () => {
  adminRepository.listTopups.mockResolvedValueOnce([{
    id: "request_1", userId: "user_1", userEmail: "applicant@example.com",
    requestedAmount: 30, note: "transfer", status: "pending",
    reviewedBy: null, reviewNote: null, createdAt: "2026-08-11T00:00:00.000Z", reviewedAt: null
  }]);
  authService.authenticate.mockResolvedValue({ id: "admin_1", role: "admin", status: "active" });
  const response = await app.inject({ method: "GET", url: "/api/admin/credit-requests", headers: { cookie: "video_session=admin-session" } });
  expect(response.json()).toMatchObject({ items: [{ userId: "user_1", userEmail: "applicant@example.com" }] });
});
```

- [ ] **Step 2: Run the route test**

Run: `corepack pnpm --filter @videoanalyze/api exec vitest run src/routes/admin.test.ts`

Expected: PASS because the route intentionally passes repository records through; this is a contract characterization test rather than a production change trigger.

- [ ] **Step 3: Tighten the route dependency type**

Replace the `unknown[]` result type for `listTopups` with an imported or structural array type containing `userId: string` and `userEmail: string | null`, ensuring future route changes preserve the administrator contract.

- [ ] **Step 4: Run API type checking**

Run: `corepack pnpm --filter @videoanalyze/api exec tsc -p tsconfig.json --noEmit`

Expected: PASS.

### Task 3: Administrator Request Presentation

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/admin/AdminPage.tsx`
- Test: `apps/web/src/admin/AdminPage.test.tsx`

**Interfaces:**
- Consumes: administrator `CreditTopupRequest` with required `userId`, nullable `userEmail`, and `createdAt`.
- Produces: visible applicant identity, request time, amount, note, and existing review actions.

- [ ] **Step 1: Write the failing page test**

```tsx
vi.spyOn(api, "listAdminCreditRequests").mockResolvedValue({ items: [{
  id: "request_1", userId: "u1", userEmail: "applicant@example.com",
  requestedAmount: 30, note: "bank transfer", status: "pending",
  createdAt: "2026-08-11T10:20:00.000Z"
}] });
render(<AdminPage />);
expect(await screen.findByText("applicant@example.com")).toBeVisible();
expect(screen.getByText("用户 ID：u1")).toBeVisible();
expect(screen.getByText("30 积分")).toBeVisible();
expect(screen.getByText("bank transfer")).toBeVisible();
```

Add a second request with `userEmail: null` and assert `未知用户` plus its user ID remain visible.

- [ ] **Step 2: Run the page test and verify it fails**

Run: `corepack pnpm --filter @videoanalyze/web exec vitest run src/admin/AdminPage.test.tsx`

Expected: FAIL because the applicant identity is not rendered.

- [ ] **Step 3: Update the client type and render identity**

Make `userId` required and add `userEmail?: string | null` to `CreditTopupRequest`. In each administrator request row render:

```tsx
<strong>{request.userEmail || "未知用户"}</strong>
<small>用户 ID：{request.userId}</small>
<small>{request.requestedAmount} 积分 · {formatRequestTime(request.createdAt)}</small>
<small>{request.note || "无备注"}</small>
```

Use a small local formatter returning `时间未知` when `createdAt` is absent and `new Date(value).toLocaleString("zh-CN")` otherwise.

- [ ] **Step 4: Run the page test and verify it passes**

Run: `corepack pnpm --filter @videoanalyze/web exec vitest run src/admin/AdminPage.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run scoped verification**

Run: `corepack pnpm --filter @videoanalyze/api exec vitest run src/db/repositories/admin.test.ts src/routes/admin.test.ts && corepack pnpm --filter @videoanalyze/web exec vitest run src/admin/AdminPage.test.tsx && corepack pnpm typecheck && corepack pnpm exec eslint apps/api/src/db/repositories/admin.ts apps/api/src/routes/admin.ts apps/web/src/api/client.ts apps/web/src/admin/AdminPage.tsx`

Expected: PASS.
