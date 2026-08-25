import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it } from "vitest";
import { registerLinkImportRoutes } from "./link-imports.js";

describe("link import routes", () => {
  it("previews an authenticated video link without starting analysis", async () => {
    const app = Fastify(); await app.register(cookie);
    await registerLinkImportRoutes(app, {
      authService: { authenticate: async () => ({ id: "u1" }) },
      linkImportService: { preview: async ({ userId, url }) => ({ videoId: null, userId, canonicalUrl: url, estimatedCost: 10 }), confirm: async () => ({ videoId: "v1" }) }
    });
    const response = await app.inject({ method: "POST", url: "/api/link-imports/preview", cookies: { video_session: "s" }, payload: { url: "https://youtu.be/dQw4w9WgXcQ" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ videoId: null, estimatedCost: 10 });
  });

  it("does not inspect a link without authentication", async () => {
    const app = Fastify(); await app.register(cookie);
    await registerLinkImportRoutes(app, { authService: { authenticate: async () => ({ id: "u1" }) }, linkImportService: { preview: async () => { throw new Error("must not inspect"); }, confirm: async () => { throw new Error("must not confirm"); } } });
    expect((await app.inject({ method: "POST", url: "/api/link-imports/preview", payload: { url: "https://youtu.be/dQw4w9WgXcQ" } })).statusCode).toBe(401);
  });

  it("persists only through the authenticated confirmation endpoint", async () => {
    const app = Fastify(); await app.register(cookie);
    await registerLinkImportRoutes(app, {
      authService: { authenticate: async () => ({ id: "u1" }) },
      linkImportService: { preview: async () => ({}), confirm: async ({ userId, url }) => ({ videoId: "v1", userId, canonicalUrl: url }) }
    });
    const response = await app.inject({ method: "POST", url: "/api/link-imports/confirm", cookies: { video_session: "s" }, payload: { url: "https://youtu.be/dQw4w9WgXcQ" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ videoId: "v1", userId: "u1" });
  });
});
