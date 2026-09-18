import { describe, it, expect } from 'vitest';
import { approachAngle } from '../../src/rendering/unitRenderer.js';

// 转身平滑（纯显示层，gdd.md §4）：角度按最大步长朝目标逼近、走最短弧、不产生过冲。
describe('单位转身：approachAngle（显示层角度逼近）', () => {
  it('不超过最大步长（每次最多转 maxStep 弧度）', () => {
    expect(approachAngle(0, Math.PI, 1)).toBeCloseTo(1);
  });

  it('距目标不足一步时直接到达，不过冲', () => {
    expect(approachAngle(2.5, 3, 1)).toBe(3);
    expect(approachAngle(0, 0.1, 1)).toBeCloseTo(0.1);
  });

  it('跨 ±π 边界走最短弧（3.0 → -3.0 应往 +π 方向转，而非绕 0 转 6 弧度）', () => {
    // 3 → -3 的最短弧 = +0.283 rad（往 +π 方向）；一步 0.1 时沿正方向前进
    expect(approachAngle(3, -3, 0.1)).toBeCloseTo(3.1);
    // 一步给够时直接落到目标角（等价于 -3 + 2π）
    expect(approachAngle(3, -3, 1)).toBeCloseTo(-3 + 2 * Math.PI);
  });

  it('零步长 / 负步长保持原角度', () => {
    expect(approachAngle(1, 2, 0)).toBe(1);
    expect(approachAngle(1, 2, -1)).toBe(1);
  });

  it('反向旋转正确（0 → -π/2 朝负方向转）', () => {
    expect(approachAngle(0, -Math.PI / 2, Math.PI / 4)).toBeCloseTo(-Math.PI / 4);
  });

  it('逐帧迭代收敛到目标角，不振荡', () => {
    let angle = 0;
    for (let frame = 0; frame < 60; frame += 1) angle = approachAngle(angle, Math.PI, 0.5);
    expect(angle).toBeCloseTo(Math.PI);
    // 收敛后保持稳定
    expect(approachAngle(angle, Math.PI, 0.5)).toBeCloseTo(Math.PI);
  });
});
