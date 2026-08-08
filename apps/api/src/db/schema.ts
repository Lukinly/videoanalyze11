import { bigint, boolean, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => ({ emailUnique: uniqueIndex("users_email_unique").on(table.email) }));

export const videos = pgTable("videos", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  objectKey: text("object_key").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: bigint("file_size", { mode: "number" }).notNull().default(0),
  fingerprint: text("fingerprint"),
  duration: real("duration"),
  status: text("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  originalExpiresAt: timestamp("original_expires_at", { withTimezone: true }),
  resultExpiresAt: timestamp("result_expires_at", { withTimezone: true })
});

export const analysisRuns = pgTable("analysis_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  videoId: text("video_id").notNull(),
  stage: text("stage").notNull().default("queued"),
  status: text("status").notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  runId: text("run_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  startSeconds: real("start_seconds").notNull(),
  endSeconds: real("end_seconds").notNull(),
  objectKey: text("object_key").notNull(),
  fileSize: bigint("file_size", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("pending"),
  transcriptObjectKey: text("transcript_object_key"),
  transcriptJson: jsonb("transcript_json"),
  retryCount: integer("retry_count").notNull().default(0),
  error: text("error")
});

export const usageLedger = pgTable("usage_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  runId: text("run_id"),
  amount: integer("amount").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const creditLedger = pgTable("credit_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  referenceId: text("reference_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => ({ idempotencyUnique: uniqueIndex("credit_ledger_idempotency_unique").on(table.idempotencyKey) }));

export const creditReservations = pgTable("credit_reservations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  runId: text("run_id").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releaseReason: text("release_reason")
}, (table) => ({
  runUnique: uniqueIndex("credit_reservations_run_unique").on(table.runId),
  idempotencyUnique: uniqueIndex("credit_reservations_idempotency_unique").on(table.idempotencyKey)
}));

export const creditTopupRequests = pgTable("credit_topup_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  requestedAmount: integer("requested_amount").notNull(),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true })
});

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id").notNull(),
  action: text("action").notNull(),
  targetUserId: text("target_user_id"),
  targetRecordId: text("target_record_id"),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => ({ tokenHashUnique: uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash) }));

export const emailVerifications = pgTable("email_verifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const registrationVerifications = pgTable("registration_verifications", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => ({ emailUnique: uniqueIndex("registration_verifications_email_unique").on(table.email) }));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});
