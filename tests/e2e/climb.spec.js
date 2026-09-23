import { expect, test } from '@playwright/test';

// 西安事变的小游戏（climb/，睡衣登山大赛）：**速度必须与显示器刷新率无关**。
//
// 回归背景：主循环原来是"一次 requestAnimationFrame = 一步逻辑"，而这套数值
// （SPEED 5.5px/帧、GRAV、JUMP_V、各种冷却…）都是按 60Hz 调出来的。
// requestAnimationFrame 的频率跟着显示器走，于是在 120Hz / 144Hz 的机器上整个游戏
// 直接跑成 2~2.4 倍速（"本机正常、有些电脑快一倍"）。
//
// 这里把 rAF 接管过来，用受控时钟手动驱动：同一段"真实时间"里，各刷新率的
// 逻辑步数（window.__climb.logicSteps）与实际位移都必须一致。
const PAGE = '/climb/climb.html';

function installControlledClock(page) {
  return page.addInitScript(() => {
    window.__rafQueue = [];
    window.__clock = 0;
    window.requestAnimationFrame = (cb) => {
      window.__rafQueue.push(cb);
      return window.__rafQueue.length;
    };
    // 只推进"真实时间"，帧率由调用方决定
    window.__advanceFrames = (stepMs, count) => {
      for (let i = 0; i < count; i += 1) {
        window.__clock += stepMs;
        const queue = window.__rafQueue;
        window.__rafQueue = [];
        for (const cb of queue) cb(window.__clock);
      }
    };
  });
}

async function measureAdvance(page, hz, { warmupMs = 150, windowMs = 350 } = {}) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.click('#btnStart');
  await page.keyboard.down('ArrowRight');
  const stepMs = 1000 / hz;
  const advance = (ms) => page.evaluate(
    ({ step, frames }) => window.__advanceFrames(step, frames),
    { step: stepMs, frames: Math.round(ms / stepMs) },
  );
  await advance(warmupMs); // 热身：跳过"第一帧 / 状态切换"的影响（此时玩家还在起点平地，无敌人）
  const before = await page.evaluate(() => ({ x: window.__climb.x, steps: window.__climb.logicSteps }));
  await advance(windowMs);
  const after = await page.evaluate(() => ({
    x: window.__climb.x,
    steps: window.__climb.logicSteps,
    frames: window.__climb.renderFrames,
  }));
  await page.keyboard.up('ArrowRight');
  return { dx: after.x - before.x, steps: after.steps - before.steps, renderFrames: after.frames };
}

test('登山小游戏：60 / 120 / 144Hz 下同一段真实时间的推进量一致', async ({ page }) => {
  await installControlledClock(page);

  const at60 = await measureAdvance(page, 60);
  const at120 = await measureAdvance(page, 120);
  const at144 = await measureAdvance(page, 144);

  // 渲染帧数确实随刷新率变（说明测试真的按不同帧率驱动了），但逻辑步数不变
  expect(at120.renderFrames).toBeGreaterThan(at60.renderFrames);
  expect(at144.renderFrames).toBeGreaterThan(at120.renderFrames);

  console.log(`CLIMB 60Hz 步=${at60.steps} 位移=${at60.dx.toFixed(1)} | `
    + `120Hz 步=${at120.steps} 位移=${at120.dx.toFixed(1)} | `
    + `144Hz 步=${at144.steps} 位移=${at144.dx.toFixed(1)}`);

  expect(at60.steps).toBeGreaterThan(15); // 350ms ≈ 21 步
  // 步数一致（允许 ±1 的浮点取整差；修复前 120Hz 会是 ≈2 倍、144Hz ≈2.4 倍）
  expect(Math.abs(at120.steps - at60.steps)).toBeLessThanOrEqual(1);
  expect(Math.abs(at144.steps - at60.steps)).toBeLessThanOrEqual(1);

  // 位移也必须一致（一步 = 5.5px，留一点余量）
  expect(Math.abs(at120.dx - at60.dx)).toBeLessThan(6);
  expect(Math.abs(at144.dx - at60.dx)).toBeLessThan(6);
});
