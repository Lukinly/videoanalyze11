# Registration Email Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace new-account email verification links with a registration-page 6-digit email code flow that creates an already-verified user after successful code validation.

**Architecture:** Add a dedicated `registration_verifications` record keyed by normalized email. The API first creates/replaces a hashed, expiring code and sends the plaintext only through the mail provider; the final registration request validates the code, creates the verified user, and grants the idempotent welcome credits. The existing token-link verification path remains available for legacy messages.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/Drizzle schema definitions, pg-mem tests, React/Vite, React Testing Library, Vitest, pnpm workspaces.

## Global Constraints

- New registration codes are 6 digits, expire after 10 minutes, and are single-use.
- The same normalized email cannot request another code within 60 seconds; a newer code invalidates the previous code.
- The database stores only the code hash; no API response contains the plaintext code, password, or session token.
- Five invalid code attempts invalidate the current code.
- A successful new registration writes `email_verified_at`; the existing welcome-credit idempotency key grants credits only once.
- Existing `email_verifications` link records and `GET /api/auth/verify-email` remain for old emails, but new registrations use the code table and do not send links.
- Preserve all unrelated user changes already present in the dirty worktree.
- No production implementation is written before its failing test is added and observed failing.

---

## Repository Map

- `apps/api/src/db/migrations/0003_registration_verifications.sql`: append-only production migration for the new code table.
- `apps/api/src/db/schema.ts`: Drizzle table definition for the new table.
- `apps/api/src/db/test-database.ts`: pg-mem table definition used by repository and service tests.
- `apps/api/src/db/repositories/auth.ts`: SQL methods to replace, read, increment attempts, and consume registration codes.
- `apps/api/src/auth/auth-service.ts`: generate/send codes and complete new or legacy-unverified registrations.
- `apps/api/src/routes/auth.ts`: validate and expose the send-code endpoint and the expanded registration body.
- `apps/api/src/server.ts`: send registration code mail through the configured mail API.
- `packages/domain/src/errors.ts`: stable error codes for invalid, exhausted, and rate-limited registration codes.
- `apps/web/src/api/client.ts`: typed client methods for sending a code and registering with one.
- `apps/web/src/auth/RegisterPage.tsx`: email-code registration form and resend cooldown.
- `apps/api/src/auth/auth.test.ts`: service-level registration-code, verification, expiry, retry, and legacy-account tests.
- `apps/api/src/routes/auth.test.ts`: Fastify route/body/response contract tests.
- `apps/web/src/auth/RegisterPage.test.tsx`: registration-page interaction tests.

## Task 1: Add Registration-Code Persistence

**Files:**
- Create: `apps/api/src/db/migrations/0003_registration_verifications.sql`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/test-database.ts`
- Modify: `apps/api/src/db/repositories/auth.ts`
- Test: `apps/api/src/db/registration-verifications.test.ts`

**Interfaces:**

The auth repository will expose these methods:

```ts
type RegistrationCodeRecord = {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
  createdAt: Date;
};

createRegistrationCode(input: {
  email: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
}): Promise<void>;
findRegistrationCode(email: string): Promise<RegistrationCodeRecord | null>;
incrementRegistrationAttempts(id: string, now: Date): Promise<number>;
markRegistrationCodeUsed(id: string, usedAt: Date): Promise<boolean>;
```

- [ ] **Step 1: Write the failing repository tests**

Add tests using the existing pg-mem pool and `migrateTestDatabase` helper:

```ts
it("replaces the previous code for the same normalized email", async () => {
  await repositories.auth.createRegistrationCode({
    email: "user@example.com",
    codeHash: "old-hash",
    expiresAt: new Date("2026-08-04T00:10:00Z"),
    createdAt: new Date("2026-08-04T00:00:00Z")
  });
  await repositories.auth.createRegistrationCode({
    email: "user@example.com",
    codeHash: "new-hash",
    expiresAt: new Date("2026-08-04T00:20:00Z"),
    createdAt: new Date("2026-08-04T00:01:00Z")
  });

  await expect(repositories.auth.findRegistrationCode("user@example.com"))
    .resolves.toMatchObject({ codeHash: "new-hash", attempts: 0, usedAt: null });
});

