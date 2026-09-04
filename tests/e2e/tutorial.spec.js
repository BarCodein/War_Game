import { expect, test } from '@playwright/test';
import { waitForGame } from './helpers.js';

// 教学关完整闭环（验收 E1）：指挥 → 交战 → 迷雾/士气 → 占领 → 胜利结算。
// 为让对局确定性地在短时间内分出胜负，测试注入额外蓝军兵力；
// 教学关本身的兵力平衡在阶段 4 调优（gdd.md §10 数值均为暂定）。
test.describe('教学关完整对局', () => {
  test('蓝军攻占信标并出现胜利结算', async ({ page }) => {
    test.setTimeout(180000); // 完整对局需要数十秒游戏时间
    await waitForGame(page);
    await page.evaluate(() => {
      const world = window.__game.world;
      for (let i = 0; i < 6; i += 1) world.spawnUnit('blue', 'light', 170 + i * 15, 580);
      // 自动指挥：每秒全军向信标 attackMove（模拟玩家连续指挥，验证全链路）
      window.__autoCommander = setInterval(() => {
        if (world.winner) return;
        const ids = world.units.filter(u => u.state !== 'dead' && u.faction === 'blue').map(u => u.id);
        world.issueCommands(ids, { type: 'attackMove', target: { x: 1080, y: 160 } });
      }, 1000);
    });

    await expect(page.locator('#victoryOverlay')).toHaveClass(/show/, { timeout: 120000 });
    await expect(page.locator('#victoryTitle')).toHaveText('胜利');
    await expect(page.locator('#missionList .sub-objective').last()).toHaveClass(/done/);
    await expect(page.locator('#eventLog')).toContainText('占领了城市');

    await page.evaluate(() => clearInterval(window.__autoCommander));
  });

  test('低士气单位在编队列表显示状态标签', async ({ page }) => {
    await waitForGame(page);
    await page.evaluate(() => {
      const unit = window.__game.world.units.find(u => u.faction === 'blue' && u.state !== 'dead');
      unit.morale = 50; // 削弱阈值之下
    });
    await expect(page.locator('.unit-card small').first()).toContainText('削弱', { timeout: 5000 });
  });

  test('暂停与速度控制', async ({ page }) => {
    await waitForGame(page);
    // 暂停：世界时间冻结
    await page.keyboard.press('Space');
    await expect(page.locator('#pauseButton')).toHaveText('▶');
    const frozen = await page.evaluate(() => window.__game.world.time);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => window.__game.world.time);
    expect(after).toBe(frozen);
    await page.keyboard.press('Space'); // 恢复
    // 速度切换：2×
    await page.click('[data-speed="2"]');
    await expect(page.locator('[data-speed="2"]')).toHaveClass(/active/);
    const speed = await page.evaluate(() => window.__game.controller.speed);
    expect(speed).toBe(2);
  });
});
