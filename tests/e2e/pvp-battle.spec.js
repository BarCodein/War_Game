import { expect, test } from '@playwright/test';

// P4 对局页验收（两个独立上下文 = 两个玩家）：
//   建房 → 加入 → 双方准备 → 自动进入 pvp-battle.html →
//   快照持续流动 / 准备读秒 / 静止单位与快照一致（<0.5px）/ 视野过滤 / 选择+右键下令生效
const password = 'battle-e2e-pass-1';

async function register(page, username) {
  await page.goto('/pvp.html');
  await page.waitForLoadState('load');
  await page.fill('#inputUsername', username);
  await expect(page.locator('#inputUsername')).toHaveValue(username);
  await page.fill('#inputPassword', password);
  await expect(page.locator('#inputPassword')).toHaveValue(password);
  await page.click('#btnRegister');
  await expect(page.locator('#authLoggedIn')).toBeVisible({ timeout: 20000 });
}

async function waitBattleReady(page) {
  await page.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
  await expect(page.locator('#battleStatus')).toContainText('已进入对局', { timeout: 20000 });
  await expect.poll(
    () => page.evaluate(() => window.__pvp?.snapshotCount ?? 0),
    { timeout: 20000 },
  ).toBeGreaterThan(3);
}

test.describe('PvP 对局页', () => {
  test('进入对局、快照同步、准备读秒、选择下令', async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await register(pageA, `ba_${stamp}`);
      await register(pageB, `bb_${stamp}`);

      await pageA.click('#btnCreateRoom');
      await expect(pageA.locator('#roomActive')).toBeVisible({ timeout: 20000 });
      const code = (await pageA.locator('#roomCode').textContent()).trim();
      await pageB.fill('#inputRoomCode', code);
      await pageB.click('#btnJoinRoom');
      await expect(pageB.locator('#roomActive')).toBeVisible({ timeout: 20000 });
      await expect(pageA.locator('#roomPlayers tbody tr')).toHaveCount(2, { timeout: 20000 });

      // 双方准备 → 倒计时 → 两边都跳进对局页
      await pageA.click('#btnReady');
      await pageB.click('#btnReady');
      await waitBattleReady(pageA);
      await waitBattleReady(pageB);

      // 阵营
      await expect(pageA.locator('#hudRoom')).toContainText('蓝方');
      await expect(pageB.locator('#hudRoom')).toContainText('红方');

      // 迷雾下放给客户端：快照含全部单位，但"可见敌军"由客户端本地迷雾判定
      const view = await pageA.evaluate(() => ({
        me: window.__pvp.myFaction,
        own: window.__pvp.ownUnits,
        enemiesVisible: window.__pvp.visibleEnemies,
        enemiesKnown: window.__pvp.enemyUnitsKnown,
        fogAuthority: window.__pvp.lastSnapshot?.fogAuthority,
        phase: window.__pvp.lastSnapshot?.phase,
        cities: window.__pvp.lastSnapshot?.cities?.length ?? 0,
        units: window.__pvp.lastSnapshot?.units?.length ?? 0,
      }));
      expect(view.me).toBe('blue');
      expect(view.fogAuthority).toBe('client');
      expect(view.own).toBeGreaterThanOrEqual(16);
      expect(view.units).toBeGreaterThanOrEqual(32);      // 16 蓝 + 16 红全部下发
      expect(view.enemiesKnown).toBe(16);
      expect(view.enemiesVisible).toBeLessThan(16);       // 但开局看不到全部敌军
      expect(view.enemiesVisible).toBeGreaterThan(0);
      expect(view.cities).toBe(16);

      // 静止单位与快照坐标一致（插值收敛，验收要求 < 0.5px）
      await expect.poll(async () => pageA.evaluate(() => {
        const debug = window.__pvp;
        const own = debug.world.units.filter((unit) => unit.faction === debug.myFaction && unit.target);
        if (!own.length) return 999;
        return Math.max(...own.map((unit) => Math.hypot(unit.x - unit.target.x, unit.y - unit.target.y)));
      }), { timeout: 15000, intervals: [300, 500, 800] }).toBeLessThan(0.5);

      // 选择：点中我方第一个单位
      const clickPoint = await pageA.evaluate(() => {
        const debug = window.__pvp;
        const unit = debug.world.units.find((item) => item.faction === debug.myFaction);
        return debug.projectToScreen(unit.x, unit.y);
      });
      expect(clickPoint).toBeTruthy();
      await pageA.mouse.click(clickPoint.x, clickPoint.y);
      await expect.poll(() => pageA.evaluate(() => window.__pvp.selection.ids().length), { timeout: 10000 })
        .toBeGreaterThanOrEqual(1);

      // 右键下令：目标点是我方阵地下方 160px
      const orderPoint = await pageA.evaluate(() => {
        const debug = window.__pvp;
        const unit = debug.world.units.find((item) => item.faction === debug.myFaction);
        return debug.projectToScreen(unit.x + 40, unit.y + 160);
      });
      const sentBefore = await pageA.evaluate(() => window.__pvp.commandsSent);
      await pageA.mouse.click(orderPoint.x, orderPoint.y, { button: 'right' });
      await expect.poll(() => pageA.evaluate(() => window.__pvp.commandsSent), { timeout: 10000 })
        .toBeGreaterThan(sentBefore);

      // 命令生效：被选中单位开始朝目标移动（快照里的坐标发生变化）
      await expect.poll(async () => pageA.evaluate(() => {
        const debug = window.__pvp;
        const moving = debug.world.units.filter((unit) => unit.faction === debug.myFaction
          && unit.target && Math.hypot(unit.target.x - unit.x, unit.target.y - unit.y) > 1);
        return moving.length;
      }), { timeout: 20000, intervals: [400, 800, 1200] }).toBeGreaterThan(0);

      // 准备阶段读秒结束后进入 playing，计时器在走
      await expect.poll(() => pageA.evaluate(() => window.__pvp.lastSnapshot?.phase), { timeout: 20000 })
        .toBe('playing');
      await expect(pageA.locator('#prepOverlay')).toBeHidden({ timeout: 20000 });
      await expect(pageA.locator('#hudTimer')).not.toHaveText('--:--');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
