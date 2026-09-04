import { expect, test } from '@playwright/test';
import { clickWorld, firstBlueUnit, firstRedUnit, waitForGame } from './helpers.js';

test.describe('指挥输入', () => {
  test('右键空地 → attackMove，单位向目标推进', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await clickWorld(page, unit.x, unit.y); // 选中
    const startX = unit.x;
    await clickWorld(page, 600, 300, { button: 'right' });
    // 行为断言：命令类型为 attackMove（toast 文本受队列影响，不作为断言依据）
    const commandType = await page.evaluate((id) => {
      const u = window.__game.world.units.find(item => item.id === id);
      return u?.command?.type ?? null;
    }, unit.id);
    expect(commandType).toBe('attackMove');
    // 单位应向目标方向移动
    await expect.poll(async () => {
      const state = await page.evaluate((id) => {
        const u = window.__game.world.units.find(item => item.id === id);
        return u ? u.x : -Infinity;
      }, unit.id);
      return state;
    }, { timeout: 10000 }).toBeGreaterThan(startX + 50);
  });

  test('右键目视敌军 → attack 命令', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await clickWorld(page, unit.x, unit.y);
    // 把蓝军传送到红军近旁（森林目视需 ≤60px），待迷雾目视更新
    await page.evaluate((id) => {
      const u = window.__game.world.units.find(item => item.id === id);
      u.x = 1080;
      u.y = 230;
    }, unit.id);
    await expect.poll(async () => {
      return page.evaluate(() => {
        const red = window.__game.world.units.find(u => u.faction === 'red' && u.state !== 'dead');
        return red ? red.lastSeen.blue !== null : false;
      });
    }, { timeout: 5000 }).toBe(true);
    const red = await firstRedUnit(page); // 目视后再取实时坐标
    await clickWorld(page, red.x, red.y, { button: 'right' });
    const commandType = await page.evaluate((id) => {
      const u = window.__game.world.units.find(item => item.id === id);
      return u?.command?.type ?? null;
    }, unit.id);
    expect(commandType).toBe('attack');
  });

  test('敌军离开视野后显示最后已知位置虚影', async ({ page }) => {
    await waitForGame(page);
    // 蓝军传送至红军近旁（目视）→ 再传送离开 → 渲染器应画出虚影
    await page.evaluate(() => {
      const unit = window.__game.world.units.find(u => u.faction === 'blue' && u.state !== 'dead');
      unit.x = 1080;
      unit.y = 230;
    });
    await expect.poll(() => page.evaluate(() => {
      const red = window.__game.world.units.find(u => u.faction === 'red' && u.state !== 'dead');
      return red ? red.lastSeen.blue !== null : false;
    }), { timeout: 5000 }).toBe(true);
    await page.evaluate(() => {
      const unit = window.__game.world.units.find(u => u.faction === 'blue' && u.state !== 'dead');
      unit.x = 500;
      unit.y = 300;
    });
    await expect.poll(() => page.evaluate(
      () => window.__game.scene.unitRenderer.stats.ghostCount,
    ), { timeout: 5000 }).toBeGreaterThan(0);
  });

  test('从已选单位拖动绘制轨迹 → move 命令', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await clickWorld(page, unit.x, unit.y);
    const canvas = page.locator('#battlefield canvas');
    const box = await canvas.boundingBox();
    const toPage = (x, y) => ({ x: box.x + x / 1280 * box.width, y: box.y + y / 720 * box.height });
    const start = toPage(unit.x, unit.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(toPage(unit.x + 200, unit.y).x, toPage(unit.x + 200, unit.y).y, { steps: 8 });
    await page.mouse.up();
    const commandType = await page.evaluate((id) => {
      const u = window.__game.world.units.find(item => item.id === id);
      return u?.command?.type ?? null;
    }, unit.id);
    expect(commandType).toBe('move');
  });

  test('释放轨迹后未走完的行军命令保留，且移动鼠标不再出现框选矩形', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await clickWorld(page, unit.x, unit.y);
    const canvas = page.locator('#battlefield canvas');
    const box = await canvas.boundingBox();
    const toPage = (x, y) => ({ x: box.x + x / 1280 * box.width, y: box.y + y / 720 * box.height });
    const start = toPage(unit.x, unit.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(toPage(unit.x + 200, unit.y).x, toPage(unit.x + 200, unit.y).y, { steps: 8 });
    await page.mouse.up();
    // 命令下达后立即读取：行军命令与剩余路径点仍在（单位尚未到达）
    const afterRelease = await page.evaluate((id) => {
      const u = window.__game.world.units.find(item => item.id === id);
      return { type: u?.command?.type ?? null, remaining: u?.route?.length - u?.routeIndex ?? 0 };
    }, unit.id);
    expect(afterRelease.type).toBe('move');
    expect(afterRelease.remaining).toBeGreaterThan(0);
    // 释放后移动鼠标（不按任何键）：不应再出现框选矩形（修复 dragging 悬挂）
    await page.mouse.move(toPage(600, 300).x, toPage(600, 300).y, { steps: 3 });
    const rect = await page.evaluate(() => window.__game.selection.getDragRect());
    expect(rect).toBeNull();
  });
});
