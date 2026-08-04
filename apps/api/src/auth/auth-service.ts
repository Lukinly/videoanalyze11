import { emailSchema, DomainError, publicUserSchema, type PublicUser } from "@videoanalyze/domain";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createOpaqueToken, hashOpaqueToken } from "./tokens.js";

type AuthDependencies = {
  repositories: {
    users: {
      create(input: { email: string; passwordHash: string }): Promise<{ id: string; email: string; emailVerifiedAt: Date | null }>;
      findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string; emailVerifiedAt: Date | null } | null>;
      findById(id: string): Promise<{ id: string; email: string; emailVerifiedAt: Date | null } | null>;
      markEmailVerified(id: string, verifiedAt: Date): Promise<void>;
    };
    auth: {
      createVerification(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
      findVerification(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null>;
      markVerificationUsed(id: string, usedAt: Date): Promise<void>;
      createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
      findSession(tokenHash: string): Promise<{ userId: string; expiresAt: Date; revokedAt: Date | null } | null>;
      revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
    };
    usage: {
      grantCredits(userId: string, count: number, reason: string): Promise<void>;
    };
  };
  mailer: { sendVerification(input: { email: string; token: string; link: string }): Promise<void> };
  verificationBaseUrl: string;
  now?: () => Date;
};

function publicUser(user: { id: string; email: string; emailVerifiedAt: Date | null }): PublicUser {
  return publicUserSchema.parse({
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null
  });
}

export function createAuthService(dependencies: AuthDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async register(input: { email: string; password: string }) {
      const email = emailSchema.parse(input.email);
      if (input.password.length < 8) {
        throw new DomainError("INVALID_CREDENTIALS", "password must be at least 8 characters", 400);
      }
      if (await dependencies.repositories.users.findByEmail(email)) {
        throw new DomainError("EMAIL_ALREADY_REGISTERED", "email is already registered", 409);
      }

      const user = await dependencies.repositories.users.create({ email, passwordHash: await hashPassword(input.password) });
      const token = createOpaqueToken();
      const expiresAt = new Date(now().getTime() + 24 * 60 * 60 * 1000);
      await dependencies.repositories.auth.createVerification({ userId: user.id, tokenHash: hashOpaqueToken(token), expiresAt });
      await dependencies.mailer.sendVerification({ email, token, link: `${dependencies.verificationBaseUrl}/verify-email?token=${encodeURIComponent(token)}` });
      return { userId: user.id, verificationSent: true };
    },

    async verifyEmail(token: string) {
      const verification = await dependencies.repositories.auth.findVerification(hashOpaqueToken(token));
      if (!verification) throw new DomainError("INVALID_VERIFICATION_TOKEN", "verification token is invalid", 400);
      if (verification.usedAt) return { userId: verification.userId, trialCreditsGranted: false };
      if (verification.expiresAt.getTime() <= now().getTime()) {
        throw new DomainError("INVALID_VERIFICATION_TOKEN", "verification token has expired", 400);
      }

      await dependencies.repositories.auth.markVerificationUsed(verification.id, now());
      await dependencies.repositories.users.markEmailVerified(verification.userId, now());
      await dependencies.repositories.usage.grantCredits(verification.userId, 2, "email_verified");
      return { userId: verification.userId, trialCreditsGranted: true };
    },

    async login(input: { email: string; password: string }) {
      const email = emailSchema.parse(input.email);
      const user = await dependencies.repositories.users.findByEmail(email);
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new DomainError("INVALID_CREDENTIALS", "email or password is incorrect", 401);
      }
      if (!user.emailVerifiedAt) {
        throw new DomainError("EMAIL_NOT_VERIFIED", "email verification is required", 403);
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
      return publicUser(user);
    },

    async logout(sessionToken: string) {
      await dependencies.repositories.auth.revokeSession(hashOpaqueToken(sessionToken), now());
    }
  };
}
