import { defineConfig } from '@playwright/test';

/**
 * E2E against the running dev stack (`pnpm db:up` + `pnpm dev`, API with OTP_BYPASS=true).
 * Uses the locally installed Chrome, so no browser download is needed.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    // Calls: auto-grant the mic and feed a synthetic audio track.
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    permissions: ['microphone'],
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
});
