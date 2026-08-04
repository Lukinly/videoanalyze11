import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
