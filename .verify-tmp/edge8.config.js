import { defineConfig, devices } from '@playwright/test';

// 临时配置（.verify-tmp/ 用完即删）：本机没装 Playwright 的 chromium，用系统自带 Edge 跑 e2e。
export default defineConfig({
  testDir: '../tests/e2e',
  outputDir: '../test-results/.verify',
  fullyParallel: true,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5182',
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://localhost:5182',
        localStorage: [{ name: 'war-of-dots.session', value: JSON.stringify({ username: 'e2e-user', loggedInAt: 0 }) }],
      }],
    },
  },
  projects: [{ name: 'edge', use: { ...devices['Desktop Chrome'], channel: 'msedge' } }],
  webServer: { command: 'npm run dev', url: 'http://localhost:5182', reuseExistingServer: true },
});
