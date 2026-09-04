import { expect, test } from '@playwright/test';
import { waitForGame } from './helpers.js';

// 教学关完整闭环（验收 E1）：指挥 → 交战 → 迷雾/士气 → 占领 → 胜利/失败结算。
// 兵力使用 GDD §10 配比（蓝 3轻1重 vs 红 2轻2重），headless 实测合理操作约 45s 获胜。
// 模拟由测试在页面内分块驱动（每块 10s 模拟时间），与渲染帧率解耦；
// 块间让出主线程，RAF 照常渲染 HUD 与结算界面。

// 在页面内推进模拟（world.tick + ai.update，镜像 GameScene.update 的推进方式）
function advanceSimChunk(page, ticks, issueCommandsEvery) {
  return page.evaluate(({ ticks, issueCommandsEvery }) => {
    const world = window.__game.world;
    const ai = window.__game.scene.ai;
    const step = 1 / 60;
    for (let i = 0; i < ticks && !world.winner; i += 1) {
      if (issueCommandsEvery && i % issueCommandsEvery === 0) {
        const ids = world.units.filter(u => u.state !== 'dead' && u.faction === 'blue').map(u => u.id);
        world.issueCommands(ids, { type: 'attackMove', target: { x: 1080, y: 160 } });
      }
      world.tick(step);
      ai.update(step);
    }
    return world.winner;
  }, { ticks, issueCommandsEvery });
}

async function runUntilWinner(page, issueCommandsEvery = 0) {
  for (let i = 0; i < 30; i += 1) { // 至多 300s 模拟时间
    const winner = await advanceSimChunk(page, 600, issueCommandsEvery); // 10s 模拟/块
    await page.waitForTimeout(150); // 让 RAF 渲染 HUD 与结算
    if (winner) return winner;
  }
  return null;
}

test.describe('教学关完整对局', () => {
  test('蓝军攻占信标并出现胜利结算（GDD 兵力配比）', async ({ page }) => {
    test.setTimeout(120000);
    await waitForGame(page);

    const winner = await runUntilWinner(page, 60); // 每 1s 模拟时间全军 attackMove 信标
    expect(winner).toBe('blue');

    await expect(page.locator('#victoryOverlay')).toHaveClass(/show/, { timeout: 5000 });
    await expect(page.locator('#victoryTitle')).toHaveText('胜利');
    await expect(page.locator('#missionList .sub-objective.done')).toHaveCount(4); // 任务链全部完成
    await expect(page.locator('#eventLog')).toContainText('占领了城市');
  });

  test('失败分支：蓝军覆灭后红军攻陷基地 → 失败结算', async ({ page }) => {
    test.setTimeout(120000);
    await waitForGame(page);
    await page.evaluate(() => {
      const world = window.__game.world;
      // 移除蓝军主力，仅留一名侦察兵越线送死（触发红军进攻）
      for (const unit of world.units.filter(u => u.faction === 'blue' && u.state !== 'dead')) {
        world.killUnit(unit, 'test');
      }
      const scout = world.spawnUnit('blue', 'light', 600, 550);
      world.issueCommands([scout.id], { type: 'attackMove', target: { x: 1080, y: 160 } });
    });

    const winner = await runUntilWinner(page);
    expect(winner).toBe('red');

    await expect(page.locator('#victoryOverlay')).toHaveClass(/show/, { timeout: 5000 });
    await expect(page.locator('#victoryTitle')).toHaveText('失败');
    await expect(page.locator('#victoryDetail')).toContainText('前线基地失守');
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
