import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, registerDirect } from './helpers.js';

// 认输：点「认输」→ 立即判负 → 双方都弹结算浮层（战役同款 #victoryOverlay.show）
const PASSWORD = 'resign-e2e-pass-1';

test.describe('PvP 认输', () => {
  test('一方认输 → 双方都出现结束弹窗，胜者是对方', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await registerDirect(pageA, `ra_${stamp}`, PASSWORD);
      await registerDirect(pageB, `rb_${stamp}`, PASSWORD);
      const code = await createRoom(pageA);
      await joinRoom(pageB, code);
      await pageA.click('#btnReady');
      await pageB.click('#btnReady');
      await pageA.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await pageB.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await expect.poll(() => pageA.evaluate(() => window.__pvp?.lastSnapshot?.phase), { timeout: 25000 }).toBe('playing');

      // A 认输（顶栏按钮，无二次确认）
      await expect(pageA.locator('#resignButton')).toBeVisible({ timeout: 10000 });
      await pageA.click('#resignButton');

      // 双方都必须收到结算并弹出浮层
      for (const page of [pageA, pageB]) {
        await expect.poll(() => page.evaluate(() => window.__pvp?.result?.reason ?? null), { timeout: 20000 })
          .toBe('forfeit');
        await expect.poll(() => page.evaluate(() => document.querySelector('#victoryOverlay')?.classList.contains('show') ?? false), { timeout: 10000 })
          .toBe(true);
      }
      // 认输方 = 失败，另一方 = 胜利
      await expect(pageA.locator('#victoryTitle')).toContainText('失败');
      await expect(pageB.locator('#victoryTitle')).toContainText('胜利');
      await expect(pageA.locator('#victoryDetail')).toContainText('认输');
      // 结算按钮是「返回大厅」，点击后真的回到大厅（之前的 bug：点了没反应只 reload 对局页）
      await expect(pageA.locator('#restartButton')).toHaveText('返回大厅');
      await pageA.click('#restartButton');
      await pageA.waitForURL(/\/pvp\.html/, { timeout: 15000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
