import { chromium } from 'playwright';

const BASE = 'http://localhost:5182';

const sample = (page) => page.evaluate(() => {
  const v = document.getElementById('endingIntroVid');
  const overlay = document.getElementById('endingIntroOverlay');
  const btn = document.getElementById('endingPlayBtn');
  const box = document.querySelector('.bbg-intro-video');
  const txt = document.getElementById('endingIntroContent');
  let frame = null;
  if (v && v.videoWidth) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const ctx = c.getContext('2d');
    try {
      ctx.drawImage(v, 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0, nonBlack = 0;
      for (let i = 0; i < d.length; i += 4) { const b = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += b; if (b > 16) nonBlack++; }
      const n = d.length / 4;
      frame = { mean: +(sum / n).toFixed(1), nonBlack: +(nonBlack / n).toFixed(2) };
    } catch (e) { frame = 'err'; }
  }
  return {
    src: v ? v.getAttribute('src') : null,
    paused: v ? v.paused : null, muted: v ? v.muted : null, rs: v ? v.readyState : null,
    t: v ? Number(v.currentTime.toFixed(2)) : null, size: v ? v.videoWidth + 'x' + v.videoHeight : null,
    overlay: Boolean(overlay), frame,
    isReady: [box && box.classList.contains('is-ready'), txt && txt.classList.contains('is-ready')],
    opacity: v ? getComputedStyle(v).opacity : null,
    hint: btn && !btn.hidden ? btn.textContent.trim() : '(隐藏)',
    videoPlayingFlag: localStorage.getItem('war-of-dots.video-playing'),
  };
});

async function run(label, { route, args = [] } = {}) {
  const browser = await chromium.launch({ channel: 'msedge', args });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    localStorage.setItem('war-of-dots.session', JSON.stringify({ username: 'vid-user', loggedInAt: 0 }));
  });
  const page = await context.newPage();
  const net = [];
  page.on('response', r => { if (/\.mp4/.test(r.url())) net.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  page.on('requestfailed', r => { if (/\.mp4/.test(r.url())) net.push('FAILED ' + r.url().replace(BASE, '')); });
  if (route) await page.route('**/*.mp4', route);
  await page.goto(BASE + '/ending.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const s = await sample(page);
  console.log(label, JSON.stringify(s));
  console.log('   网络:', JSON.stringify(net));
  await page.screenshot({ path: `.verify-tmp/v2-${label.replace(/[^\w]/g, '')}.png` });
  await context.close();
  await browser.close();
  return s;
}

// A) 远端正常（默认策略：带声音自动播放会被挡 → 静音起播 + 提示）
await run('A远端正常');
// B) 远端挂掉（拦截远端请求直接失败）→ 应自动换到仓库备份并出画面
await run('B远端挂掉换备份', { route: r => (r.request().url().includes('179.255.122.44') ? r.abort() : r.continue()) });
// C) 远端不响应（挂住）→ 6 秒看门狗换备份
await run('C远端挂住换备份', { route: r => (r.request().url().includes('179.255.122.44') ? undefined : r.continue()) });
// D) 远端和本地都失败 → 收场进内容区，不留黑屏
await run('D都失败', { route: r => r.abort() });
