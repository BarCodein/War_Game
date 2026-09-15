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
    expect(info).toEqual({ version: 1, cities: 2, size: { width: 1280, height: 800 } });
  });

  test('绘制与擦除地形', async ({ page }) => {
    await openEditor(page);
    await page.click('[data-tool="paint-water"]');
    await clickWorld(page, 210, 210); // 10px 网格下格子 (21,21) 的中心，避开格子边界取整误差
    const water = await page.evaluate(() => window.__editor.store.mapData.terrain.cells[21 * 128 + 21]);
    expect(water).toBe(2);
    await page.click('[data-tool="erase"]');
    await clickWorld(page, 210, 210);
    const plain = await page.evaluate(() => window.__editor.store.mapData.terrain.cells[21 * 128 + 21]);
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

  test('新建地图：名称与尺寸（尺寸与游戏画布一致）', async ({ page }) => {
    await openEditor(page);
    await page.click('[data-action="new"]');
    await expect(page.locator('#newMapDialog')).toBeVisible();
    await page.fill('#mapName', '测试峡谷');
    await page.selectOption('#mapSize', '1280x800');
    await page.click('[data-action="confirmNew"]');
    const info = await page.evaluate(() => ({
      name: window.__editor.store.mapData.name,
      size: window.__editor.store.mapData.size,
      terrain: `${window.__editor.store.mapData.terrain.width}x${window.__editor.store.mapData.terrain.height}`,
    }));
    expect(info).toEqual({ name: '测试峡谷', size: { width: 1280, height: 800 }, terrain: '128x80' });
    await expect(page.locator('#editorStatus')).toContainText('1280×800');
  });

  test('载入小于画布的存档：自动补齐到画布尺寸（回归：画布边缘不可编辑）', async ({ page }) => {
    await openEditor(page);
    // 1280×720 的地图：画布是 1280×800，底部 80px 原本点不动、试玩也不渲染
    await page.evaluate(() => {
      const cells = new Array(128 * 72).fill(0);
      cells[0] = 2; // 左上角水域，用于确认补齐时原有地形没被动过
      const tiny = {
        version: 1, name: '小图', size: { width: 1280, height: 720 }, gridCellSize: 10,
        terrain: { width: 128, height: 72, cells },
        cities: [{ id: 'c1', x: 100, y: 600, faction: 'blue' }, { id: 'c2', x: 1100, y: 100, faction: 'red' }],
        spawns: [{ id: 's1', faction: 'blue', x: 100, y: 600 }, { id: 's2', faction: 'red', x: 1100, y: 100 }],
        capturePoints: [], objectives: [],
      };
      localStorage.setItem('war-of-dots.custom-map', JSON.stringify({ savedAt: Date.now(), mapData: tiny }));
    });
    await page.click('[data-action="load"]');
    const info = await page.evaluate(() => ({
      size: window.__editor.store.mapData.size,
      terrain: `${window.__editor.store.mapData.terrain.width}x${window.__editor.store.mapData.terrain.height}`,
      cells: window.__editor.store.mapData.terrain.cells.length,
      keepOld: window.__editor.store.mapData.terrain.cells[0],
      newCell: window.__editor.store.mapData.terrain.cells[72 * 128], // 新增的第一行第一格
    }));
    expect(info).toEqual({
      size: { width: 1280, height: 800 }, terrain: '128x80', cells: 128 * 80, keepOld: 2, newCell: 0,
    });
    await expect(page.locator('#editorStatus')).toContainText('地图有效');
  });

  test('保存到 localStorage 并载入恢复', async ({ page }) => {
    await openEditor(page);
    await page.click('[data-tool="paint-water"]');
    await clickWorld(page, 310, 310); // 10px 网格下格子 (31,31) 的中心
    await page.click('[data-action="save"]');
    await expect(page.locator('#editorStatus')).toContainText('已保存');
    await page.reload();
    await page.waitForFunction(() => window.__editor !== undefined);
    // 重新载入后应从本地存档恢复（默认地图该格为平原）
    expect(await page.evaluate(() => window.__editor.store.mapData.terrain.cells[31 * 128 + 31])).toBe(2);
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
