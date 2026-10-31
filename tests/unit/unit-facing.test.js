import { describe, expect, it } from 'vitest';
import { movementFacing } from '../../src/rendering/unitRenderer.js';

// 回归：联机快照**不下发敌方行军路线**，所以"没有路线时按位移推断朝向"必须成立，
// 否则敌方单位在前进时永远保持初始角度（需求方反馈的 bug）。
describe('朝向：没有路线时按本帧位移推断', () => {
  it('向右移动 → 0 弧度', () => {
    expect(movementFacing({ x: 100, y: 100 }, { x: 102, y: 100 })).toBeCloseTo(0, 6);
  });

  it('向上移动 → -π/2（屏幕 y 向下为正）', () => {
    expect(movementFacing({ x: 100, y: 100 }, { x: 100, y: 98 })).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('向左下 45° 移动 → 3π/4', () => {
    const angle = movementFacing({ x: 100, y: 100 }, { x: 98, y: 102 });
    expect(angle).toBeCloseTo((3 * Math.PI) / 4, 6);
  });

  it('几乎没动 → null（保持上次朝向，避免静止抖动）', () => {
    expect(movementFacing({ x: 100, y: 100 }, { x: 100.01, y: 100 })).toBeNull();
    expect(movementFacing({ x: 100, y: 100 }, { x: 100, y: 100 })).toBeNull();
  });

  it('没有上一帧位置 → null', () => {
    expect(movementFacing(null, { x: 10, y: 10 })).toBeNull();
  });
});
