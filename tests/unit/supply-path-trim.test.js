import { describe, expect, it } from 'vitest';
import { backtrackPx, offsetPx, trimToUnit } from '../../src/rendering/supplyPathTrim.js';

// PvP 补给线"折回上一个途径点"bug 的回归测试（docs/pvp-plan.md §11.12）。
// 渲染器本身依赖 Phaser，不好直接测；把纯几何部分抽出来锁定行为。
const line = (points) => points.map(([x, y]) => ({ x, y }));

describe('补给线折线：贴到单位身上', () => {
  it('单位跑到折线中段：投影到线段上，首段不再是"折回"', () => {
    // 折线从 (100,100) 向东北走，单位已经跑到 (150,148) 附近
    const path = line([[100, 100], [120, 120], [140, 140], [160, 160], [180, 180]]);
    const unit = { x: 150, y: 148 };
    const trimmed = trimToUnit(path, unit);

    expect(path.length).toBe(5);                       // 不修改入参
    // 首点 = 单位在线段 (140,140)-(160,160) 上的投影，而不是顶点 (140,140)
    expect(trimmed[0].x).toBeGreaterThan(140);
    expect(trimmed[0].x).toBeLessThan(160);
    expect(trimmed[0].y).toBeCloseTo(trimmed[0].x, 5); // 仍落在原折线上
    // 关键：残余折回 ≈ 0（垂直短跳，不是沿路线后退）
    expect(backtrackPx(trimmed, unit)).toBeLessThan(0.5);
    // 起点与单位几乎垂直相连
    expect(offsetPx(trimmed, unit)).toBeCloseTo(1.41, 1);
  });

  it('单位落在折线起点附近：几乎不改变折线', () => {
    const path = line([[100, 100], [120, 120], [140, 140]]);
    const unit = { x: 101, y: 99 };
    const trimmed = trimToUnit(path, unit);
    expect(trimmed).toHaveLength(3);
    expect(trimmed[0].x).toBeCloseTo(100, 0);
    expect(offsetPx(path, unit)).toBeLessThan(2);
  });

  it('单位在折线起点"身后"：未裁剪时能测出折回长度', () => {
    const path = line([[100, 100], [110, 100]]);   // 路线向东
    const unit = { x: 120, y: 100 };                // 单位已经在起点东侧
    expect(backtrackPx(path, unit)).toBeCloseTo(20, 5);
    // 路线向西 = 顺着走，不算折回
    expect(backtrackPx(line([[100, 100], [90, 100]]), unit)).toBe(0);
    // 投影之后不再折回
    expect(backtrackPx(trimToUnit(path, unit), unit)).toBeLessThan(0.5);
  });

  it('退化输入不炸：空数组 / 单点 / 重复点', () => {
    const unit = { x: 0, y: 0 };
    expect(trimToUnit([], unit)).toEqual([]);
    expect(trimToUnit([{ x: 1, y: 1 }], unit)).toHaveLength(1);
    expect(backtrackPx([], unit)).toBe(0);
    expect(backtrackPx([{ x: 5, y: 5 }, { x: 5, y: 5 }], unit)).toBe(0);
    expect(offsetPx([], unit)).toBe(0);
  });

  it('偏移量按线段计算：单位离折线越远，offsetPx 越大（缓存失效判据）', () => {
    const path = line([[0, 0], [0, 100]]);
    expect(offsetPx(path, { x: 5, y: 50 })).toBeCloseTo(5, 5);
    expect(offsetPx(path, { x: 40, y: 50 })).toBeCloseTo(40, 5);
    expect(offsetPx(path, { x: 0, y: 150 })).toBeCloseTo(50, 5);   // 端点之外
  });
});
