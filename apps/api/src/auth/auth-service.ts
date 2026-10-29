import { randomInt } from "node:crypto";
import { emailSchema, DomainError, publicUserSchema, type PublicUser } from "@videoanalyze/domain";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createOpaqueToken, hashOpaqueToken } from "./tokens.js";

type UserWithCredentials = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  mustChangePassword: boolean;
};

type AuthDependencies = {
  repositories: {
    users: {
      create(input: { email: string; passwordHash: string; emailVerifiedAt?: Date | null }): Promise<UserWithCredentials>;
      findByEmail(email: string): Promise<UserWithCredentials | null>;
      findById(id: string): Promise<UserWithCredentials | null>;
      markEmailVerified(id: string, verifiedAt: Date): Promise<void>;
      updatePassword(id: string, passwordHash: string): Promise<void>;
    };
    auth: {
      createVerification(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
      findVerification(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null>;
      markVerificationUsed(id: string, usedAt: Date): Promise<boolean>;
      createRegistrationCode(input: { email: string; codeHash: string; expiresAt: Date; createdAt: Date; rateLimitBefore: Date }): Promise<boolean>;
      findRegistrationCode(email: string): Promise<{ id: string; email: string; codeHash: string; expiresAt: Date; usedAt: Date | null; attempts: number; createdAt: Date } | null>;
      incrementRegistrationAttempts(id: string, codeHash: string, now: Date): Promise<number>;
      markRegistrationCodeUsed(id: string, codeHash: string, usedAt: Date): Promise<boolean>;
      createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
      findSession(tokenHash: string): Promise<{ userId: string; expiresAt: Date; revokedAt: Date | null } | null>;
      revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
      createPasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date; createdAt?: Date; rateLimitBefore?: Date }): Promise<boolean>;
      findPasswordResetToken(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null>;
      consumePasswordResetToken(id: string, usedAt: Date): Promise<boolean>;
      completePasswordReset(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<boolean>;
    };
    credits: {
      grant(input: { userId: string; amount: number; type: "welcome_grant"; idempotencyKey: string; reason: string }): Promise<boolean | void>;
    };
  };
  mailer: {
    sendVerification(input: { email: string; token: string; link: string }): Promise<void>;
    sendRegistrationCode(input: { email: string; code: string; expiresAt: Date }): Promise<void>;
    sendPasswordReset?: (input: { email: string; token: string; link: string }) => Promise<void>;
  };
  verificationBaseUrl: string;
  resetBaseUrl?: string;
  now?: () => Date;
};

function publicUser(user: Omit<UserWithCredentials, "passwordHash">): PublicUser {
  return publicUserSchema.parse({
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword
  });
}

function validatePasswordPair(password: string, confirmPassword: string): void {
  if (password.length < 8) {
    throw new DomainError("INVALID_CREDENTIALS", "password must be at least 8 characters", 400);
  }
  if (password !== confirmPassword) {
    throw new DomainError("PASSWORD_MISMATCH", "passwords do not match", 400);
  }
}

function normalizeEmail(value: string): string {
  try {
    return emailSchema.parse(value);
  } catch {
    throw new DomainError("INVALID_CREDENTIALS", "email is invalid", 400);
  }
}

export function createAuthService(dependencies: AuthDependencies) {
  const now = dependencies.now ?? (() => new Date());

  async function sendPasswordReset(user: UserWithCredentials, rateLimit = false) {
    if (!dependencies.mailer.sendPasswordReset) throw new Error("password reset email is unavailable");
    const token = createOpaqueToken();
    const currentTime = now();
    const expiresAt = new Date(currentTime.getTime() + 60 * 60 * 1000);
    const created = await dependencies.repositories.auth.createPasswordResetToken({
      userId: user.id, tokenHash: hashOpaqueToken(token), expiresAt, createdAt: currentTime,
      ...(rateLimit ? { rateLimitBefore: new Date(currentTime.getTime() - 60_000) } : {})
    });
    if (created) await dependencies.mailer.sendPasswordReset({ email: user.email, token, link: `${dependencies.resetBaseUrl ?? dependencies.verificationBaseUrl}/reset-password?token=${encodeURIComponent(token)}` });
    return { token, expiresAt };
  }

  return {
    async sendRegistrationCode(input: { email: string }) {
      const email = normalizeEmail(input.email);
      const existing = await dependencies.repositories.users.findByEmail(email);
      if (existing?.emailVerifiedAt) {
        throw new DomainError("EMAIL_ALREADY_REGISTERED", "email is already registered", 409);
      }

      const currentTime = now();
      const code = String(randomInt(100000, 1000000));
      const expiresAt = new Date(currentTime.getTime() + 10 * 60 * 1000);
      const created = await dependencies.repositories.auth.createRegistrationCode({
        email,
        codeHash: hashOpaqueToken(code),
        expiresAt,
        createdAt: currentTime,
        rateLimitBefore: new Date(currentTime.getTime() - 60 * 1000)
      });
      if (!created) {
        throw new DomainError("REGISTRATION_CODE_RATE_LIMITED", "registration code was sent too recently", 429);
      }

      await dependencies.mailer.sendRegistrationCode({ email, code, expiresAt });
      return { sent: true as const, expiresInSeconds: 600 as const };
    },

    async register(input: { email: string; password: string; confirmPassword: string; verificationCode: string }) {
      const email = normalizeEmail(input.email);
      validatePasswordPair(input.password, input.confirmPassword);
      const verificationCode = input.verificationCode;
      const verification = await dependencies.repositories.auth.findRegistrationCode(email);
      if (!verification || verification.usedAt || verification.expiresAt.getTime() <= now().getTime()) {
        throw new DomainError("INVALID_REGISTRATION_CODE", "registration code is invalid or expired", 400);
      }
      if (verification.attempts >= 5) {
        throw new DomainError("REGISTRATION_CODE_EXHAUSTED", "registration code attempts exceeded", 400);
      }

      if (!/^\d{6}$/.test(verificationCode) || hashOpaqueToken(verificationCode) !== verification.codeHash) {
        const attempts = await dependencies.repositories.auth.incrementRegistrationAttempts(verification.id, verification.codeHash, now());
        if (attempts >= 5) throw new DomainError("REGISTRATION_CODE_EXHAUSTED", "registration code attempts exceeded", 400);
        throw new DomainError("INVALID_REGISTRATION_CODE", "registration code is invalid", 400);
      }

      const existing = await dependencies.repositories.users.findByEmail(email);
      if (existing && !(await verifyPassword(input.password, existing.passwordHash))) {
        throw new DomainError("INVALID_CREDENTIALS", "email or password is incorrect", 401);
      }

      const user = existing ?? await dependencies.repositories.users.create({ email, passwordHash: await hashPassword(input.password), emailVerifiedAt: now() });
      if (existing && !existing.emailVerifiedAt) await dependencies.repositories.users.markEmailVerified(existing.id, now());
      await dependencies.repositories.credits.grant({
        userId: user.id,
        amount: 12,
        type: "welcome_grant",
        idempotencyKey: `welcome:${user.id}`,
        reason: "email_verified"
      });
      if (!(await dependencies.repositories.auth.markRegistrationCodeUsed(verification.id, verification.codeHash, now()))) {
        throw new DomainError("INVALID_REGISTRATION_CODE", "registration code is invalid or expired", 400);
      }
      return { userId: user.id, verified: true as const };
    },

    async verifyEmail(token: string) {
      const verification = await dependencies.repositories.auth.findVerification(hashOpaqueToken(token));
      if (!verification) throw new DomainError("INVALID_VERIFICATION_TOKEN", "verification token is invalid", 400);
      if (verification.usedAt) return { userId: verification.userId, trialCreditsGranted: false };
      if (verification.expiresAt.getTime() <= now().getTime()) {
        throw new DomainError("INVALID_VERIFICATION_TOKEN", "verification token has expired", 400);
      }

      await dependencies.repositories.credits.grant({
        userId: verification.userId,
        amount: 12,
        type: "welcome_grant",
        idempotencyKey: `welcome:${verification.userId}`,
        reason: "email_verified"
      });
      const marked = await dependencies.repositories.auth.markVerificationUsed(verification.id, now());
      if (!marked) return { userId: verification.userId, trialCreditsGranted: false };
      await dependencies.repositories.users.markEmailVerified(verification.userId, now());
      return { userId: verification.userId, trialCreditsGranted: true };
    },

    async login(input: { email: string; password: string }) {
      const email = normalizeEmail(input.email);
      const user = await dependencies.repositories.users.findByEmail(email);
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new DomainError("INVALID_CREDENTIALS", "email or password is incorrect", 401);
      }
      if (!user.emailVerifiedAt) {
        throw new DomainError("EMAIL_NOT_VERIFIED", "email verification is required", 403);
      }
      if (user.status === "suspended") {
        throw new DomainError("ACCOUNT_SUSPENDED", "account is suspended", 403);
      }

      const sessionToken = createOpaqueToken();
      await dependencies.repositories.auth.createSession({
        userId: user.id,
        tokenHash: hashOpaqueToken(sessionToken),
        expiresAt: new Date(now().getTime() + 30 * 24 * 60 * 60 * 1000)
      });
      return { sessionToken, user: publicUser(user) };
    },

    async authenticate(sessionToken: string) {
      const session = await dependencies.repositories.auth.findSession(hashOpaqueToken(sessionToken));
      if (!session || session.revokedAt || session.expiresAt.getTime() <= now().getTime()) {
        throw new DomainError("UNAUTHORIZED", "session is invalid", 401);
      }
      const user = await dependencies.repositories.users.findById(session.userId);
      if (!user) throw new DomainError("UNAUTHORIZED", "session user does not exist", 401);
      if (user.status === "suspended") throw new DomainError("ACCOUNT_SUSPENDED", "account is suspended", 403);
      return publicUser(user);
    },

    async logout(sessionToken: string) {
      await dependencies.repositories.auth.revokeSession(hashOpaqueToken(sessionToken), now());
    },

    async requestPasswordReset(userId: string) {
      const user = await dependencies.repositories.users.findById(userId);
      if (!user) throw new DomainError("NOT_FOUND", "user not found", 404);
      return sendPasswordReset(user);
    },

    async forgotPassword(input: { email: string }) {
      const user = await dependencies.repositories.users.findByEmail(normalizeEmail(input.email));
      if (user?.emailVerifiedAt && user.status === "active") await sendPasswordReset(user, true);
      // Keep the response identical for unknown accounts and repeated requests.
      return { ok: true as const };
    },

    async resetPassword(input: { token: string; password: string; confirmPassword: string }) {
      validatePasswordPair(input.password, input.confirmPassword);
      const passwordHash = await hashPassword(input.password);
      if (!(await dependencies.repositories.auth.completePasswordReset({ tokenHash: hashOpaqueToken(input.token), passwordHash, now: now() }))) {
        throw new DomainError("INVALID_RESET_TOKEN", "password reset token is invalid or expired", 400);
      }
      return { ok: true as const };
    },

    async changePassword(input: { userId: string; password: string; confirmPassword: string }) {
      validatePasswordPair(input.password, input.confirmPassword);
      await dependencies.repositories.users.updatePassword(input.userId, await hashPassword(input.password));
      return { ok: true as const };
    }
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
