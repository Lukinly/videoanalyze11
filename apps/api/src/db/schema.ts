import { bigint, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
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

export const emailVerifications = pgTable("email_verifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});
