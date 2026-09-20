import { chromium } from 'playwright';

const BASE = 'http://localhost:5182';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript(() => {
  localStorage.setItem('war-of-dots.session', JSON.stringify({ username: 'vid-user', loggedInAt: 0 }));
});
const page = await context.newPage();
const net = [];
page.on('response', r => { if (/\.mp4/.test(r.url())) net.push(r.status() + ' ' + r.url().replace(BASE, '')); });
page.on('requestfailed', r => { if (/\.mp4/.test(r.url())) net.push('FAILED ' + r.url().replace(BASE, '')); });
// 远端挂住不响应（本地不动）→ 6 秒看门狗应换到 ./assets/video/end.mp4
await page.route('**/*.mp4', r => (r.request().url().includes('179.255.122.44') ? undefined : r.continue()));

await page.goto(BASE + '/ending.html', { waitUntil: 'domcontentloaded' });
for (const ms of [3000, 4000, 3000]) {
  await page.waitForTimeout(ms);
  const s = await page.evaluate(() => {
    const v = document.getElementById('endingIntroVid');
    return {
      src: v ? v.getAttribute('src') : null, rs: v ? v.readyState : null,
      w: v ? v.videoWidth : null, t: v ? Number(v.currentTime.toFixed(2)) : null,
      overlay: Boolean(document.getElementById('endingIntroOverlay')),
    };
  });
  console.log('t≈' + (ms === 3000 ? 3 : ms === 4000 ? 7 : 10) + 's', JSON.stringify(s));
}
console.log('网络:', JSON.stringify(net));
await page.screenshot({ path: '.verify-tmp/v2-C-after.png' });
await browser.close();
