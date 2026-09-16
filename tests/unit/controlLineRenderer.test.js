import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { createControlLineRenderer } from '../../src/rendering/controlLineRenderer.js';

// 实际控制线渲染契约（gdd.md §9）：
//   1) 永远可见——所有图形必须画在迷雾罩层之上（fogRenderer 的 depth = 1）；
//   2) 浅色底衬 + 深色主线双色描边（只画深色线时，叠在迷雾/森林上会看不见）；
//   3) 按 world.controlLinePaths 描折线：一条战线一次 moveTo 起头，
//      多条战线不会被连成一条（否则会出现一条横穿地图的假线）。
const FOG_DEPTH = 1;

function stubScene() {
  const calls = { depths: [], styles: [], begins: 0, moveTo: [], lineTo: [], visible: null, position: null };
  const makeElement = () => {
    const element = {
      setDepth(depth) { calls.depths.push(depth); return element; },
      setVisible(visible) { calls.visible = visible; return element; },
      setPosition(x, y) { calls.position = [x, y]; return element; },
      clear() { return element; },
      lineStyle(width, color, alpha) { calls.styles.push({ width, color, alpha }); return element; },
      beginPath() { calls.begins += 1; return element; },
      strokePath() { return element; },
      moveTo(x, y) { calls.moveTo.push([x, y]); return element; },
      lineTo(x, y) { calls.lineTo.push([x, y]); return element; },
    };
    return element;
  };
  const scene = { add: { graphics: () => makeElement(), text: () => makeElement() } };
  return { calls, scene };
}

const path = (...points) => points.map(([x, y]) => ({ x, y }));

describe('实际控制线渲染', () => {
  it('画在迷雾罩层之上（depth > 1）：底衬、主线、标签都是', () => {
    const { calls, scene } = stubScene();
    createControlLineRenderer(scene, { controlLinePaths: [] });
    expect(calls.depths).toHaveLength(3); // 底衬 + 主线 + 标签
    for (const depth of calls.depths) expect(depth).toBeGreaterThan(FOG_DEPTH);
  });

  it('先画浅色底衬再画深色主线，两条路径几何一致', () => {
    const { calls, scene } = stubScene();
    const world = { controlLinePaths: [path([0, 0], [10, 0])] };
    createControlLineRenderer(scene, world).draw();

    expect(calls.styles).toEqual([
      {
        width: values.controlLine.style.haloWidth,
        color: values.controlLine.style.haloColor,
        alpha: values.controlLine.style.haloAlpha,
      },
      {
        width: values.controlLine.style.lineWidth,
        color: values.controlLine.style.color,
        alpha: values.controlLine.style.alpha,
      },
    ]);
    expect(calls.begins).toBe(2);
    expect(calls.moveTo).toEqual([[0, 0], [0, 0]]);
    expect(calls.lineTo).toEqual([[10, 0], [10, 0]]);
  });

  it('每条折线独立起笔，点数与 lineTo 次数一致', () => {
    const { calls, scene } = stubScene();
    const world = {
      controlLinePaths: [path([0, 0], [10, 0], [20, 0]), path([100, 100], [110, 100])],
    };
    createControlLineRenderer(scene, world).draw();

    // 两遍描边各画一次：每遍 2 次 moveTo（两条战线）、3 次 lineTo
    expect(calls.moveTo).toEqual([[0, 0], [100, 100], [0, 0], [100, 100]]);
    expect(calls.lineTo).toEqual([[10, 0], [20, 0], [110, 100], [10, 0], [20, 0], [110, 100]]);
    expect(calls.visible).toBe(true);
  });

  it('没有战线时隐藏标签（而不是停在上一帧的位置）', () => {
    const { calls, scene } = stubScene();
    createControlLineRenderer(scene, { controlLinePaths: [] }).draw();
    expect(calls.visible).toBe(false);
    expect(calls.moveTo).toEqual([]);
  });
});
