import { expect } from '@playwright/test';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export async function waitForGame(page) {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready); // 等字体就绪，避免布局漂移导致画布坐标失效
  await expect(page.locator('#battlefield canvas')).toBeVisible();
  // 并行负载下软件渲染启动较慢，给足等待时间
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 60000 });
}

// 世界坐标 → 页面坐标点击（补偿 Scale.FIT 缩放与画布偏移）
export async function clickWorld(page, x, y, options = {}) {
  const canvas = page.locator('#battlefield canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(
    box.x + (x / GAME_WIDTH) * box.width,
    box.y + (y / GAME_HEIGHT) * box.height,
    options,
  );
}

export async function dragWorld(page, from, to) {
  const canvas = page.locator('#battlefield canvas');
  const box = await canvas.boundingBox();
  const scale = (point) => ({
    x: box.x + (point.x / GAME_WIDTH) * box.width,
    y: box.y + (point.y / GAME_HEIGHT) * box.height,
  });
  const start = scale(from);
  const end = scale(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

// 读取第一个存活蓝军单位的世界坐标
export async function firstBlueUnit(page) {
  return page.evaluate(() => {
    const unit = window.__game.world.units.find(u => u.faction === 'blue' && u.state !== 'dead');
    return unit ? { id: unit.id, x: unit.x, y: unit.y } : null;
  });
}

export async function firstRedUnit(page) {
  return page.evaluate(() => {
    const unit = window.__game.world.units.find(u => u.faction === 'red' && u.state !== 'dead');
    return unit ? { id: unit.id, x: unit.x, y: unit.y } : null;
  });
}
