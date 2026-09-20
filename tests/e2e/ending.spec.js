import { expect, test } from '@playwright/test';

// 通关结局页：打完渡江战役 → result.html 的"返回战役选择"位变成"进入结局" → ending.html。
// 结局页结构与 battlebackground.html 同源（导航条 + hero + 结局视频遮罩 + 三段内容 + 按钮），
// 单测只能守文本契约，真正"点得动、视频/图能出、遮罩能跳过"要靠浏览器。

test('渡江战役胜利后，结算页主按钮变成"进入结局"并进入 ending.html', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));

  await page.goto('/result.html?result=victory&level=dujiang_battle', { waitUntil: 'domcontentloaded' });
  const primary = page.locator('#resultPrimary');
  await expect(primary).toHaveText('进入结局');
  await expect(primary).toHaveAttribute('href', './ending.html');

  await primary.click();
  await page.waitForURL(/\/ending\.html/);
  // 标题由脚本按字典改写（静态 <title> 只用于直接打开时的兜底）
  await expect(page).toHaveTitle('沙盘战争 — 全战役通关');

  // 内容按 ENDING_DATA 填充（缺一就是脚本中断，比如字典键写错）
  await expect(page.locator('#endingTitle')).toHaveText('全战役通关');
  await expect(page.locator('#endingSubtitle')).not.toBeEmpty();
  await expect(page.locator('#endingResult')).not.toBeEmpty();
  await expect(page.locator('#endingMeaning')).not.toBeEmpty();
  await expect(page.locator('#endingEpilogue')).not.toBeEmpty();
  await expect(page.locator('.bbg-shell h2').first()).toBeVisible();

  // 结局图真的加载了（404 时 naturalWidth 为 0）
  await expect(page.locator('#endingSituation')).toHaveAttribute('src', './assets/picture/ending_pic.jpeg');
  const image = await page.locator('#endingSituation').evaluate(img => ({ complete: img.complete, naturalWidth: img.naturalWidth }));
  expect(image.complete).toBe(true);
  expect(image.naturalWidth).toBeGreaterThan(0);

  // 结局视频：源由脚本设到 <video> 自身，按 background 页的规则自动播放
  const intro = page.locator('#endingIntroVid');
  await expect(intro).toHaveAttribute('src', './assets/video/end.mp4');
  await expect(intro).toHaveAttribute('autoplay', '');

  // 点遮罩跳过入场 → overlay 被移除，内容区可交互
  const overlay = page.locator('#endingIntroOverlay');
  if (await overlay.count()) {
    await overlay.click({ position: { x: 8, y: 8 } });
  }
  await expect(overlay).toHaveCount(0, { timeout: 5000 });

  // 结局页的按钮 = 原来的"返回战役选择"
  const back = page.locator('#endingBack');
  await expect(back).toHaveText('返回战役选择');
  await expect(back).toHaveAttribute('href', './battlechoose.html');
  await back.scrollIntoViewIfNeeded();
  await back.click();
  await page.waitForURL(/\/battlechoose\.html/);
  await expect(page.locator('body')).toBeVisible();

  expect(errors).toEqual([]);
});

test('非最后一战仍是"下一战场"（渡江前一关 → 渡江）', async ({ page }) => {
  await page.goto('/result.html?result=victory&level=pingjin_battle', { waitUntil: 'domcontentloaded' });
  const primary = page.locator('#resultPrimary');
  await expect(primary).toHaveText('下一战场');
  await expect(primary).toHaveAttribute('href', './battlebackground.html?level=dujiang_battle');
});

test('结局 key 写错时退回默认结局，并把原因写在副标题里', async ({ page }) => {
  await page.goto('/ending.html?ending=does-not-exist', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#endingTitle')).toHaveText('全战役通关');
  await expect(page.locator('#endingSubtitle')).toContainText('未找到结局');
  await expect(page.locator('#endingResult')).not.toBeEmpty();
});

test('未登录访问 ending.html 会被挡到登录页', async ({ page }) => {
  // 先落在同源页面上才能改 localStorage（config 里的 storageState 默认给的是已登录会话）
  await page.goto('/result.html?result=victory', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('war-of-dots.session'));
  await page.goto('/ending.html', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/login\.html/);
  expect(page.url()).toContain('next=');
});