it("increments attempts and consumes a code only once", async () => {
  await repositories.auth.createRegistrationCode({
    email: "user@example.com",
    codeHash: "hash",
    expiresAt: new Date("2026-08-04T00:10:00Z"),
    createdAt: new Date("2026-08-04T00:00:00Z")
  });
  const record = await repositories.auth.findRegistrationCode("user@example.com");
  expect(record).not.toBeNull();
  await expect(repositories.auth.incrementRegistrationAttempts(record!.id, new Date("2026-08-04T00:01:00Z"))).resolves.toBe(1);
  await expect(repositories.auth.markRegistrationCodeUsed(record!.id, new Date("2026-08-04T00:02:00Z"))).resolves.toBe(true);
  await expect(repositories.auth.markRegistrationCodeUsed(record!.id, new Date("2026-08-04T00:03:00Z"))).resolves.toBe(false);
});
```

- [ ] **Step 2: Run the repository test and verify the expected failure**

Run: `corepack pnpm vitest run apps/api/src/db/registration-verifications.test.ts`

Expected: FAIL because the table and repository methods do not exist yet.

- [ ] **Step 3: Add the append-only migration and test schema**

Create `0003_registration_verifications.sql` with a unique normalized-email key, the code hash, expiry, nullable `used_at`, `attempts INTEGER NOT NULL DEFAULT 0`, and `created_at`. Add the equivalent `CREATE TABLE IF NOT EXISTS` statement to `migrationStatements` in `test-database.ts` before tests construct repositories.

- [ ] **Step 4: Add the Drizzle table and SQL repository methods**

Define `registrationVerifications` in `schema.ts`. In `auth.ts`, implement replacement with PostgreSQL `ON CONFLICT (email) DO UPDATE`, lookup ordered by the unique email, `UPDATE ... SET attempts = attempts + 1 ... RETURNING attempts`, and conditional single-use `UPDATE ... WHERE used_at IS NULL RETURNING id`.

- [ ] **Step 5: Run the repository test and commit the persistence slice**

Run: `corepack pnpm vitest run apps/api/src/db/registration-verifications.test.ts`

Expected: PASS with both tests green.

Commit:

```bash
git add apps/api/src/db/migrations/0003_registration_verifications.sql apps/api/src/db/schema.ts apps/api/src/db/test-database.ts apps/api/src/db/repositories/auth.ts apps/api/src/db/registration-verifications.test.ts
git commit -m "feat: persist registration email codes"
```

## Task 2: Implement Auth-Service Code Lifecycle

**Files:**
- Modify: `packages/domain/src/errors.ts`
- Modify: `apps/api/src/auth/auth-service.ts`
- Modify: `apps/api/src/db/repositories/users.ts`
- Modify: `apps/api/src/auth/auth.test.ts`

**Interfaces:**

Extend the auth service with:

```ts
sendRegistrationCode(input: { email: string }): Promise<{
  sent: true;
  expiresInSeconds: 600;
}>;

register(input: {
  email: string;
  password: string;
  confirmPassword: string;
  verificationCode: string;
}): Promise<{ userId: string; verified: true }>;
```

Extend the user repository create input to accept `emailVerifiedAt?: Date | null`; keep the existing default `null` for unrelated callers.

- [ ] **Step 1: Write failing auth-service tests**

Update the test setup mailer to capture registration-code messages, import `hashPassword` from `./passwords.js` for the legacy-user fixture, and add these behaviors:

```ts
it("sends a six-digit code and creates an already-verified user", async () => {
  const requested = await auth.sendRegistrationCode({ email: "user@example.com" });
  const code = mailer.sendRegistrationCode.mock.calls[0][0].code as string;

  expect(requested).toEqual({ sent: true, expiresInSeconds: 600 });
  expect(code).toMatch(/^\d{6}$/);

  const registered = await auth.register({
    email: "user@example.com",
    password: "correct horse battery staple",
    confirmPassword: "correct horse battery staple",
    verificationCode: code
  });
  const user = await repositories.users.findById(registered.userId);
  expect(user?.emailVerifiedAt).not.toBeNull();
  await expect(auth.login({ email: "user@example.com", password: "correct horse battery staple" }))
    .resolves.toMatchObject({ user: { id: registered.userId } });
});

