import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { createGameController } from '../../src/controllers/gameController.js';
import { createLoop } from '../../src/simulation/loop.js';
import { moveCommand, attackMoveCommand } from '../../src/simulation/commands.js';
import { makePlainMap, makeWorld } from './helpers.js';

// 开局准备阶段（gdd.md §11）：5 秒倒计时，期间可以下达预先指令，但模拟不推进（部队不动）。
const STEP = values.simulation.fixedStep;

describe('开局准备阶段：控制器', () => {
  it('默认按 values.prep.seconds 倒计时，isPrepping 从 true 到 false', () => {
    const controller = createGameController();
    expect(controller.isPrepping()).toBe(true);
    expect(controller.prepRemaining).toBeCloseTo(values.prep.seconds, 6);

    expect(controller.tickPrep(2)).toBe(true);          // 还剩 3 秒
    expect(controller.prepRemaining).toBeCloseTo(values.prep.seconds - 2, 6);
    expect(controller.tickPrep(2.5)).toBe(true);        // 还剩 0.5 秒
    expect(controller.tickPrep(1)).toBe(false);         // 结束
    expect(controller.prepRemaining).toBe(0);
    expect(controller.isPrepping()).toBe(false);
  });

  it('倒计时不会变成负数；结束后再 tickPrep 仍是结束状态', () => {
    const controller = createGameController({ prepSeconds: 1 });
    controller.tickPrep(99);
    expect(controller.prepRemaining).toBe(0);
    expect(controller.tickPrep(1)).toBe(false);
    expect(controller.prepRemaining).toBe(0);
  });

  it('可以一次跳过（编辑器试玩用）', () => {
    const controller = createGameController();
    expect(controller.isPrepping()).toBe(true);
    controller.skipPrep();
    expect(controller.isPrepping()).toBe(false);
    expect(controller.prepRemaining).toBe(0);
  });

  it('准备阶段不影响暂停与速度档位', () => {
    const controller = createGameController({ prepSeconds: 5 });
    controller.setSpeed(2);
    expect(controller.speed).toBe(2);
    controller.togglePause();
    expect(controller.paused).toBe(true);
    controller.togglePause();
    expect(controller.paused).toBe(false);
    expect(controller.isPrepping()).toBe(true); // 暂停不消耗准备时间（由 GameScene 控制何时 tick）
  });
});

describe('开局准备阶段：预先指令在开打后生效', () => {
  // 复现 GameScene 的节奏：准备阶段不调 loop.advance（只走倒计时），结束后才开始推进
  function runWithPrep(world, controller, loop, seconds, commands) {
    let elapsed = 0;
    while (elapsed < seconds) {
      if (controller.isPrepping()) {
        controller.tickPrep(STEP);
        for (const issue of commands) issue(); // 准备阶段照常下令
      } else {
        loop.advance(STEP, 1);
      }
      elapsed += STEP;
    }
  }

  it('准备阶段下的 move 命令：部队原地不动，倒计时结束才开始走', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const unit = world.spawnUnit('blue', 'light', 100, 240);
    const controller = createGameController({ prepSeconds: 1 });
    const loop = createLoop(world);
    const commands = [() => world.issueCommands([unit.id], moveCommand([{ x: 700, y: 240 }]))];

    // 准备阶段跑 0.5 秒：命令已生效（路线已规划），但世界时间与坐标都没变
    runWithPrep(world, controller, loop, 0.5, commands);
    expect(controller.isPrepping()).toBe(true);
    expect(world.time).toBe(0);
    expect(unit.x).toBe(100);
    expect(unit.route.length).toBeGreaterThan(0);   // 路线已经排好
    expect(unit.command?.type).toBe('move');

    // 跑完准备阶段 + 1 秒：部队开始按预先路线前进
    runWithPrep(world, controller, loop, 1.5, commands);
    expect(controller.isPrepping()).toBe(false);
    expect(world.time).toBeGreaterThan(0.5);
    expect(unit.x).toBeGreaterThan(100);
  });

  it('准备阶段下的右键进攻命令同样保留（attackMove 目标不变）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const unit = world.spawnUnit('blue', 'light', 100, 240);
    const controller = createGameController({ prepSeconds: 1 });
    const loop = createLoop(world);
    runWithPrep(world, controller, loop, 0.5, [
      () => world.issueCommands([unit.id], attackMoveCommand({ x: 650, y: 300 })),
    ]);
    expect(unit.command).toMatchObject({ type: 'attackMove', target: { x: 650, y: 300 } });
    expect(world.time).toBe(0);
  });
});
