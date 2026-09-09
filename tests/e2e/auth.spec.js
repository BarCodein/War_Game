import { expect, test } from '@playwright/test';

test.describe('访问控制与认证', () => {
  test('未登录访问主页会跳转登录页，注册后返回原页面', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/index.html');
    await expect(page).toHaveURL(/\/login\.html\?next=%2Findex\.html/);

    const username = `e2e-${Date.now()}`;
    await page.click('#registerTab');
    await page.fill('#username', username);
    await page.fill('#password', 'secret123');
    await page.click('#authSubmit');
    await expect(page).toHaveURL(/\/index\.html$/);
    await expect(page.locator('#logoutButton')).toBeVisible();
  });

  test('退出登录会清除会话并回到登录页', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('#logoutButton');
    await expect(page).toHaveURL(/\/login\.html$/);
    expect(await page.evaluate(() => localStorage.getItem('war-of-dots.session'))).toBeNull();
  });
});
