import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const publicUserSchema = z.object({
  id: z.string().min(1),
  email: emailSchema,
  emailVerifiedAt: z.string().datetime().nullable()
});

export type PublicUser = z.infer<typeof publicUserSchema>;
