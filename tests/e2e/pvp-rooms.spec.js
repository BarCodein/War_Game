import { expect, test } from '@playwright/test';
import { registerDirect } from './helpers.js';

// P3 房间码匹配的浏览器流程（两个独立上下文 = 两个玩家）：
//   A 注册 → 建房拿到 6 位码 → B 注册 → 输码加入 → 两边都看到对方
//   → 双方准备 → 3 秒倒计时 → 双方都收到"对局已开始"
// 说明：REST 走 Vite 代理到 Node（vite.config.js），状态推送走 WebSocket。
const password = 'room-e2e-pass-1';

async function register(page, username) {
  // 走 helpers 的 HTTP 注册：填表点击会被 Vite HMR 的整页刷新打断（历史 flaky 根因）
  await registerDirect(page, username, password);
}

test.describe('PvP 房间码匹配', () => {
  test('A 建房、B 输码加入、双方准备后开局', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await register(pageA, `host_${stamp}`);
      await register(pageB, `guest_${stamp}`);

      // A 建房
      await pageA.click('#btnCreateRoom');
      await expect(pageA.locator('#roomActive')).toBeVisible({ timeout: 15000 });
      const code = (await pageA.locator('#roomCode').textContent()).trim();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      await expect(pageA.locator('#roomStateText')).toContainText('等待对手加入');

      // B 输码加入
      await pageB.fill('#inputRoomCode', code);
      await pageB.click('#btnJoinRoom');
      await expect(pageB.locator('#roomActive')).toBeVisible({ timeout: 15000 });
      await expect(pageB.locator('#roomCode')).toHaveText(code);
      await expect(pageB.locator('#roomStateText')).toContainText('双方就位');

      // A 那边也应看到 2 名玩家
      await expect(pageA.locator('#roomPlayers tbody tr')).toHaveCount(2, { timeout: 15000 });
      await expect(pageB.locator('#roomPlayers tbody tr')).toHaveCount(2);

      // 双方准备（只有两人都准备才进入倒计时）
      await pageA.click('#btnReady');
      await expect(pageA.locator('#btnReady')).toHaveText('取消准备');
      await pageB.click('#btnReady');

      // 倒计时 3 秒后开局：P4 起自动跳转到对局页（pvp-battle.html?room=..&level=..）
      await pageA.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      await pageB.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
      expect(pageA.url()).toContain(`room=${code}`);
      expect(pageA.url()).toContain('level=dujiang_pvp');
      await expect(pageA.locator('#battleStatus')).toContainText('已进入对局', { timeout: 20000 });
      await expect(pageB.locator('#battleStatus')).toContainText('已进入对局', { timeout: 20000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('房间码错误给出明确提示，不会进入房间', async ({ page }) => {
    const stamp = Date.now().toString(36);
    await register(page, `solo_${stamp}`);

    await page.fill('#inputRoomCode', 'ZZZZZZ');
    await page.click('#btnJoinRoom');
    await expect(page.locator('#roomMsg')).toContainText('房间不存在', { timeout: 10000 });
    await expect(page.locator('#roomActive')).toBeHidden();
  });

  test('房主离开后对手收到房间关闭提示', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await register(pageA, `leave_host_${stamp}`);
      await register(pageB, `leave_guest_${stamp}`);
      await pageA.click('#btnCreateRoom');
      await expect(pageA.locator('#roomActive')).toBeVisible({ timeout: 15000 });
      const code = (await pageA.locator('#roomCode').textContent()).trim();

      await pageB.fill('#inputRoomCode', code);
      await pageB.click('#btnJoinRoom');
      await expect(pageB.locator('#roomActive')).toBeVisible({ timeout: 15000 });

      await pageA.click('#btnLeaveRoom');
      await expect(pageA.locator('#roomLobby')).toBeVisible({ timeout: 10000 });
      await expect(pageB.locator('#roomMsg')).toContainText('房主已离开', { timeout: 10000 });
      await expect(pageB.locator('#roomActive')).toBeHidden();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
