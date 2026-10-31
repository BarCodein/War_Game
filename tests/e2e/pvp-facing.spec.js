import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, registerDirect } from './helpers.js';

// 回归：联机里**敌方行军路线不下发**，敌方单位前进时必须按位移转向，
// 否则永远保持初始角度（需求方反馈的 bug）。这里让对手（红方）往东走，
// 由蓝方读取红方精灵的显示角度，应当接近 0 弧度（向东）。
const PASSWORD = 'facing-e2e-pass-1';

test.describe('敌方单位朝向', () => {
  test('对手单位向东前进 → 蓝方看到的精灵朝向约 0 弧度', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await registerDirect(pageA, `fa_${stamp}`, PASSWORD);
      await registerDirect(pageB, `fb_${stamp}`, PASSWORD);
      const code = await createRoom(pageA);
      await joinRoom(pageB, code);
      await pageA.click('#btnReady');
      await pageB.click('#btnReady');
      await pageA.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await pageB.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await expect.poll(() => pageA.evaluate(() => window.__pvp?.lastSnapshot?.phase), { timeout: 25000 }).toBe('playing');

      // 红方（B）选一个单位，往正东方向拖一条路径
      const red = await pageB.evaluate(() => {
        const debug = window.__pvp;
        const unit = debug.world.units.find((item) => item.faction === debug.myFaction && item.state !== 'dead');
        debug.selection.select([unit.id]);
        return {
          id: unit.id,
          from: debug.projectToScreen(unit.x, unit.y),
          to: debug.projectToScreen(unit.x + 220, unit.y),
        };
      });
      await pageB.mouse.move(red.from.x, red.from.y);
      await pageB.mouse.down();
      await pageB.mouse.move(red.to.x, red.to.y, { steps: 8 });
      await pageB.mouse.up();

      // 蓝方（A）等这个红方单位动起来，再读它精灵的显示角度
      const facing = await expect.poll(async () => pageA.evaluate((id) => {
        const debug = window.__pvp;
        const unit = debug.world.units.find((item) => item.id === id);
        const angle = debug.facingOf?.(id) ?? null;
        if (angle === null) return null;
        // 归一化到 [-π, π]，向东应接近 0
        return Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
      }, red.id), { timeout: 25000, intervals: [400, 800, 1200] }).toBeLessThan(0.5);
      await facing;
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
