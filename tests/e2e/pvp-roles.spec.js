import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, registerDirect } from './helpers.js';

// §11.21：身份（蓝/红/观战）、同阵营多人、全队投降、观战全局视野
const PASSWORD = 'roles-e2e-pass-1';

async function ready(page) {
  await page.click('#btnReady');
}

test.describe('PvP 身份 / 多人同阵营 / 全队投降 / 观战', () => {
  test('蓝方 2 人 + 红方 1 人 + 观战 1 人：观战全局视野、部分投降不结束、全队投降才结束', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 1280, height: 800 } })));
    const [pageA, pageB, pageC, pageD] = await Promise.all(contexts.map((context) => context.newPage()));

    try {
      await registerDirect(pageA, `ra_${stamp}`, PASSWORD);
      await registerDirect(pageB, `rb_${stamp}`, PASSWORD);
      await registerDirect(pageC, `rc_${stamp}`, PASSWORD);
      await registerDirect(pageD, `rd_${stamp}`, PASSWORD);

      const code = await createRoom(pageA);          // A: blue
      await joinRoom(pageB, code);                    // B: red
      await joinRoom(pageC, code);                    // C: blue（自动补位）
      await joinRoom(pageD, code);                    // D: 自动补位 → 切换成观战

      // D 切换到观战
      await expect(pageD.locator('#roomActive')).toBeVisible({ timeout: 20000 });
      await pageD.click('#btnRoleSpec');
      await expect(pageD.locator('#roomPlayers tbody tr')).toHaveCount(4, { timeout: 15000 });
      await expect.poll(async () => pageD.evaluate(() => {
        const table = document.querySelector('#roomPlayers tbody');
        return Array.from(table.querySelectorAll('tr')).map((row) => row.children[1].textContent).join(',');
      }), { timeout: 15000 }).toContain('观战');
      // 观战者没有准备按钮
      await expect(pageD.locator('#btnReady')).toBeHidden();

      // 参战者准备 → 开局（观战者也跟着进对局页）
      await ready(pageA);
      await ready(pageB);
      await ready(pageC);
      for (const page of [pageA, pageB, pageC, pageD]) {
        await page.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      }
      for (const page of [pageA, pageB, pageC, pageD]) {
        await expect.poll(() => page.evaluate(() => window.__pvp?.lastSnapshot?.phase), { timeout: 30000 }).toBe('playing');
      }

      // ---------- 观战者：全局视野 + 能看敌方补给线 + 不能下令 ----------
      const spectator = await pageD.evaluate(() => ({
        spectator: window.__pvp.spectator === true,
        units: window.__pvp.world.units.filter((unit) => unit.state !== 'dead').length,
        factions: [...new Set(window.__pvp.world.units.map((unit) => unit.faction))].sort(),
        resignHidden: document.querySelector('#resignButton')?.hidden === true,
      }));
      expect(spectator.spectator).toBe(true);
      expect(spectator.units).toBeGreaterThanOrEqual(3);
      expect(spectator.factions).toEqual(['blue', 'red']);
      expect(spectator.resignHidden).toBe(true);

      // 选中一个"红方"单位（观战者能选敌方）→ 补给线能被画出来
      const enemySupply = await pageD.evaluate(() => {
        const debug = window.__pvp;
        const enemy = debug.world.units.find((unit) => unit.faction === 'red' && unit.state !== 'dead');
        if (!enemy) return null;
        debug.selection.select([enemy.id]);
        return { id: enemy.id, selected: debug.selection.ids().length };
      });
      expect(enemySupply?.selected).toBe(1);
      await expect.poll(() => pageD.evaluate(() => window.__pvp.deriveStats?.supplySelected ?? 0), { timeout: 15000 })
        .toBeGreaterThanOrEqual(1);

      // 观战降频（7.5Hz）后插值窗口必须跟着实测间隔走：否则 alpha 半程就到 1 → 后半段单位定住 = 卡顿
      const smooth = await pageD.evaluate(async () => {
        const samples = [];
        for (let i = 0; i < 24; i += 1) {
          samples.push(window.__pvp.deriveStats?.lastAlpha ?? 1);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
          interval: window.__pvp.deriveStats?.snapshotIntervalMs ?? 0,
          minAlpha: Math.min(...samples),
          maxAlpha: Math.max(...samples),
        };
      });
      expect(smooth.interval).toBeGreaterThanOrEqual(100);   // 观战 ≈133ms（7.5Hz）
      expect(smooth.interval).toBeLessThanOrEqual(200);
      expect(smooth.minAlpha).toBeLessThan(0.5);             // 间隔内仍在推进，没有"定住半程"
      expect(smooth.maxAlpha).toBeLessThanOrEqual(1.01);

      // 观战者右键下令：不应产生任何命令
      const beforeCommands = await pageD.evaluate(() => window.__pvp.commandsSent ?? 0);
      const clickPoint = await pageD.evaluate(() => {
        const debug = window.__pvp;
        const unit = debug.world.units.find((item) => item.state !== 'dead');
        return debug.projectToScreen(unit.x + 40, unit.y + 80);
      });
      await pageD.mouse.click(clickPoint.x, clickPoint.y, { button: 'right' });
      await pageD.waitForTimeout(800);
      expect(await pageD.evaluate(() => window.__pvp.commandsSent ?? 0)).toBe(beforeCommands);

      // ---------- 全队投降：蓝方 2 人，先投 1 人不结束 ----------
      await pageA.click('#resignButton');
      await expect.poll(() => pageC.evaluate(() => window.__pvp?.resignState?.resigned ?? 0), { timeout: 15000 }).toBe(1);
      for (const page of [pageA, pageB, pageC]) {
        await expect.poll(() => page.evaluate(() => window.__pvp?.result ?? null), { timeout: 3000 }).toBeNull();
      }

      // 蓝方第二个人投降 → 该阵营全队投降 → 立即结算，胜者是红方
      await pageC.click('#resignButton');
      for (const page of [pageA, pageB, pageC]) {
        await expect.poll(() => page.evaluate(() => window.__pvp?.result?.reason ?? null), { timeout: 20000 }).toBe('forfeit');
        await expect.poll(() => page.evaluate(() => document.querySelector('#victoryOverlay')?.classList.contains('show') ?? false), { timeout: 10000 }).toBe(true);
      }
      await expect(pageB.locator('#victoryTitle')).toContainText('胜利');
      await expect(pageA.locator('#victoryTitle')).toContainText('失败');
    } finally {
      for (const context of contexts) await context.close().catch(() => {});
    }
  });
});
