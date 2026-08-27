import { defineConfig, devices } from "@playwright/test";

// Point at a deployed URL to smoke-test it: PLAYWRIGHT_BASE_URL=https://… pnpm test:e2e
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseUrl ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Against a deployed URL there is nothing to boot locally.
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          // CI measures the timing budget against a production build.
          command: process.env.CI ? "pnpm build && pnpm start" : "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),
});
