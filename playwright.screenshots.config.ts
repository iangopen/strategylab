import { defineConfig, devices } from '@playwright/test'

// NOT part of the test suite (the E2E config's testDir is ./e2e). `npm run screenshots` captures the
// README screenshots and the Open Graph image from the LIVE site (or SCREENSHOT_URL), light theme,
// fixed viewport. See scripts/screenshots/capture.spec.ts.
const url = process.env.SCREENSHOT_URL ?? 'https://iangopen.github.io/strategylab/'

export default defineConfig({
  testDir: './scripts/screenshots',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: url.endsWith('/') ? url : `${url}/`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  },
})
