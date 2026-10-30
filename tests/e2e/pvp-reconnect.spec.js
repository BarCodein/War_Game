import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, registerDirect } from './helpers.js';

// P5 断线重连（浏览器双上下文）：
//   1. 关掉一端的页面 → 另一端出现「对手掉线，N 秒内可重连」
//   2. 宽限内重开页面 → 对手收到「对手已重连」，快照继续（对局没结束）
//   3. 超过宽限不回来 → 留下的一方直接拿到结算（disconnect-timeout）
// 服务器宽限在 playwright.config.js 里设成 PVP_RECONNECT_SECONDS=4（线上默认 30 秒）。
const password = 'reconnect-e2e-1';
const GRACE_SECONDS = 4;

async function startMatch(browser, stamp) {
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await registerDirect(pageA, `ra_${stamp}`, password);
  await registerDirect(pageB, `rb_${stamp}`, password);
  const code = await createRoom(pageA);
  await joinRoom(pageB, code);
  await expect(pageA.locator('#roomPlayers tbody tr')).toHaveCount(2, { timeout: 20000 });
  await pageA.click('#btnReady');
  await pageB.click('#btnReady');

  await pageA.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
  await pageB.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
  await expect(pageA.locator('#battleStatus')).toContainText('已进入对局', { timeout: 20000 });
  await expect(pageB.locator('#battleStatus')).toContainText('已进入对局', { timeout: 20000 });
  await expect.poll(() => pageA.evaluate(() => window.__pvp?.snapshotCount ?? 0), { timeout: 20000 })
    .toBeGreaterThan(3);

  const battleUrl = pageB.url();
  return { contextA, contextB, pageA, pageB, code, battleUrl };
}

test.describe('PvP 断线重连', () => {
  test('对手掉线 → 横幅提示；宽限内重开页面 → 续局成功', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const { contextA, contextB, pageA, pageB, battleUrl } = await startMatch(browser, stamp);

    try {
      const snapsBefore = await pageA.evaluate(() => window.__pvp.snapshotCount);

      // 关掉 B 的页面 = 断线
      await pageB.close();
      await expect(pageA.locator('#toast')).toContainText('对手掉线', { timeout: 10000 });
      // 宽限秒数不再进 toast 文案（toast 只报"对手掉线，等待重连"），改用客户端握手的宽限值断言
      await expect.poll(() => pageA.evaluate(() => Math.round((window.__pvp?.reconnectGraceMs ?? 0) / 1000)), { timeout: 10000 })
        .toBe(GRACE_SECONDS);

      // A 的对局继续推进（快照还在涨）
      await expect.poll(() => pageA.evaluate(() => window.__pvp.snapshotCount), { timeout: 15000 })
        .toBeGreaterThan(snapsBefore + 2);

      // 宽限内重开 B：新标签页（同 context，Cookie 仍在）→ 自动续局
      const pageB2 = await contextB.newPage();
      await pageB2.goto(battleUrl, { waitUntil: 'domcontentloaded' });
      await expect(pageB2.locator('#battleStatus')).toContainText('已进入对局', { timeout: 20000 });
      await expect(pageA.locator('#toast')).toContainText('对手已重连', { timeout: 15000 });

      // 续局后两端都还在收快照
      const before = await pageA.evaluate(() => window.__pvp.snapshotCount);
      await expect.poll(() => pageA.evaluate(() => window.__pvp.snapshotCount), { timeout: 15000 })
        .toBeGreaterThan(before);
      await expect.poll(() => pageB2.evaluate(() => window.__pvp?.snapshotCount ?? 0), { timeout: 15000 })
        .toBeGreaterThan(3);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('超过宽限不回来 → 留下的一方直接拿到结算', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const { contextA, contextB, pageA } = await startMatch(browser, stamp);

    try {
      const endPayload = pageA.waitForEvent('console', { timeout: 20000 }).catch(() => null);
      await contextB.close();   // 整页关掉，不再回来

      // 断线超时 → 服务端结算：客户端 result 落地并且结算浮层加上 .show（战役同款浮层）
      await expect.poll(() => pageA.evaluate(() => window.__pvp?.result?.winner ?? null), { timeout: 25000 })
        .not.toBeNull();
      await expect.poll(() => pageA.evaluate(() => document.querySelector('#victoryOverlay')?.classList.contains('show') ?? false), { timeout: 10000 })
        .toBe(true);
      await expect(pageA.locator('#victoryTitle')).toContainText('胜利');
      await expect(pageA.locator('#victoryDetail')).toContainText('掉线');
      // 正常结束（掉线超时判定）也走同一个结算按钮 → 必须真的回大厅
      await pageA.click('#restartButton');
      await pageA.waitForURL(/\/pvp\.html/, { timeout: 15000 });
      await endPayload;
    } finally {
      await contextA.close();
    }
  });
});
