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

  test('Esc 取消选择', async ({ page }) => {
    await waitForGame(page);
    const unit = await firstBlueUnit(page);
    await clickWorld(page, unit.x, unit.y);
    await expect(page.locator('#selectionReadout')).toHaveText('1 个单位已选择');
    await page.keyboard.press('Escape');
    await expect(page.locator('#selectionReadout')).toHaveText('未选择单位');
  });
});
