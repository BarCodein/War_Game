import { expect, test } from '@playwright/test';
import { waitForGame } from './helpers.js';

// 冒烟测试：页面加载、画布渲染、Phaser 启动（GameScene.create 置 window.__gameReady）。
test('页面加载并启动 Phaser 游戏', async ({ page }) => {
  await page.goto('/game.html');
  await expect(page).toHaveTitle(/沙盘战争/);
  await expect(page.locator('#battlefield canvas')).toBeVisible();
  await page.waitForFunction(() => window.__gameReady === true);
});

test('主页提供游戏与地图编辑器入口', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.home-card.primary')).toBeVisible();
  await expect(page.locator('.home-card')).toHaveCount(2);
  await expect(page.locator('.home-card.primary')).toHaveAttribute('href', '/game.html');
  await expect(page.locator('.home-card').nth(1)).toHaveAttribute('href', '/editor.html');
});

test('关卡由 URL 定位：?level=<id> 加载标准关卡', async ({ page }) => {
  await page.goto('/game.html?level=fracture-canyon', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#battlefield canvas')).toBeVisible();
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 60000 });
  const state = await page.evaluate(() => ({
    levelId: window.__game.scene.level?.id ?? null,
    type: window.__game.scene.level?.type ?? null,
    // 兵力来自关卡 JSON：蓝 6 轻 2 重 + 红 2 轻 2 重 = 12（城市生产已关闭，不会随时间增加）
    units: window.__game.world.units.length,
    hasAi: Boolean(window.__game.scene.ai),
  }));
  expect(state.levelId).toBe('fracture-canyon');
  expect(state.type).toBe('offensive');
  expect(state.units).toBe(12);
  expect(state.hasAi).toBe(true);
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

test('在 1920×1080 下正常启动', async () => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await waitForGame(page);
  await expect(page.locator('#battlefield canvas')).toBeVisible();
});

// 读秒（开局准备阶段）里模拟不推进，但"哪些敌军现在看得见"是当前状态的派生视图，
// 必须建场就算好：否则整张图未探索、渲染层用 isSpotted() 藏掉全部红军，
// 开局本来就该看到的敌情要等倒计时结束才突然出现。
test('读秒阶段就显示视野与可侦测的敌军', async ({ page }) => {
  test.setTimeout(90000);
  // 渡江战役开局：蓝军视野内本来就有 13 支红军部队（其余关卡为 0~11 不等）
  await page.goto('/game.html?level=dujiang_battle', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 60000 });
  // 点暂停按钮（真实 UI 路径）：读秒与模拟一起冻住，保证下面读到的是"还没 tick 过"的状态
  await page.click('#pauseButton');

  const state = await page.evaluate(() => {
    const { world, controller } = window.__game;
    const terrain = world.terrain;
    const visible = world.fog.blue.reduce((n, value) => n + (value === 2 ? 1 : 0), 0);
    // 渲染层藏敌军的判据（unitRenderer）：所在格当前可见才会画出来
    const spottedReds = world.units.filter((unit) => {
      if (unit.faction !== 'red' || unit.state === 'dead') return false;
      const cell = terrain.cellAt(unit.x, unit.y);
      return world.fog.blue[terrain.cellIndex(cell.cx, cell.cy)] === 2;
    }).length;
    return {
      paused: controller.paused,
      prepping: controller.isPrepping(),
      time: world.time,
      visible,
      spottedReds,
    };
  });

  expect(state.paused).toBe(true);
  expect(state.prepping).toBe(true);
  expect(state.time).toBe(0); // 一次 tick 都没跑过 = 真的还在读秒阶段
  expect(state.visible).toBeGreaterThan(0);
  expect(state.spottedReds).toBeGreaterThan(0);
});