it("rejects a wrong code without creating a user", async () => {
  await auth.sendRegistrationCode({ email: "wrong@example.com" });
  await expect(auth.register({
    email: "wrong@example.com",
    password: "correct horse battery staple",
    confirmPassword: "correct horse battery staple",
    verificationCode: "000000"
  })).rejects.toMatchObject({ code: "INVALID_REGISTRATION_CODE" });
  await expect(repositories.users.findByEmail("wrong@example.com")).resolves.toBeNull();
});

it("rejects a second send within sixty seconds and allows a legacy unverified user to verify", async () => {
  const clock = new Date("2026-08-04T00:00:00Z");
  auth = createAuthService({ repositories, mailer, verificationBaseUrl: "http://localhost:5173", now: () => clock });
  await auth.sendRegistrationCode({ email: "legacy@example.com" });
  await expect(auth.sendRegistrationCode({ email: "legacy@example.com" })).rejects.toMatchObject({ code: "REGISTRATION_CODE_RATE_LIMITED", status: 429 });
  clock.setTime(clock.getTime() + 60_000);
  await auth.sendRegistrationCode({ email: "legacy@example.com" });
  const code = mailer.sendRegistrationCode.mock.calls.at(-1)![0].code as string;
  const legacy = await repositories.users.create({ email: "legacy@example.com", passwordHash: await hashPassword("correct horse battery staple") });
  expect(legacy.emailVerifiedAt).toBeNull();
  await expect(auth.register({ email: legacy.email, password: "correct horse battery staple", confirmPassword: "correct horse battery staple", verificationCode: code })).resolves.toMatchObject({ userId: legacy.id, verified: true });
});
```

Keep and update the existing tests so all successful registrations first request a code and pass the captured code; keep the existing exactly-once welcome-credit assertion.

- [ ] **Step 2: Run the auth tests and verify they fail for the missing lifecycle**

Run: `corepack pnpm vitest run apps/api/src/auth/auth.test.ts`

Expected: FAIL because `sendRegistrationCode`, the new request field, and the repository methods are not implemented.

- [ ] **Step 3: Add stable domain errors and code generation**

Add `INVALID_REGISTRATION_CODE`, `REGISTRATION_CODE_RATE_LIMITED`, and `REGISTRATION_CODE_EXHAUSTED` to `DomainErrorCode`. In `auth-service.ts`, generate a number from 100000 through 999999 with `node:crypto` `randomInt`, hash it with `hashOpaqueToken`, and never include the plaintext in a return value.

- [ ] **Step 4: Implement send-code validation and rate limiting**

Normalize the email with the existing `emailSchema`. If a verified user exists, throw `EMAIL_ALREADY_REGISTERED` with status 409. Read the current code record and reject when `createdAt` is less than 60 seconds old. Otherwise replace it with a ten-minute record and call `mailer.sendRegistrationCode({ email, code, expiresAt })`, returning `{ sent: true, expiresInSeconds: 600 }`.

- [ ] **Step 5: Implement registration code verification and verified-user creation**

Validate the password pair before consuming a code. Find the record by normalized email; reject missing, used, or expired records with `INVALID_REGISTRATION_CODE`. If `attempts >= 5`, throw `REGISTRATION_CODE_EXHAUSTED`; for a mismatch increment attempts and throw the appropriate error, making the fifth mismatch exhausted. On a match, conditionally mark the record used. Create a new user with `emailVerifiedAt: now()` or, if an existing user is unverified, verify its password and mark its email verified. Grant the welcome credits with `welcome:${userId}` and return `{ userId, verified: true }`.

- [ ] **Step 6: Run auth tests and commit the service slice**

Run: `corepack pnpm vitest run apps/api/src/auth/auth.test.ts`

Expected: PASS, including correct-code login, wrong-code rejection, rate limiting, legacy-user completion, expiry, one-time use, and one-time credits.

Commit:

```bash
git add packages/domain/src/errors.ts apps/api/src/auth/auth-service.ts apps/api/src/db/repositories/users.ts apps/api/src/auth/auth.test.ts
git commit -m "feat: verify registrations with email codes"
```

## Task 3: Wire the API Route and Mail Adapter

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/auth.test.ts`

