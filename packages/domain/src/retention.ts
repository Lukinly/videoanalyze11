import { z } from "zod";

export const retentionModeSchema = z.enum(["standard", "privacy"]);

export const resultAvailabilitySchema = z.enum(["available", "expired", "deleted", "pending"]);

export type RetentionMode = z.infer<typeof retentionModeSchema>;
export type ResultAvailability = z.infer<typeof resultAvailabilitySchema>;
