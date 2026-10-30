import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, registerDirect } from './helpers.js';

// U1/U2/U3 验收：与战役同款输入 → 浏览器造出 command → 打包发服务器
//   U1 多选拖轨迹（保持队形、整批 1 条消息）
//   U2 右键攻击前进 / Shift 排队 / S 停止
//   U3 拖拽轨迹预览 + 下令后的"预计路线"（服务器改道或超时后消失）
const PASSWORD = 'orders-password-1';

async function setupMatch(browser) {
  const stamp = Date.now().toString(36);
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await registerDirect(pageA, `or_${stamp}a`, PASSWORD);
  await registerDirect(pageB, `or_${stamp}b`, PASSWORD);
  const code = await createRoom(pageA);
  await joinRoom(pageB, code);
  await pageA.click('#btnReady');
  await pageB.click('#btnReady');
  await pageA.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
  await pageB.waitForURL(/pvp-battle\.html/, { timeout: 30000 });
  await expect.poll(() => pageA.evaluate(() => window.__pvp.lastSnapshot?.phase), { timeout: 25000 })
    .toBe('playing');
  return { contextA, contextB, pageA, pageB };
}

/** 框选己方全部单位：从己方单位包围盒外侧空地起笔拖到另一侧 */
async function boxSelectAllOwn(page) {
  const box = await page.evaluate(() => {
    const debug = window.__pvp;
    const own = debug.world.units.filter((unit) => unit.faction === debug.myFaction && unit.state !== 'dead');
    if (!own.length) return null;
    const xs = own.map((unit) => unit.x);
    const ys = own.map((unit) => unit.y);
    const pad = 60;
    return {
      a: debug.projectToScreen(Math.min(...xs) - pad, Math.min(...ys) - pad),
      b: debug.projectToScreen(Math.max(...xs) + pad, Math.max(...ys) + pad),
    };
  });
  expect(box).toBeTruthy();
  await page.mouse.move(box.a.x, box.a.y);
  await page.mouse.down();
  await page.mouse.move(box.b.x, box.b.y, { steps: 14 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__pvp.selection.ids().length), { timeout: 8000 })
    .toBeGreaterThanOrEqual(2);
  return page.evaluate(() => window.__pvp.selection.ids().length);
}

