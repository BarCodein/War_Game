import { expect, test } from '@playwright/test';
import { clickWorld, dragWorld, firstBlueUnit, waitForGame } from './helpers.js';

test.describe('单位选择', () => {
  test('左键单选单位，读条与卡片同步', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await clickWorld(page, unit.x, unit.y);
    await expect(page.locator('#selectionReadout')).toHaveText('1 个单位已选择');
    await expect(page.locator('.unit-card.active')).toHaveCount(1);
  });

  test('Shift 点击加选', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await clickWorld(page, unit.x, unit.y);
    // 把第二个单位传送到空地（远离其他单位），确保 Shift 点击只命中它
    const secondId = await page.evaluate((id) => {
      const units = window.__game.world.units.filter(u => u.faction === 'blue' && u.state !== 'dead');
      const other = units.find(u => u.id !== id);
      other.x = 600;
      other.y = 300;
      return other.id;
    }, unit.id);
    await page.waitForTimeout(300); // 等 HUD 与位置稳定
    await page.keyboard.down('Shift');
    await clickWorld(page, 600, 300);
    await page.keyboard.up('Shift');
    await expect(page.locator('#selectionReadout')).toHaveText('2 个单位已选择');
    await expect(page.locator('.unit-card.active')).toHaveCount(2);
    expect(await page.evaluate(id => window.__game.selection.selected.has(id), secondId)).toBe(true);
  });

  test('拖动框选选中出生点区域单位', async ({ page }) => {
    await waitForGame(page);
    await dragWorld(page, { x: 100, y: 480 }, { x: 400, y: 680 });
    const count = await page.evaluate(() => window.__game.selection.selected.size);
    expect(count).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#selectionReadout')).toContainText('个单位已选择');
  });

  test('点击单位不触发框选：按住不放（未拖动）时不绘制选框', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await page.evaluate((id) => { // 把其余蓝军挪远，保证点击只命中目标单位
      for (const u of window.__game.world.units) {
        if (u.faction === 'blue' && u.id !== id && u.state !== 'dead') {
          u.x = 900;
          u.y = 100;
        }
      }
    }, unit.id);
    const canvas = page.locator('#battlefield canvas');
    const box = await canvas.boundingBox();
    const px = box.x + (unit.x / 1280) * box.width;
    const py = box.y + (unit.y / 720) * box.height;
    await page.mouse.move(px, py);
    await page.mouse.down();
    const rect = await page.evaluate(() => window.__game.selection.getDragRect());
    expect(rect).toBeNull(); // 简单点击不应出现框选矩形
    await page.mouse.up();
    await expect(page.locator('#selectionReadout')).toHaveText('1 个单位已选择');
  });

  test('在单位上按下并小幅拖动仍是点击单选，不进入框选', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await page.evaluate((id) => { // 挪走其余蓝军，使拖动选框即使发生也只会框到单个单位
      for (const u of window.__game.world.units) {
        if (u.faction === 'blue' && u.id !== id && u.state !== 'dead') {
          u.x = 900;
          u.y = 100;
        }
      }
    }, unit.id);
    const canvas = page.locator('#battlefield canvas');
    const box = await canvas.boundingBox();
    const start = { x: box.x + (unit.x / 1280) * box.width, y: box.y + (unit.y / 720) * box.height };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + (30 / 1280) * box.width, start.y, { steps: 3 });
    // 拖动途中也不应进入框选模式（起点命中单位 → 点击语义）
    const midRect = await page.evaluate(() => window.__game.selection.getDragRect());
    expect(midRect).toBeNull();
    await page.mouse.up();
    const state = await page.evaluate((id) => {
      const s = window.__game.selection;
      return { size: s.selected.size, has: s.selected.has(id) };
    }, unit.id);
    expect(state).toEqual({ size: 1, has: true });
  });

  test('Esc 取消选择', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await clickWorld(page, unit.x, unit.y);
    await expect(page.locator('#selectionReadout')).toHaveText('1 个单位已选择');
    await page.keyboard.press('Escape');
    await expect(page.locator('#selectionReadout')).toHaveText('未选择单位');
  });
});
