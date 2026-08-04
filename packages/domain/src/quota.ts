import { z } from "zod";

export const quotaReservationResultSchema = z.enum(["reserved", "already_reserved", "exhausted"]);
export type QuotaReservationResult = z.infer<typeof quotaReservationResultSchema>;
