import { expect, test } from '@playwright/test';
import { registerDirect } from './helpers.js';

// P4 对局页验收（两个独立上下文 = 两个玩家）：
//   建房 → 加入 → 双方准备 → 自动进入 pvp-battle.html →
//   快照持续流动 / 准备读秒 / 静止单位与快照一致（<0.5px）/ 视野过滤 / 选择+右键下令生效
const password = 'battle-e2e-pass-1';

async function register(page, username) {
  // 走 helpers 的 HTTP 注册：填表点击会被 Vite HMR 的整页刷新打断（历史 flaky 根因）
  await registerDirect(page, username, password);
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
      await expect(pageA.locator('#roomLabel')).toContainText('蓝方');
      await expect(pageB.locator('#roomLabel')).toContainText('红方');

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

      // 控制线/补给线（方案 B）：客户端本地派生，服务器每 3s 校正一次
      await expect.poll(() => pageA.evaluate(() => window.__pvp.deriveStats?.packets ?? 0), {
        timeout: 15000, intervals: [500, 800, 1200],
      }).toBeGreaterThanOrEqual(1);
      const derive = await pageA.evaluate(() => ({
        ...window.__pvp.deriveStats,
        sceneWorldPaths: window.__pvp.world.controlLinePaths.length,
      }));
      expect(derive.mode).toBe('local');                 // 没有降级
      expect(derive.localPaths).toBeGreaterThan(0);      // 本地算出了控制线
      expect(derive.sceneWorldPaths).toBeGreaterThan(0); // 渲染层拿到的折线非空
      expect(derive.mismatch).toBeLessThan(0.1);         // 稳态与服务端一致（草案要求 < 2%）
      expect(derive.supplyEdges).toBeGreaterThan(0);     // 补给分配也跑通了

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
      // 准备读秒现在是共享的 Phaser 文本（战役同款），改用快照阶段 + 时钟断言
      await expect.poll(() => pageA.evaluate(() => window.__pvp?.lastSnapshot?.phase), { timeout: 20000 }).toBe('playing');
      await expect(pageA.locator('#vgClockText')).not.toHaveText('00:00');

      // 选中单位后补给线叠加层应真的画出来（与战役一致：只在选中时画）
      await expect.poll(() => pageA.evaluate(() => window.__pvp.deriveStats?.supplySelected ?? 0), {
        timeout: 10000, intervals: [300, 600, 1000],
      }).toBeGreaterThanOrEqual(1);
      await expect.poll(() => pageA.evaluate(() => window.__pvp.deriveStats?.supplyLines ?? 0), {
        timeout: 15000, intervals: [400, 800, 1200],
      }).toBeGreaterThanOrEqual(1);

      // 单个单位下令 → 不再弹"已下令"提示条（多单位才提示，需求方要求）
      const singleOrderToast = await pageA.evaluate(() => {
        const debug = window.__pvp;
        const unit = debug.world.units.find((item) => item.faction === debug.myFaction && debug.selection.isSelected(item.id));
        const point = debug.projectToScreen(unit.x + 30, unit.y + 90);
        return { point, units: debug.selection.ids().length };
      });
      await pageA.evaluate(() => { window.__pvp.lastToast = null; });
      await pageA.mouse.click(singleOrderToast.point.x, singleOrderToast.point.y, { button: 'right' });
      await pageA.waitForTimeout(1200);
      const toastAfterSingle = await pageA.evaluate(() => window.__pvp.lastToast ?? null);
      // 若当前只选中 1 个单位，就不应该出现"已下令"提示
      if (singleOrderToast.units === 1) expect(toastAfterSingle).toBeNull();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
