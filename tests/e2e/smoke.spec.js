import { expect, test } from '@playwright/test';
import { waitForGame } from './helpers.js';

// 冒烟测试：页面加载、画布渲染、Phaser 启动（GameScene.create 置 window.__gameReady）。
test('页面加载并启动 Phaser 游戏', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/War of Dots/);
  await expect(page.locator('#battlefield canvas')).toBeVisible();
  await page.waitForFunction(() => window.__gameReady === true);
});

test('HUD 关键元素渲染', async ({ page }) => {
  await waitForGame(page);
  await expect(page.locator('#unitList .unit-card').first()).toBeVisible();
  await expect(page.locator('#missionList .sub-objective').first()).toHaveClass(/done/);
  await expect(page.locator('#timer')).not.toHaveText('00:00', { timeout: 8000 });
  // 战争迷雾三态在浏览器中生效（可见 + 未探索并存）
  const fog = await page.evaluate(() => {
    const grid = window.__game.world.fog.blue;
    return { visible: grid.some(v => v === 2), unexplored: grid.some(v => v === 0) };
  });
  expect(fog.visible).toBe(true);
  expect(fog.unexplored).toBe(true);
});

test('在 1920×1080 下正常启动', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await waitForGame(page);
  await expect(page.locator('#battlefield canvas')).toBeVisible();
});
