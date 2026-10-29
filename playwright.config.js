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
    // 既有游戏测试覆盖登录后的功能流程，统一提供测试用户会话。
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://localhost:5173',
        localStorage: [{
          name: 'war-of-dots.session',
          value: JSON.stringify({ username: 'e2e-user', loggedInAt: 0 }),
        }],
      }],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'msedge', use: { ...devices['Desktop Chrome'], channel: 'msedge' } },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
    {
      // PvP：Vite 把 /api 与 /socket.io 代理到这里（见 vite.config.js）。
      // 用临时 SQLite 文件，避免 e2e 污染本地 server/data/pvp.db；
      // env 里的 PVP_DB 只在 Playwright 拉起的进程里生效。
      // e2e 会反复注册新账号，所以要放宽注册限速（默认 10 次/小时/IP 会被自己打满）。
      command: 'node server/src/index.js',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: true,
      env: { PVP_DB: 'server/data/e2e.db', PVP_REGISTER_MAX_PER_HOUR: '1000' },
    },
  ],
});
