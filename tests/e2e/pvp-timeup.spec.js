import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, registerDirect } from './helpers.js';

// 正常结束（时间到）→ 结算浮层 → 点「返回大厅」必须真的回到大厅。
// 用法：服务端需带 `PVP_MATCH_MINUTES` 很短的值启动（本测试默认 1 分钟，跑一次约 70 秒）。
const PASSWORD = 'timeup-e2e-pass-1';

test.describe('PvP 正常结束（时间到）', () => {
  test('时间到判平/判胜 → 结算 → 返回大厅', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await registerDirect(pageA, `ta_${stamp}`, PASSWORD);
      await registerDirect(pageB, `tb_${stamp}`, PASSWORD);
      const code = await createRoom(pageA);
      await joinRoom(pageB, code);
      await pageA.click('#btnReady');
      await pageB.click('#btnReady');
      await pageA.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await pageB.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await expect.poll(() => pageA.evaluate(() => window.__pvp?.lastSnapshot?.phase), { timeout: 25000 }).toBe('playing');

      // 等时间到（PVP_MATCH_MINUTES 设 1 分钟时，最多等 100 秒）
      await expect.poll(() => pageA.evaluate(() => window.__pvp?.result?.reason ?? null), { timeout: 150000 })
        .toBe('time-limit');
      await expect.poll(() => pageA.evaluate(() => document.querySelector('#victoryOverlay')?.classList.contains('show') ?? false), { timeout: 10000 })
        .toBe(true);
      await expect(pageA.locator('#victoryDetail')).toContainText('时限');

      // 结算按钮 → 回大厅
      await expect(pageA.locator('#restartButton')).toHaveText('返回大厅');
      await pageA.click('#restartButton');
      await pageA.waitForURL(/\/pvp\.html/, { timeout: 15000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
