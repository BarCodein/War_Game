import { expect, test } from '@playwright/test';

// 通关结局页：打完渡江战役 → result.html 的"返回战役选择"位变成"结局" → ending.html。
// 结局页结构与 battlebackground.html 同源（导航条 + hero + 结局视频遮罩 + 三段内容 + 按钮），
// 单测只能守文本契约，真正"点得动、视频/图能出、遮罩能跳过"要靠浏览器。

test('渡江战役胜利后，结算页主按钮变成"结局"并进入 ending.html', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));

  await page.goto('/result.html?result=victory&level=dujiang_battle', { waitUntil: 'domcontentloaded' });
  const primary = page.locator('#resultPrimary');
  await expect(primary).toHaveText('结局');
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

  // 结局图真的加载了（404 时 naturalWidth 为 0）。
  // 只校验"路径以图片扩展名结尾 + 图真的解码出来了"，不写死文件名——结局图换过一次。
  await expect(page.locator('#endingSituation')).toHaveAttribute('src', /\.(jpe?g|png|webp)$/);
  const image = await page.locator('#endingSituation').evaluate(img => ({ complete: img.complete, naturalWidth: img.naturalWidth }));
  expect(image.complete).toBe(true);
  expect(image.naturalWidth).toBeGreaterThan(0);

  // 结局视频：源由脚本设到 <video> 自身（远端为主、仓库内备份兜底），按 background 页的规则自动播放
  const intro = page.locator('#endingIntroVid');
  await expect(intro).toHaveAttribute('src', /end\.mp4$/);
  await expect(intro).toHaveAttribute('autoplay', '');
  // 远端挂掉时要能自动换到仓库里的备份（否则遮罩只能停在黑屏上）
  await expect(intro).toHaveAttribute('data-fallback', './assets/video/end.mp4');

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

test('结局页入场视频不再黑屏：视频层拿到 is-ready，画面不是纯黑', async ({ page }) => {
  // 回归点：battlepages.css 里 `.bbg-intro-video video` 与 `.bbg-intro-content` 默认
  // opacity:0，只有加上 .is-ready 才淡入。结局页漏了这一步时，遮罩一直停在 #000 上
  // ——表现就是"结局视频黑屏"（截图抓不到视频层，所以这里用 canvas 取真实像素）。
  await page.goto('/ending.html', { waitUntil: 'domcontentloaded' });
  const intro = page.locator('#endingIntroVid');
  await expect(page.locator('.bbg-intro-video')).toHaveClass(/is-ready/, { timeout: 10000 });
  await expect(page.locator('#endingIntroContent')).toHaveClass(/is-ready/, { timeout: 10000 });

  // 视频层淡入到 opacity:1（CSS 里默认是 0）
  await expect.poll(() => intro.evaluate(v => Number(getComputedStyle(v).opacity)), { timeout: 10000 }).toBe(1);

  // 真解出了一帧（videoWidth>0 且 readyState 足够画）——"黑屏"最直接的证据就是这里不成立
  await expect.poll(() => intro.evaluate(v => (v.videoWidth > 0 ? v.readyState : -1)), { timeout: 10000 })
    .toBeGreaterThanOrEqual(2);

  // 再取一次真实像素（0 = 全黑）。远端源是跨域的、没带 CORS 头，canvas 会被污染
  // （getImageData 抛 SecurityError），那种情况就用上面的 readyState 判断，别把测试写死在本地上。
  const mean = await intro.evaluate(v => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 18;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(v, 0, 0, 32, 18);
      const data = ctx.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      return sum / (data.length / 4);
    } catch (e) {
      return null; // 跨域视频：没法取样，交给上面的 readyState 断言
    }
  });
  if (mean !== null) expect(mean, '画面是纯黑的').toBeGreaterThan(20);
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
