import { describe, expect, it } from 'vitest';
import { createSelection } from '../../src/input/selection.js';
import { createOrders } from '../../src/input/orders.js';
import { makePlainMap, makeWorld, advance } from './helpers.js';

// 输入层交互（gdd.md §11）。scene.input 用桩替代 Phaser，事件按注册顺序派发
// （GameScene 里先建 selection 再建 orders，这里保持同样顺序）。
function makeInput(world) {
  const handlers = { pointerdown: [], pointermove: [], pointerup: [] };
  const scene = {
    input: {
      on(event, fn) {
        handlers[event].push(fn);
      },
    },
  };
  const selection = createSelection(scene, world);
  const orders = createOrders(scene, world, selection);
  const pointer = (x, y, { shift = false, right = false } = {}) => ({
    worldX: x,
    worldY: y,
    button: 0,
    shiftKey: shift,
    event: { shiftKey: shift },
    rightButtonDown: () => right,
  });
  const fire = (event, p) => { for (const fn of handlers[event]) fn(p); };
  return {
    selection,
    orders,
    down: (x, y, opts) => fire('pointerdown', pointer(x, y, opts)),
    move: (x, y, opts) => fire('pointermove', pointer(x, y, opts)),
    up: (x, y, opts) => fire('pointerup', pointer(x, y, opts)),
  };
}

// 三个己方单位：A(200,300) B(400,300) C(600,300)，另有 1 个敌军
function makeWorldWithUnits() {
  const world = makeWorld(makePlainMap({ width: 1280, height: 800 }));
  return {
    world,
    a: world.spawnUnit('blue', 'light', 200, 300),
    b: world.spawnUnit('blue', 'light', 400, 300),
    c: world.spawnUnit('blue', 'light', 600, 300),
    enemy: world.spawnUnit('red', 'light', 900, 300),
  };
}

describe('输入交互：直接从单位画出移动路径', () => {
  it('从未选中的单位起笔拖动 → 自动选中该单位并下达 move 命令（无需先框选）', () => {
    const { world, a, b } = makeWorldWithUnits();
    const input = makeInput(world);

    expect(input.selection.selected.size).toBe(0);
    input.down(a.x, a.y);                 // 直接在 A 上按下（A 未被选中）
    input.move(a.x + 30, a.y + 10);
    input.move(a.x + 60, a.y + 20);
    input.up(a.x + 60, a.y + 20);

    expect([...input.selection.selected]).toEqual([a.id]);      // 只选中起笔的那个单位
    expect(a.command?.type).toBe('move');                       // 直接下发移动命令
    expect(a.route.length).toBeGreaterThan(0);
    expect(b.command).toBeNull();                               // 其他单位不受影响
  });

  it('单纯点击单位（无拖动）→ 只选择，不下发移动命令', () => {
    const { world, a } = makeWorldWithUnits();
    const input = makeInput(world);

    input.down(a.x, a.y);
    input.move(a.x + 3, a.y + 2);   // 轻微抖动，未达拖动阈值
    input.up(a.x + 3, a.y + 2);

    expect([...input.selection.selected]).toEqual([a.id]);
    expect(a.command).toBeNull();
    expect(a.route).toEqual([]);
  });

  it('Shift + 从未选中单位起笔 → 追加选择，并把路径段追加给当前选择', () => {
    const { world, a, b } = makeWorldWithUnits();
    const input = makeInput(world);

    input.down(a.x, a.y);
    input.up(a.x, a.y);                                  // 先选中 A
    expect([...input.selection.selected]).toEqual([a.id]);

    input.down(b.x, b.y, { shift: true });               // Shift 从 B 起笔
    input.move(b.x + 40, b.y + 40);
    input.up(b.x + 40, b.y + 40);

    expect(new Set(input.selection.selected)).toEqual(new Set([a.id, b.id])); // 追加选择
    // Shift + 拖动 = 追加路径段（appendRoute），作用于当前选择（A、B 都收到）
    expect(a.route.length + a.pendingQueue.length).toBeGreaterThan(0);
    expect(b.route.length + b.pendingQueue.length).toBeGreaterThan(0);
  });

  it('从空地拖动 → 仍是框选，不下发任何命令', () => {
    const { world, a, b, c } = makeWorldWithUnits();
    const input = makeInput(world);

    input.down(150, 250);              // 空地起笔
    input.move(450, 350);              // 拖出覆盖 A、B 的框
    input.up(450, 350);

    expect(new Set(input.selection.selected)).toEqual(new Set([a.id, b.id]));
    expect(a.command).toBeNull();
    expect(b.command).toBeNull();
    expect(c.command).toBeNull();
  });

  it('框选之后直接单击其中一个单位 → 选择收拢为该单位（回归）', () => {
    const { world, a, b, c } = makeWorldWithUnits();
    const input = makeInput(world);

    input.down(150, 250);              // 框选 A、B
    input.move(450, 350);
    input.up(450, 350);
    expect(new Set(input.selection.selected)).toEqual(new Set([a.id, b.id]));

    // 直接单击框内单位 B：选择应变成只有 B，不需要先点空地取消选择
    input.down(b.x, b.y);
    input.up(b.x, b.y);
    expect([...input.selection.selected]).toEqual([b.id]);

    // 再单击框外的单位 C 同样直接生效
    input.down(c.x, c.y);
    input.up(c.x, c.y);
    expect([...input.selection.selected]).toEqual([c.id]);
    expect(c.command).toBeNull();      // 单击不产生移动命令
  });

  it('框选之后 Shift + 单击 → 追加选择而不是替换', () => {
    const { world, a, b, c } = makeWorldWithUnits();
    const input = makeInput(world);

    input.down(a.x, a.y);
    input.up(a.x, a.y);
    input.down(b.x, b.y, { shift: true });
    input.up(b.x, b.y, { shift: true });
    expect(new Set(input.selection.selected)).toEqual(new Set([a.id, b.id]));

    // 单击已选中的 A（不带 Shift）→ 收拢为 [A]
    input.down(a.x, a.y);
    input.up(a.x, a.y);
    expect([...input.selection.selected]).toEqual([a.id]);
  });

  it('右键仍是指挥：空地 attackMove、目视敌军 attack', () => {
    const { world, a, enemy } = makeWorldWithUnits();
    const input = makeInput(world);

    input.down(a.x, a.y);
    input.up(a.x, a.y);
    expect([...input.selection.selected]).toEqual([a.id]);

    input.down(700, 500, { right: true });
    input.up(700, 500, { right: true });
    expect(a.command?.type).toBe('attackMove');

    // 敌军在视野外时不认作攻击目标；先把它移进视野（并推进一帧刷新迷雾）再右键
    enemy.x = a.x + 40;
    enemy.y = a.y;
    advance(world, 1 / 60);
    input.down(enemy.x, enemy.y, { right: true });
    input.up(enemy.x, enemy.y, { right: true });
    expect(a.command?.type).toBe('lock');
  });
});
