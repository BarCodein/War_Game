import { expect, test } from '@playwright/test';

// 胜负节奏（gdd.md §11 结算界面）：分出胜负 → **定格 ui.resultHoldMs（1 s）** → 才进胜利/失败动画
// （result-video.html 播 shengli/shibai.mp4）→ 动画结束落到 result.html。
//
// 样本用断裂峡谷（victory.mode = normal：占领全部城市即胜）：
// 直接把城市判给某一方制造胜负，然后量「world.winner 置位」到「页面开始跳转」之间的墙钟时间，
// 并确认这 1 s 里世界是**真定格**（world.time 不前进，GameScene.update 已停止推进模拟与 AI）。
//
// 页面内的两个时刻都写在 sessionStorage 里由下一跳（result-video.html，同源）读回：
//   winnerAt / navAt       —— 同一个 time origin 的 performance.now()
//   timeAtWinner/timeAtNav —— 对应的 world.time（模拟时间）
async function forceResultAndMeasure(page, faction) {
  await page.goto('/game.html?level=fracture-canyon', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 60000 });

  // 开局准备阶段不推进模拟（gdd.md §11）→ 等它走完，胜利判定才会跑
  await page.waitForFunction(() => !window.__game.controller.isPrepping(), null, { timeout: 30000 });

  await page.evaluate((side) => {
    sessionStorage.removeItem('war-of-dots.e2e-hold');
    window.__winnerAt = null;
    window.__timeAtWinner = null;
    const world = window.__game.world;
    const poll = setInterval(() => {
      if (!world.winner) return;
      clearInterval(poll);
      window.__winnerAt = performance.now();
      window.__timeAtWinner = world.time;
    }, 5);
    window.addEventListener('pagehide', () => {
      sessionStorage.setItem('war-of-dots.e2e-hold', JSON.stringify({
        winnerAt: window.__winnerAt,
        timeAtWinner: window.__timeAtWinner,
        navAt: performance.now(),
        timeAtNav: world.time,
      }));
    });
    // 占领全部城市 → 下一 tick 的 normalVictory 判该阵营胜
    for (const city of world.cities) city.faction = side;
  }, faction);

  // 停顿期间必须还留在战场页（不能立刻跳走）
  await page.waitForTimeout(600);
  expect(page.url()).not.toContain('result-video.html');

  // 停顿结束后跳胜负动画页（result 参数由 resultQuery 拼）
  const result = faction === 'blue' ? 'victory' : 'defeat';
  await page.waitForURL(new RegExp(`result-video\\.html\\?result=${result}`), { timeout: 15000 });

  const measured = await page.evaluate(() => {
    const raw = sessionStorage.getItem('war-of-dots.e2e-hold');
    return raw ? JSON.parse(raw) : null;
  });
  expect(measured).not.toBeNull();
  const hold = measured.navAt - measured.winnerAt;
  console.log(`[result-hold] ${result}：判定 → 跳转实测 ${Math.round(hold)} ms`);
  // 判定 → 跳转 ≈ resultHoldMs(1000) + HUD 节流(performance.hudRefreshMs = 100) 内的检测延迟
  expect(hold).toBeGreaterThanOrEqual(900);
  expect(hold).toBeLessThanOrEqual(2500);
  // 这 1 s 是定格：世界时间一点没往前走
  expect(measured.timeAtNav).toBe(measured.timeAtWinner);
  expect(measured.timeAtNav).toBeGreaterThan(0);
}

test('获胜后定格约 1 s 才进入胜利动画', async ({ page }) => {
  test.setTimeout(90000);
  await forceResultAndMeasure(page, 'blue');
});

test('失败后同样定格约 1 s 才进入失败动画', async ({ page }) => {
  test.setTimeout(90000);
  await forceResultAndMeasure(page, 'red');
});