**Interfaces:**

The route contract must include:

```ts
sendRegistrationCode(input: { email: string }): Promise<{ sent: true; expiresInSeconds: 600 }>;
register(input: { email: string; password: string; confirmPassword: string; verificationCode: string }): Promise<{ userId: string; verified: true }>;
```

The new Fastify route is `POST /api/auth/registration-code`, returning status 202 with the service result. The existing `POST /api/auth/register` must require a string `verificationCode` and pass the complete body unchanged to the service.

- [ ] **Step 1: Write failing route tests**

Add a `sendRegistrationCode` spy and update the mock register result. Test the new route and the expanded body:

```ts
it("sends a registration code through the API", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/registration-code",
    payload: { email: "user@example.com" }
  });

  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ sent: true, expiresInSeconds: 600 });
  expect(authService.sendRegistrationCode).toHaveBeenCalledWith({ email: "user@example.com" });
});

it("passes the registration code to the auth service without returning secrets", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "user@example.com", password: "correct horse battery staple", confirmPassword: "correct horse battery staple", verificationCode: "123456" }
  });

  expect(response.statusCode).toBe(202);
  expect(authService.register).toHaveBeenCalledWith(expect.objectContaining({ verificationCode: "123456" }));
  expect(response.body).not.toContain("123456");
});
```

- [ ] **Step 2: Run the route tests and verify the expected failure**

Run: `corepack pnpm vitest run apps/api/src/routes/auth.test.ts`

Expected: FAIL because the route and contract do not yet expose the send-code method or required registration field.

- [ ] **Step 3: Implement route validation**

Add the route body type and reject missing/non-string email with the existing `INVALID_CREDENTIALS` pattern. Require `verificationCode` on registration and throw the same 400 error before calling the service when the body is malformed.

- [ ] **Step 4: Implement the server mailer method**

Add `sendRegistrationCode` to the `createAuthService` mailer dependency in `apps/api/src/server.ts`. POST to `env.mailApiUrl` with the existing sender and recipient format, subject `验证你的 videoanalyze 注册验证码`, and text containing the code and `10 分钟` validity. Keep the existing `sendVerification` method for legacy links.

- [ ] **Step 5: Run route tests, API build, and commit the API slice**

Run: `corepack pnpm vitest run apps/api/src/routes/auth.test.ts && corepack pnpm --filter @videoanalyze/api build`

Expected: PASS with no TypeScript errors.

Commit:

```bash
git add apps/api/src/routes/auth.ts apps/api/src/server.ts apps/api/src/routes/auth.test.ts
git commit -m "feat: expose registration code API"
```

## Task 4: Add the Registration-Page Code UI

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/auth/RegisterPage.tsx`
- Modify: `apps/web/src/auth/RegisterPage.test.tsx`

**Interfaces:**

Add these client methods:

```ts
sendRegistrationCode: (input: { email: string }) => request<{ sent: true; expiresInSeconds: 600 }>("/api/auth/registration-code", {
  method: "POST",
  body: JSON.stringify(input)
}),
register: (input: { email: string; password: string; confirmPassword: string; verificationCode: string }) => request<{ userId: string; verified: true }>("/api/auth/register", {
  method: "POST",
  body: JSON.stringify(input)
})
```

- [ ] **Step 1: Write failing page tests**

Add tests for the new visible controls and request payload:

```tsx
it("requests a code and submits it with the registration", async () => {
  const sendCode = vi.spyOn(api, "sendRegistrationCode").mockResolvedValue({ sent: true, expiresInSeconds: 600 });
  const register = vi.spyOn(api, "register").mockResolvedValue({ userId: "user_1", verified: true });
  const user = userEvent.setup();
  render(<RegisterPage onLogin={() => undefined} />);

  await user.type(screen.getByLabelText("邮箱"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "获取验证码" }));
  expect(sendCode).toHaveBeenCalledWith({ email: "user@example.com" });
  await user.type(screen.getByLabelText("验证码"), "123456");
  await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
  await user.type(screen.getByLabelText("确认密码"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "创建账号" }));

  expect(register).toHaveBeenCalledWith({
    email: "user@example.com",
    password: "correct horse battery staple",
    confirmPassword: "correct horse battery staple",
    verificationCode: "123456"
  });
});

