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

      // 红方（B）选一个**在屏幕内**的单位，往正东方向拖一条路径
      // （40v40 后单位分散在各地，随便挑一个可能落在相机视野外，拖拽点会被裁掉）
      const red = await pageB.evaluate(() => {
        const debug = window.__pvp;
        const canvas = debug.scene.game.canvas.getBoundingClientRect();
        // 只挑"离蓝方最近"的红方单位：蓝方客户端要能看见它（有精灵）才读得到朝向
        const blues = debug.world.units.filter((item) => item.faction !== debug.myFaction && item.state !== 'dead');
        const candidates = debug.world.units
          .filter((item) => item.faction === debug.myFaction && item.state !== 'dead')
          .sort((a, b) => {
            const near = (unit) => Math.min(...blues.map((blue) => Math.hypot(blue.x - unit.x, blue.y - unit.y)));
            return near(a) - near(b);
          });
        const unit = candidates.find((item) => {
          const point = debug.projectToScreen(item.x, item.y);
          const target = debug.projectToScreen(item.x + 120, item.y);
          return point.x > canvas.left + 40 && point.x < canvas.right - 160
            && point.y > canvas.top + 80 && point.y < canvas.bottom - 80
            && target.x < canvas.right - 20;
        }) ?? candidates[0];
        debug.selection.select([unit.id]);
        const from = debug.projectToScreen(unit.x, unit.y);
        const to = debug.projectToScreen(unit.x + 120, unit.y);
        return {
          id: unit.id,
          from: { x: Math.min(Math.max(from.x, canvas.left + 5), canvas.right - 5), y: Math.min(Math.max(from.y, canvas.top + 70), canvas.bottom - 5) },
          to: { x: Math.min(to.x, canvas.right - 5), y: Math.min(Math.max(to.y, canvas.top + 70), canvas.bottom - 5) },
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
