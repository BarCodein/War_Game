import { expect } from '@playwright/test';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 800;

export async function waitForGame(page) {
  // 游戏页（game.html）。waitUntil: domcontentloaded——外部字体等慢资源偶发拖住 load
  // 事件（firefox），游戏就绪由下方的 canvas / __gameReady 断言保证。
  await page.goto('/game.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready); // 等字体就绪，避免布局漂移导致画布坐标失效
  await expect(page.locator('#battlefield canvas')).toBeVisible();
  // 并行负载下软件渲染启动较慢，给足等待时间
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 60000 });
}

// 世界坐标 → 页面坐标点击（补偿 Scale.FIT 缩放与画布偏移）
export async function clickWorld(page, x, y, options = {}) {
  const canvas = page.locator('#battlefield canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(
    box.x + (x / GAME_WIDTH) * box.width,
    box.y + (y / GAME_HEIGHT) * box.height,
    options,
  );
}

export async function dragWorld(page, from, to) {
  const canvas = page.locator('#battlefield canvas');
  const box = await canvas.boundingBox();
  const scale = (point) => ({
    x: box.x + (point.x / GAME_WIDTH) * box.width,
    y: box.y + (point.y / GAME_HEIGHT) * box.height,
  });
  const start = scale(from);
  const end = scale(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

// 读取第一个存活蓝军单位的世界坐标
export async function firstBlueUnit(page) {
  return page.evaluate(() => {
    const unit = window.__game.world.units.find(u => u.faction === 'blue' && u.state !== 'dead');
    return unit ? { id: unit.id, x: unit.x, y: unit.y } : null;
  });
}

export async function firstRedUnit(page) {
  return page.evaluate(() => {
    const unit = window.__game.world.units.find(u => u.faction === 'red' && u.state !== 'dead');
    return unit ? { id: unit.id, x: unit.x, y: unit.y } : null;
  });
}

// ---------- PvP 页面的表单辅助 ----------
//
// 为什么不用 page.fill：Edge 偶尔会在填充后触发自动填充/密码管理器，把用户名清空，
// 造成"偶发注册失败"。这里直接给 input.value 赋值并派发 input 事件 ——
// pvp.html 的提交逻辑只读 `.value`，所以行为一致且稳定。
// （pvp-auth.spec.js 仍然走真实的 fill/click，因为那个用例本身就是在测表单。）
export async function fillByScript(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = next;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

export async function registerDirect(page, username, password) {
  // 账号统一在 login.html（服务端为准）：/pvp.html 未登录会直接跳登录页，
  // 所以这里先走 HTTP 注册（拿到 HttpOnly 会话 cookie），再用整页导航回大厅。
  await page.goto('/login.html');
  await page.waitForLoadState('load');
  await page.evaluate(async ({ user, pass }) => {
    const body = JSON.stringify({ username: user, password: pass });
    const headers = { 'content-type': 'application/json' };
    let response = await fetch('/api/auth/register', { method: 'POST', headers, body });
    if (response.status === 409) {
      // 已存在同名账号（重复跑测试）：直接登录
      response = await fetch('/api/auth/login', { method: 'POST', headers, body });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`register/login failed: ${response.status} ${detail}`);
    }
  }, { user: username, pass: password });
  await page.goto('/pvp.html');
  await expect(page.locator('#authLoggedIn')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#meName')).toHaveText(username);
}

/** 建房并返回 6 位房间码 */
export async function createRoom(page) {
  await page.click('#btnCreateRoom');
  await expect(page.locator('#roomActive')).toBeVisible({ timeout: 20000 });
  return (await page.locator('#roomCode').textContent()).trim();
}

/** 用房间码加入 */
export async function joinRoom(page, code) {
  await page.fill('#inputRoomCode', code);
  await page.click('#btnJoinRoom');
  await expect(page.locator('#roomActive')).toBeVisible({ timeout: 20000 });
}
