import { expect, test } from '@playwright/test';

// 统一登录页验收：
//   1. 未登录访问 /pvp.html → 跳 /login.html?next=/pvp.html
//   2. 在登录页注册 → 自动回到 /pvp.html 并显示已登录（大厅可见）
//   3. 战役页（index.html）也放行；登出后两边都失效
//   4. 首页有「联机对战」入口
const PASSWORD = 'unified-login-pass-1';

test.describe('统一登录页', () => {
  test('未登录访问对局大厅 → 跳统一登录页 → 注册后回到大厅', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const username = `uf_${stamp}`;

    // 1) 未登录进大厅 → 被送到统一登录页，并带上 next
    await page.goto('/pvp.html');
    await page.waitForURL(/\/login\.html\?next=/, { timeout: 20000 });
    expect(decodeURIComponent(page.url())).toContain('next=/pvp.html');

    // 2) 注册 → 自动回到 /pvp.html
    await page.fill('#username', username);
    await page.fill('#password', PASSWORD);
    await page.click('#registerTab');
    await page.click('#authSubmit');
    await page.waitForURL(/\/pvp\.html/, { timeout: 20000 });

    // 3) 大厅显示已登录 + 房间面板可用
    await expect(page.locator('#authLoggedIn')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#meName')).toHaveText(username);
    await expect(page.locator('#roomLobby')).toBeVisible({ timeout: 15000 });

    // 4) 本地会话已写入（战役页用同一份）
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('war-of-dots.session') || 'null'));
    expect(session?.username).toBe(username);

    // 5) 战役页同样放行（不再被踢去登录页）
    await page.goto('/index.html');
    await page.waitForURL(/\/index\.html/, { timeout: 15000 });

    // 6) 首页有联机入口
    await expect(page.locator('a.home-card[href="/pvp.html"]')).toBeVisible();

    // 7) 回大厅登出 → 回登录页，且不再能直接进大厅
    await page.goto('/pvp.html');
    await expect(page.locator('#authLoggedIn')).toBeVisible({ timeout: 20000 });
    await page.click('#btnLogout');
    await page.waitForURL(/\/login\.html/, { timeout: 20000 });
    await page.goto('/pvp.html');
    await page.waitForURL(/\/login\.html\?next=/, { timeout: 20000 });
    const clearedSession = await page.evaluate(() => localStorage.getItem('war-of-dots.session'));
    expect(clearedSession).toBeNull();
  });

  test('登录页密码错误给出明确提示', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const username = `ue_${stamp}`;
    await page.goto('/pvp.html');
    await page.waitForURL(/\/login\.html\?next=/, { timeout: 20000 });
    // 先注册一个账号
    await page.fill('#username', username);
    await page.fill('#password', PASSWORD);
    await page.click('#registerTab');
    await page.click('#authSubmit');
    await page.waitForURL(/\/pvp\.html/, { timeout: 20000 });
    // 登出后用错密码登录
    await page.click('#btnLogout');
    await page.waitForURL(/\/login\.html/, { timeout: 20000 });
    await page.fill('#username', username);
    await page.fill('#password', 'wrong-password-1');
    await page.click('#loginTab');
    await page.click('#authSubmit');
    await expect(page.locator('#authMessage')).toContainText('不正确', { timeout: 15000 });
  });

  test('战役页未登录也会被送到统一登录页', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForURL(/\/login\.html\?next=/, { timeout: 20000 });
    expect(decodeURIComponent(page.url())).toContain('next=/index.html');
  });
});
