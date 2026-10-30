import { describe, expect, it } from 'vitest';
import { createFixedStepper, createLoop } from '../../src/simulation/loop.js';
import { values } from '../../src/config/index.js';

// R4a 验收：把"定步长 + 追帧"抽成 createFixedStepper 之后，
// 单机（createLoop）与联机（MatchSim）用的是同一套 tick 语义。
const STEP = values.simulation.fixedStep;

function fakeWorld() {
  const state = { ticks: 0 };
  return {
    state,
    tick(step) {
      expect(step).toBe(STEP);
      state.ticks += 1;
    },
  };
}

describe('createFixedStepper：定步长 + 追帧上限 + 丢帧', () => {
  it('按固定步长切分真实时间，tick 数 = floor(累计 / step)', () => {
    const stepper = createFixedStepper();
    expect(stepper.advance(STEP * 3)).toBe(3);
    expect(stepper.advance(STEP * 0.5)).toBe(0);        // 不足一步
    expect(stepper.advance(STEP * 0.6)).toBe(1);        // 攒够一步
  });

  it('单帧最多补 maxCatchUpTicks 步，多余积压被丢弃（掉帧保护）', () => {
    const max = values.simulation.maxCatchUpTicks;
    const stepper = createFixedStepper();
    expect(stepper.advance(STEP * (max + 20))).toBe(max);
    expect(stepper.accumulator).toBeLessThan(STEP);     // 积压被清掉，不会无限追赶
  });

  it('speed 倍率放大时间（战役 1/2/3 倍速）', () => {
    const stepper = createFixedStepper();
    expect(stepper.advance(STEP, 2)).toBe(2);
    expect(stepper.advance(STEP, 0.5)).toBe(0);
  });

  it('createLoop 用同一内核推进 world（tick 次数与 stepper 一致）', () => {
    const worldA = fakeWorld();
    const worldB = fakeWorld();
    const loop = createLoop(worldA);
    const stepper = createFixedStepper({ onTick: () => worldB.tick(STEP) });

    const frames = [STEP * 2, STEP * 1.3, STEP * 7, STEP * 0.2];
    let loopTicks = 0;
    let stepperTicks = 0;
    for (const dt of frames) {
      loopTicks += loop.advance(dt);
      stepperTicks += stepper.advance(dt);
    }
    expect(loopTicks).toBe(stepperTicks);
    expect(worldA.state.ticks).toBe(worldB.state.ticks);
  });

  it('controllers 在每个固定 tick 之后按同样步长推进（AI 不按渲染帧跑）', () => {
    const seen = [];
    const loop = createLoop(fakeWorld(), [{ update: (step) => seen.push(step) }]);
    loop.advance(STEP * 3);
    expect(seen).toEqual([STEP, STEP, STEP]);
  });
});
