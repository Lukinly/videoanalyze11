import { DomainError } from "@videoanalyze/domain";
import type { AuthServiceContract } from "../routes/auth.js";

export type AuthenticatedUser = {
  id: string;
  email?: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  mustChangePassword?: boolean;
};

export async function requireAuthenticated(request: { cookies: Record<string, string | undefined> }, authService: AuthServiceContract): Promise<AuthenticatedUser> {
  const token = request.cookies.video_session;
  if (!token) throw new DomainError("UNAUTHORIZED", "login required", 401);
  const user = await authService.authenticate(token) as Partial<AuthenticatedUser>;
  if (!user.id || !user.role || !user.status) throw new DomainError("UNAUTHORIZED", "login required", 401);
  return user as AuthenticatedUser;
}

export async function requireAdmin(request: { cookies: Record<string, string | undefined> }, authService: AuthServiceContract): Promise<AuthenticatedUser & { role: "admin" }> {
  const user = await requireAuthenticated(request, authService);
  if (user.status !== "active" || user.role !== "admin") throw new DomainError("FORBIDDEN", "administrator access is required", 403);
  return user as AuthenticatedUser & { role: "admin" };
}
