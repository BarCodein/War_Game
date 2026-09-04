import { defineConfig, devices } from '@playwright/test';

// 端到端测试配置（AGENTS.md：关键浏览器流程；支持 Chrome/Firefox/Edge）。
// Edge 项目通过 channel: 'msedge' 启用——Linux 开发机未安装 Edge 时保持注释，
// 在有 Edge 的机器（如 Windows）或 CI 上取消注释即可。
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  workers: 2, // 限制并发，避免多浏览器实例在本机争抢 CPU 造成超时
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'msedge', use: { ...devices['Desktop Chrome'], channel: 'msedge' } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
