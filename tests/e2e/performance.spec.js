import { expect, test } from '@playwright/test';

// 性能基准页（acceptance G3 基准）：#bench 在浏览器内跑 500 单位并测量
// 模拟 tick 耗时（帧率受软件渲染限制，60 FPS 的最终确认在真实 GPU 上手动完成）。
test('性能基准：500 单位 tick 预算与可测基线', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/game.html#bench', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gameReady === true);
  await page.waitForFunction(() => window.__bench.ready === true, null, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const ticks = window.__bench.scene.tickTimes;
    const sorted = [...ticks].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    return {
      avg,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      samples: sorted.length,
      fps: window.__bench.fps,
      overlay: document.querySelector('#benchOverlay')?.textContent ?? '',
    };
  });
  console.log('bench result:', JSON.stringify({ avg: result.avg.toFixed(2), p95: result.p95.toFixed(2), fps: result.fps }));
  expect(result.samples).toBeGreaterThanOrEqual(300);
  // 模拟 tick 预算（8ms）的机器无关上界：平均 ≤ 10ms、p95 ≤ 16ms
  expect(result.avg).toBeLessThanOrEqual(10);
  expect(result.p95).toBeLessThanOrEqual(16);
  await expect(page.locator('#benchOverlay')).toContainText('500 单位');
});
