import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (Phase 17). Run after `npm run build`: `npm run test:e2e`. The production server starts on its own port; it gets a fake
 * GEMINI_API_KEY (overriding .env.local) so the engineer UI is testable and no test can spend real quota: tests fake /api/engineer.
 * Headless Chromium renders WebGL with SwiftShader (software), so the 3D views run in CI without a GPU.
 */
const PORT = Number(process.env.E2E_PORT ?? 3102);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Two workers: the 3D pages render in software WebGL, and more in parallel starved them (car tests timed out at 4).
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /phone\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /phone\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    env: { GEMINI_API_KEY: "e2e-fake-key-never-valid" },
  },
});