test('U1/U2/U3：多选拖轨迹 → 一条批量命令，S 停止，右键攻击前进', async ({ browser }) => {
  const { contextA, contextB, pageA } = await setupMatch(browser);
  try {
    const selected = await boxSelectAllOwn(pageA);

    // ---- U1：从某个已选单位拖出一条轨迹 → 每个单位一条绝对路径，打包成 1 条消息 ----
    const drag = await pageA.evaluate(() => {
      const debug = window.__pvp;
      const unit = debug.world.units.find((item) => item.faction === debug.myFaction && debug.selection.isSelected(item.id));
      return {
        from: debug.projectToScreen(unit.x, unit.y),
        mid: debug.projectToScreen(unit.x + 60, unit.y + 10),
        to: debug.projectToScreen(unit.x + 120, unit.y + 70),
      };
    });
    await pageA.mouse.move(drag.from.x, drag.from.y);
    await pageA.mouse.down();
    await pageA.mouse.move(drag.mid.x, drag.mid.y, { steps: 6 });
    // 拖动过程中应能读到"正在拖的轨迹"（U3 的轨迹预览数据源）
    const routing = await pageA.evaluate(() => window.__pvp.orders.getCurrentRoute().length);
    expect(routing).toBeGreaterThan(1);
    await pageA.mouse.move(drag.to.x, drag.to.y, { steps: 6 });
    await pageA.mouse.up();

    await expect.poll(() => pageA.evaluate(() => window.__pvp.commandQueue.stats.batches), { timeout: 10000 })
      .toBe(1);   // 一次操作 = 一条消息
    await expect.poll(() => pageA.evaluate(() => Boolean(window.__pvp.lastOrderResult)), { timeout: 10000 })
      .toBe(true);   // 等服务器回执（batches 计数在发送时就 +1，ack 会晚一点）
    const u1 = await pageA.evaluate(() => ({
      stats: { ...window.__pvp.commandQueue.stats },
      last: window.__pvp.lastOrderResult ?? null,
    }));
    expect(u1.stats.orders).toBe(selected);          // 每个单位一条命令（保持队形）
    expect(u1.last?.ok).toBe(true);
    expect(u1.last?.applied).toBe(selected);
    expect(u1.last?.units).toBe(selected);
    expect(u1.stats.rejected).toBe(0);               // 没有 RATE_LIMITED
    expect(u1.last?.rejected ?? []).toHaveLength(0);

    // 服务器确实让部队动起来了（快照坐标变化）
    await expect.poll(async () => pageA.evaluate(() => {
      const debug = window.__pvp;
      return debug.world.units.filter((unit) => unit.faction === debug.myFaction
        && unit.target && Math.hypot(unit.target.x - unit.x, unit.target.y - unit.y) > 1).length;
    }), { timeout: 15000, intervals: [400, 800] }).toBeGreaterThan(0);

    // ---- §11.15：真实行军路线由服务器下发（变化才发），客户端缓存后与战役同一套画法 ----
    await expect.poll(() => pageA.evaluate(() => window.__pvp.routeStats?.ownWithRoute ?? 0), {
      timeout: 10000, intervals: [300, 600, 1000],
    }).toBeGreaterThanOrEqual(selected);
    const routes = await pageA.evaluate(() => {
      const debug = window.__pvp;
      const mine = debug.world.units.filter((unit) => unit.faction === debug.myFaction
        && (unit.route?.length ?? 0) > 0);
      return {
        deltasApplied: debug.routeStats?.deltasApplied ?? 0,
        withRoute: mine.length,
        totalPoints: mine.reduce((sum, unit) => sum + unit.route.length, 0),
        // 每条路线的终点应该是本次下令的终点（拖拽终点按各单位自身位置平移）
        endsFinite: mine.every((unit) => Number.isFinite(unit.route[unit.route.length - 1].x)),
        previewsLeft: debug.previewCount ?? 0,
      };
    });
    expect(routes.deltasApplied).toBeGreaterThan(0);
    expect(routes.withRoute).toBeGreaterThanOrEqual(selected);
    expect(routes.totalPoints).toBeGreaterThanOrEqual(selected);
    expect(routes.endsFinite).toBe(true);
    // 真实路线到手后，本地"预计路线"占位应被清掉
    await expect.poll(() => pageA.evaluate(() => window.__pvp.previewCount ?? 0), { timeout: 8000 }).toBe(0);

    // ---- U2：S 停止（hold）----
    const beforeHold = await pageA.evaluate(() => window.__pvp.commandQueue.stats.orders);
    await pageA.keyboard.press('s');
    await expect.poll(() => pageA.evaluate(() => window.__pvp.commandQueue.stats.orders), { timeout: 8000 })
      .toBeGreaterThan(beforeHold);
    await expect.poll(async () => pageA.evaluate(() => {
      const debug = window.__pvp;
      return debug.world.units.filter((unit) => unit.faction === debug.myFaction && unit.state === 'hold').length;
    }), { timeout: 12000, intervals: [400, 800] }).toBeGreaterThan(0);

    // ---- U2：右键攻击前进（空地上）----
    const ordersBefore = await pageA.evaluate(() => window.__pvp.commandQueue.stats.orders);
    const target = await pageA.evaluate(() => {
      const debug = window.__pvp;
      const unit = debug.world.units.find((item) => item.faction === debug.myFaction && debug.selection.isSelected(item.id));
      return debug.projectToScreen(unit.x + 90, unit.y - 60);
    });
    await pageA.mouse.click(target.x, target.y, { button: 'right' });
    await expect.poll(() => pageA.evaluate(() => window.__pvp.commandQueue.stats.orders), { timeout: 10000 })
      .toBe(ordersBefore + 1);   // 右键对全部选中单位是"一条命令"（同一 path/target）

    // Shift+右键 = 排队（enqueueRoute）→ 服务器下发的 pendingQueue 应能被客户端缓存到
    await pageA.keyboard.down('Shift');
    await pageA.mouse.click(target.x + 40, target.y - 40, { button: 'right' });
    await pageA.keyboard.up('Shift');
    await expect.poll(async () => pageA.evaluate(() => {
      const debug = window.__pvp;
      return debug.world.units.reduce((sum, unit) => sum + (unit.pendingQueue?.length ?? 0), 0);
    }), { timeout: 15000, intervals: [400, 800, 1200] }).toBeGreaterThan(0);

    // 下令成功不再弹提示条（单/多单位都不弹）；只记录 debug.lastOrderAccepted 供断言
    const accepted = await pageA.evaluate(() => window.__pvp.lastOrderAccepted ?? null);
    expect(accepted?.units ?? 0).toBeGreaterThan(1);
    const toast = await pageA.evaluate(() => window.__pvp.lastToast ?? null);
    expect(toast).toBeNull();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