it("does not request a code for an invalid email", async () => {
  const sendCode = vi.spyOn(api, "sendRegistrationCode").mockResolvedValue({ sent: true, expiresInSeconds: 600 });
  const user = userEvent.setup();
  render(<RegisterPage onLogin={() => undefined} />);
  await user.type(screen.getByLabelText("邮箱"), "not-an-email");
  await user.click(screen.getByRole("button", { name: "获取验证码" }));
  expect(sendCode).not.toHaveBeenCalled();
});
```

Update the existing mismatched-password test mock result to `{ userId: "user_1", verified: true }` and assert it still makes no registration request.

- [ ] **Step 2: Run the page tests and verify the expected failure**

Run: `corepack pnpm vitest run apps/web/src/auth/RegisterPage.test.tsx`

Expected: FAIL because the page has no code controls or client method yet.

- [ ] **Step 3: Add the client endpoint and registration payload type**

Implement the two typed methods in `api/client.ts` exactly as defined above. Keep the existing request helper so credentials, JSON headers, and `ApiError` behavior remain unchanged.

- [ ] **Step 4: Implement the form controls and cooldown**

Add controlled `verificationCode`, `codeBusy`, `codeMessage`, and `cooldownSeconds` state. The “获取验证码” button must be `type="button"`, validate the email with the browser email input validity, call `api.sendRegistrationCode`, and set a one-second interval countdown from the returned 60-second minimum cooldown. Clear the interval on unmount. Render the code field with label `验证码`, numeric input mode, six-character limit, and one-time-code autocomplete. Submit `verificationCode` along with the current password fields; preserve the existing mismatch guard and error rendering.

- [ ] **Step 5: Update success copy and run page tests**

On successful registration show `注册成功，请返回登录。` and keep the existing “返回登录” button. Do not show a verification-link message. Run:

```bash
corepack pnpm vitest run apps/web/src/auth/RegisterPage.test.tsx
```

Expected: PASS with the new controls, code request, payload, invalid-email guard, and mismatch guard covered.

- [ ] **Step 6: Commit the web slice**

```bash
git add apps/web/src/api/client.ts apps/web/src/auth/RegisterPage.tsx apps/web/src/auth/RegisterPage.test.tsx
git commit -m "feat: add registration code form"
```

## Task 5: Full Verification and Regression Review

**Files:**
- Modify only if a verification failure exposes a direct regression in the files above.
- Do not alter unrelated dirty-worktree files.

- [ ] **Step 1: Run focused API and Web tests**

Run:

```bash
corepack pnpm vitest run apps/api/src/auth/auth.test.ts apps/api/src/routes/auth.test.ts apps/api/src/db/registration-verifications.test.ts apps/web/src/auth/RegisterPage.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck and lint**

Run: `corepack pnpm typecheck && corepack pnpm lint`

Expected: both commands exit 0 without new diagnostics.

- [ ] **Step 3: Run the complete test suite**

Run: `corepack pnpm test`

Expected: all existing and new tests pass; no test should require an actual email provider, database, or API key.

- [ ] **Step 4: Build every workspace package**

Run: `corepack pnpm build`

Expected: API, Worker, Web, Domain, and Testkit builds complete successfully.

- [ ] **Step 5: Inspect the final diff and working tree**

Run: `git diff --check && git status --short && git diff --stat`

Confirm that the feature files and migration are present, no plaintext code is returned or persisted by the implementation, and pre-existing unrelated modifications remain untouched.

- [ ] **Step 6: Commit any verification-only corrections**

If a correction was required, run the smallest relevant focused test again, then commit the corrected feature files from the registration flow:

```bash
git add packages/domain/src/errors.ts apps/api/src/auth/auth-service.ts apps/api/src/auth/auth.test.ts apps/api/src/db apps/api/src/routes/auth.ts apps/api/src/routes/auth.test.ts apps/api/src/server.ts apps/web/src/api/client.ts apps/web/src/auth/RegisterPage.tsx apps/web/src/auth/RegisterPage.test.tsx
git commit -m "fix: complete registration code verification"
```
