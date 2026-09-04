import { expect, test } from '@playwright/test';

// 冒烟测试：页面加载、画布渲染、Phaser 启动（GameScene.create 置 window.__gameReady）。
test('页面加载并启动 Phaser 游戏', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/War of Dots/);
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => window.__gameReady === true);
});
