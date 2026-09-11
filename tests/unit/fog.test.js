import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { FOG_EXPLORED, FOG_VISIBLE, isSpotted } from '../../src/simulation/systems/fog.js';
import { values } from '../../src/config/index.js';

function fogCell(world, x, y) {
  const terrain = world.terrain;
  const cell = terrain.cellAt(x, y);
  return world.fog.blue[terrain.cellIndex(cell.cx, cell.cy)];
}

describe('fog', () => {
  it('初始全部从未探索；单位视野内格变为可见', () => {
    const world = makeWorld(makePlainMap());
    const unit = world.spawnUnit('blue', 'light', 640, 360);
    expect(world.fog.blue.every(v => v === 0)).toBe(true);
    advance(world, 1 / 60);
    expect(fogCell(world, 640, 360)).toBe(FOG_VISIBLE);
    expect(fogCell(world, 100, 100)).toBe(0);
    expect(unit.lastSeen.blue).toBe(null);
  });

  it('离开视野后变为已探索', () => {
    const world = makeWorld(makePlainMap());
    const unit = world.spawnUnit('blue', 'light', 640, 360);
    advance(world, 1 / 60);
    unit.x = 100;
    unit.y = 100;
    advance(world, 1 / 60);
    expect(fogCell(world, 640, 360)).toBe(FOG_EXPLORED);
    expect(fogCell(world, 100, 100)).toBe(FOG_VISIBLE);
  });

  it('城市视野 180 参与可见区域', () => {
    const world = makeWorld(makePlainMap());
    advance(world, 1 / 60);
    expect(fogCell(world, 100, 750)).toBe(FOG_VISIBLE); // 距蓝城 150 ≤ 180（y=750 越界取边界格）
    expect(fogCell(world, 400, 600)).toBe(0); // 距蓝城 300 > 180
  });

  it('森林中的敌军仅 60px 内可目视', () => {
    // 红单位所在 (640,360) 一带设为森林：10px 网格下的 2×2 块，对应原 20px 的 (32,18)
    const world = makeWorld(makePlainMap({
      terrainCells: {
        '64,36': values.terrain.codes.forest,
        '65,36': values.terrain.codes.forest,
        '64,37': values.terrain.codes.forest,
        '65,37': values.terrain.codes.forest,
      },
    }));
    const blue = world.spawnUnit('blue', 'light', 700, 360);
    const red = world.spawnUnit('red', 'light', 640, 360); // 森林格 (64,36)
    advance(world, 1 / 60);
    expect(isSpotted(world, red, 'blue')).toBe(true); // 距 60 ≤ 60
    blue.x = 710;
    advance(world, 1 / 60);
    expect(isSpotted(world, red, 'blue')).toBe(false); // 距 70 > 60
    blue.x = 800;
    advance(world, 1 / 60);
    expect(isSpotted(world, red, 'blue')).toBe(false); // 视野外
  });

  it('敌军脱离视野后保留最后已知位置', () => {
    const world = makeWorld(makePlainMap());
    // 相距 60：既在视野（140）内，又大于软排斥的最小间距（半径和 28），
    // 避免 separateOverlaps 把敌军推开导致位置与预期不符。
    world.spawnUnit('blue', 'light', 600, 360);
    const red = world.spawnUnit('red', 'light', 660, 360);
    advance(world, 1 / 60);
    expect(red.lastSeen.blue).toMatchObject({ x: 660, y: 360 });
    red.x = 200;
    red.y = 200; // 移出视野
    advance(world, 1 / 60);
    expect(red.lastSeen.blue).toMatchObject({ x: 660, y: 360 }); // 保留
  });
});
