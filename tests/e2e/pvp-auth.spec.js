import { expect, test } from '@playwright/test';

// P1b 账号体系的浏览器流程（真实表单 + 真实后端 + HttpOnly Cookie）：
//   注册 → 自动登录 → 刷新后仍登录（Cookie 生效）→ 登出 → 再登录 → 已登录
// 说明：网页端（pvp.html）走同源相对路径，Vite 把 /api 代理到 Node（见 vite.config.js）。
test.describe('PvP 账号流程', () => {
  test('注册 → 已登录 → 刷新仍登录 → 登出 → 再登录', async ({ page }) => {
    const username = `e2e_${Date.now().toString(36)}`;
    const password = 'e2e-password-1';

    await page.goto('/pvp.html');

    // 初始应为未登录
    await expect(page.locator('#authLoggedOut')).toBeVisible();
    await expect(page.locator('#authLoggedIn')).toBeHidden();

    // 注册
    await page.fill('#inputUsername', username);
    await page.fill('#inputPassword', password);
    await page.click('#btnRegister');
    await expect(page.locator('#authLoggedIn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#meName')).toHaveText(username);
    await expect(page.locator('#authMsg')).toContainText('注册成功');

    // 刷新后仍是登录状态（会话在 HttpOnly Cookie 里，前端读不到但会自动带上）
    await page.reload();
    await expect(page.locator('#authLoggedIn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#meName')).toHaveText(username);

    // 登出
    await page.click('#btnLogout');
    await expect(page.locator('#authLoggedOut')).toBeVisible();
    await expect(page.locator('#authLoggedIn')).toBeHidden();

    // 用同一账号再登录
    await page.fill('#inputUsername', username);
    await page.fill('#inputPassword', password);
    await page.click('#btnLogin');
    await expect(page.locator('#authLoggedIn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#meName')).toHaveText(username);
  });

  test('错误口令给出可读错误，且不会登录', async ({ page }) => {
    const username = `e2e_bad_${Date.now().toString(36)}`;
    await page.goto('/pvp.html');

    await page.fill('#inputUsername', username);
    await page.fill('#inputPassword', 'whatever-pass-1');
    await page.click('#btnRegister');
    await expect(page.locator('#authLoggedIn')).toBeVisible({ timeout: 10000 });

    await page.click('#btnLogout');
    await expect(page.locator('#authLoggedOut')).toBeVisible();

    await page.fill('#inputUsername', username);
    await page.fill('#inputPassword', 'wrong-password-9');
    await page.click('#btnLogin');
    await expect(page.locator('#authMsg')).toContainText('不正确');
    await expect(page.locator('#authLoggedIn')).toBeHidden();
  });

  test('自检页两个状态灯为绿（REST + WebSocket 链路）', async ({ page }) => {
    await page.goto('/pvp.html');
    await expect(page.locator('#restState')).toHaveText('正常', { timeout: 15000 });
    await expect(page.locator('#wsState')).toHaveText('已连接', { timeout: 15000 });
    await expect(page.locator('#fSnapshot')).toContainText('15');
    await expect(page.locator('#fAccounts')).toContainText('个');
  });
});
