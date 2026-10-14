import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests drive real Chromium against the app. By default they reuse an
 * already-running `npm run dev` on :3000 (or start one). These tests call real
 * services (Gemini free tier, PayPal sandbox), so run them deliberately:
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
