import { expect, test } from '@playwright/test';
import { clickWorld } from './helpers.js';

// 地图编辑器闭环（验收 F1–F10）：新建 → 绘制/放置 → 保存/载入 → 导入/导出 → 试玩返回。
async function openEditor(page) {
  await page.goto('/editor.html', { waitUntil: 'domcontentloaded' }); // 编辑器为独立页面
  await page.evaluate(() => document.fonts.ready); // 等字体就绪，避免布局漂移导致画布坐标失效
  await page.waitForFunction(() => window.__editor !== undefined);
  await expect(page.locator('#editorToolbar')).toBeVisible();
  await expect(page.locator('#battlefield canvas')).toBeVisible();
}

test.describe('地图编辑器', () => {
  test('编辑器加载默认有效地图并渲染', async ({ page }) => {
    await openEditor(page);
    await expect(page.locator('#editorStatus')).toContainText('地图有效');
    const info = await page.evaluate(() => ({
      version: window.__editor.store.mapData.version,
      cities: window.__editor.store.mapData.cities.length,
      size: window.__editor.store.mapData.size,
    }));
    expect(info).toEqual({ version: 1, cities: 2, size: { width: 1280, height: 720 } });
  });

  test('绘制与擦除地形', async ({ page }) => {
    await openEditor(page);
    await page.click('[data-tool="paint-water"]');
    await clickWorld(page, 210, 210); // 格子 (10,10) 的中心，避开格子边界取整误差
    const water = await page.evaluate(() => window.__editor.store.mapData.terrain.cells[10 * 64 + 10]);
    expect(water).toBe(2);
    await page.click('[data-tool="erase"]');
    await clickWorld(page, 210, 210);
    const plain = await page.evaluate(() => window.__editor.store.mapData.terrain.cells[10 * 64 + 10]);
    expect(plain).toBe(0);
  });

  test('放置与删除城市和出生点', async ({ page }) => {
    await openEditor(page);
    await page.click('[data-tool="city-red"]');
    await clickWorld(page, 400, 300);
    expect(await page.evaluate(() => window.__editor.store.mapData.cities.length)).toBe(3);
    await page.click('[data-tool="spawn-blue"]');
    await clickWorld(page, 500, 400);
    expect(await page.evaluate(() => window.__editor.store.mapData.spawns.length)).toBe(3);
    await page.click('[data-tool="delete"]');
    await clickWorld(page, 400, 300); // 删除刚放置的红城
    expect(await page.evaluate(() => window.__editor.store.mapData.cities.length)).toBe(2);
  });

  test('新建地图：名称与尺寸', async ({ page }) => {
    await openEditor(page);
    await page.click('[data-action="new"]');
    await expect(page.locator('#newMapDialog')).toBeVisible();
    await page.fill('#mapName', '测试峡谷');
    await page.selectOption('#mapSize', '960x540');
    await page.click('[data-action="confirmNew"]');
    const info = await page.evaluate(() => ({
      name: window.__editor.store.mapData.name,
      size: window.__editor.store.mapData.size,
    }));
    expect(info).toEqual({ name: '测试峡谷', size: { width: 960, height: 540 } });
  });

  test('保存到 localStorage 并载入恢复', async ({ page }) => {
    await openEditor(page);
    await page.click('[data-tool="paint-water"]');
    await clickWorld(page, 310, 310); // 格子 (15,15) 的中心
    await page.click('[data-action="save"]');
    await expect(page.locator('#editorStatus')).toContainText('已保存');
    await page.reload();
    await page.waitForFunction(() => window.__editor !== undefined);
    // 重新载入后应从本地存档恢复（默认地图该格为平原）
    expect(await page.evaluate(() => window.__editor.store.mapData.terrain.cells[15 * 64 + 15])).toBe(2);
    await page.click('[data-action="load"]');
    await expect(page.locator('#editorStatus')).toContainText('已载入');
  });

  test('导出地图文件', async ({ page }) => {
    await openEditor(page);
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-action="export"]');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('新地图.json');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(exported.version).toBe(1);
    expect(exported.cities.length).toBe(2);
  });

  test('导入地图文件', async ({ page }) => {
    await openEditor(page);
    const customMap = await page.evaluate(() => JSON.parse(JSON.stringify(window.__editor.store.mapData)));
    customMap.name = '导入的地图';
    await page.setInputFiles('#importFile', {
      name: 'imported-map.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(customMap)),
    });
    await expect.poll(() => page.evaluate(() => window.__editor.store.mapData.name)).toBe('导入的地图');
    await expect(page.locator('#editorStatus')).toContainText('地图有效');
  });

  test('可玩性校验拦截试玩', async ({ page }) => {
    await openEditor(page);
    // 删除红城后地图不可玩
    await page.click('[data-tool="delete"]');
    await clickWorld(page, 1088, 180); // 默认红城位置
    await expect(page.locator('#editorStatus')).toContainText('地图不可玩');
    await page.click('[data-action="play"]');
    const stillEditor = await page.evaluate(() => window.__editor !== undefined);
    expect(stillEditor).toBe(true); // 仍在编辑器
  });

  test('一键试玩并安全返回编辑器', async ({ page }) => {
    await openEditor(page);
    await page.click('[data-action="play"]');
    await page.waitForFunction(() => window.__game !== undefined);
    const state = await page.evaluate(() => ({
      sceneKey: window.__game.scene.scene.key,
      fromEditor: window.__game.scene.fromEditor,
      units: window.__game.world.units.length, // 按地图出生点部署
    }));
    expect(state.sceneKey).toBe('Game');
    expect(state.fromEditor).toBe(true);
    expect(state.units).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#exitPlaytest')).toBeVisible();
    await page.click('#exitPlaytest');
    await page.waitForFunction(() => window.__editor !== undefined);
    await expect(page.locator('#editorToolbar')).toBeVisible();
    expect(await page.evaluate(() => document.body.classList.contains('editor-mode'))).toBe(true);
  });
});
