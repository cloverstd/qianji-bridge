import { defineConfig } from "@playwright/test";
const port = process.env.QIANJI_TEST_PORT ?? "3001";
const origin = `http://localhost:${port}`;
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: origin,
    headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx tests/browser-server.ts",
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    env: {
      DATA_DIR: "/tmp/qianji-e2e-data",
      APP_ORIGIN: origin,
      QIANJI_TEST_PORT: port,
      ENABLE_DEMO: "true",
    },
    timeout: 30000,
  },
});
