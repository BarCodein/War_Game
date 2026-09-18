import { test, expect } from '@playwright/test';
import { waitForGame } from './helpers.js';

// 补给线渲染（gdd.md §8）：**选中单位时**在地图上画出它的补给线。
// 规则本身（路径代价 / 容量 / 断补）由 tests/unit/supply-path.test.js 覆盖；
// 这里验的是渲染层真的画了：`scene.supplyLines.state` 是上一帧的画线结果。
test.describe('补给线', () => {
  test('选中单位后画出补给线（线宽随实收占比）', async ({ page }) => {
    await waitForGame(page);
    await page.evaluate(() => window.__game.controller.skipPrep());
    await page.waitForFunction(() => window.__game.world.supplyToken > 0, null, { timeout: 15000 });

    // 造一个看得清的演示场景：东北角放一座蓝城 + 一个远一点的蓝方单位
    const demo = await page.evaluate(() => {
      const world = window.__game.world;
      world.cities.push({ id: 'demo-city', x: 980, y: 160, faction: 'blue', captureProgress: 0, productionTimer: 0 });
      const unit = world.spawnUnit('blue', 'light', 520, 480);
      return { id: unit.id };
    });
    await page.waitForTimeout(2500); // 等代价场重算（1 s 一轮）+ 分配

    await page.evaluate((id) => window.__game.selection.select([id]), demo.id);
    await page.waitForTimeout(300); // 让渲染层画一帧

    const unit = await page.evaluate((id) => {
      const u = window.__game.world.units.find(x => x.id === id);
      return { edges: u.supplyEdges.length, ratio: u.supplyRatio, supplied: u.supplied };
    }, demo.id);
    const drawn = await page.evaluate(() => window.__game.scene.supplyLines.state);

    expect(unit.supplied).toBe(true);
    expect(unit.edges).toBeGreaterThan(0);
    expect(drawn.lines).toBeGreaterThan(0);  // 画出了补给线
    expect(drawn.cuts).toBe(0);
    expect(drawn.note).toBeNull();
    await page.screenshot({ path: 'test-results/supply-lines.png' });
  });

  test('补给线被敌方控制区切断时：红色虚线 + 切断点 + 提示', async ({ page }) => {
    await waitForGame(page);
    await page.evaluate(() => window.__game.controller.skipPrep());
    await page.waitForFunction(() => window.__game.world.supplyToken > 0, null, { timeout: 15000 });

    const demo = await page.evaluate(() => {
      const world = window.__game.world;
      const unit = world.spawnUnit('blue', 'light', 520, 480);
      return { id: unit.id };
    });
    await page.waitForTimeout(1200);

    // 用红方单位把该单位围一圈（半径 120、12 个、间隔 63 px，影响力半径 140 连成整圈）
    // → 往任何己方城市走都要穿过敌方实际控制区 → 断补
    await page.evaluate((id) => {
      const world = window.__game.world;
      const unit = world.units.find(x => x.id === id);
      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * Math.PI * 2;
        world.spawnUnit('red', 'light', unit.x + Math.cos(angle) * 120, unit.y + Math.sin(angle) * 120);
      }
    }, demo.id);
    await page.waitForTimeout(2600); // 等两轮代价场（1 s 一轮）

    await page.evaluate((id) => window.__game.selection.select([id]), demo.id);
    await page.waitForTimeout(300);

    const unit = await page.evaluate((id) => {
      const u = window.__game.world.units.find(x => x.id === id);
      return { supplied: u.supplied, ratio: u.supplyRatio };
    }, demo.id);
    const drawn = await page.evaluate(() => window.__game.scene.supplyLines.state);

    expect(unit.supplied).toBe(false);
    expect(unit.ratio).toBeLessThan(1);
    expect(drawn.cuts).toBeGreaterThan(0);      // 画了红色虚线 + 切断点
    expect(drawn.note).toBe('补给被切断');
    await page.screenshot({ path: 'test-results/supply-lines-cut.png' });
  });
});
