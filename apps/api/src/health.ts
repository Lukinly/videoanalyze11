export function createHealthPayload() {
  return { status: "ok" as const, service: "api" as const };
}
