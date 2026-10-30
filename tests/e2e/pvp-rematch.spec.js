import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, registerDirect } from './helpers.js';

// 再开一把：结算窗点「返回大厅」后，双方自动回到**同一个房间**（房间码不变），
// 直接点「准备」即可开下一局，不需要重新输入/转发房间码。
const PASSWORD = 'rematch-e2e-pass-1';

test.describe('PvP 再开一把', () => {
  test('认输 → 双方回大厅 → 自动仍在原房间 → 双方准备 → 第二局开始', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await registerDirect(pageA, `ma_${stamp}`, PASSWORD);
      await registerDirect(pageB, `mb_${stamp}`, PASSWORD);
      const code = await createRoom(pageA);
      await joinRoom(pageB, code);
      await pageA.click('#btnReady');
      await pageB.click('#btnReady');
      await pageA.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await pageB.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await expect.poll(() => pageA.evaluate(() => window.__pvp?.lastSnapshot?.phase), { timeout: 25000 }).toBe('playing');

      // A 认输 → 双方结算 → 都点「返回大厅」
      await pageA.click('#resignButton');
      for (const page of [pageA, pageB]) {
        await expect.poll(() => page.evaluate(() => window.__pvp?.result?.reason ?? null), { timeout: 20000 }).toBe('forfeit');
        await page.click('#restartButton');
        await page.waitForURL(/\/pvp\.html/, { timeout: 15000 });
      }

      // 双方都应自动回到同一个房间（房间码不变）
      for (const page of [pageA, pageB]) {
        await expect(page.locator('#roomActive')).toBeVisible({ timeout: 20000 });
        await expect(page.locator('#roomCode')).toHaveText(code);
        await expect(page.locator('#roomPlayers tbody tr')).toHaveCount(2, { timeout: 20000 });
      }

      // 直接点准备 → 第二局开始（不需要重新输房间码）
      await pageA.click('#btnReady');
      await pageB.click('#btnReady');
      await pageA.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await pageB.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await expect.poll(() => pageA.evaluate(() => window.__pvp?.lastSnapshot?.phase), { timeout: 25000 }).toBe('playing');
      // 第二局确实在被推进（快照在涨）
      const first = await pageA.evaluate(() => window.__pvp.snapshotCount);
      await expect.poll(() => pageA.evaluate(() => window.__pvp.snapshotCount), { timeout: 15000 }).toBeGreaterThan(first + 3);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
