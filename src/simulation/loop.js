import { values } from '../config/index.js';

// 固定时间步长累积器（architecture.md §4）：模拟步长 1/60s，与渲染帧率无关；
// 每帧最多补 maxCatchUpTicks 个 tick，掉帧时丢弃积压。
//
// `createFixedStepper` 是"纯定步长"内核：不碰 world、不知道 world 存在，只负责把
// 真实经过的时间切成固定步，并在每一步回调 `onTick(step)`。
// 单机（GameScene）与联机（server/src/match.js）共用它，保证两端 tick 语义完全一致。
export function createFixedStepper({
  step = values.simulation.fixedStep,
  maxCatchUpTicks = values.simulation.maxCatchUpTicks,
  onTick = null,
} = {}) {
  let accumulator = 0;
  return {
    /** @param {number} dtSeconds 真实经过时间（秒） @param {number} speed 速度倍率 */
    advance(dtSeconds, speed = 1) {
      accumulator += dtSeconds * speed;
      let ticks = 0;
      while (accumulator >= step && ticks < maxCatchUpTicks) {
        onTick?.(step, ticks);
        accumulator -= step;
        ticks += 1;
      }
      if (accumulator >= step) accumulator = 0; // 掉帧：丢弃积压
      return ticks;
    },
    get accumulator() {
      return accumulator;
    },
    /** 直接设定累积量（联机侧用毫秒累加，需要回写） */
    set accumulatorMs(value) {
      accumulator = Number.isFinite(value) ? value / 1000 : 0;
    },
    get accumulatorMs() {
      return accumulator * 1000;
    },
    get stepSeconds() {
      return step;
    },
  };
}

// 单机主循环：定步长推进 world + 每个 tick 推进控制器（脚本敌军 / 战术 AI）。
// controllers 在每个固定 tick 之后按同样的步长推进——这样实机与 headless
// 测试（tests/unit/helpers.js 的 runSimulation 也是这个节奏）完全一致，AI 决策才可复现
//（docs/ai-design.md §4：AI 不能按渲染帧调用）。
export function createLoop(world, controllers = []) {
  const stepper = createFixedStepper({
    onTick: (step) => {
      world.tick(step);
      for (const controller of controllers) controller.update(step);
    },
  });
  return {
    advance: stepper.advance,
    get accumulator() {
      return stepper.accumulator;
    },
  };
}

// 直接推进 world 到目标时刻（测试与 headless 对局用）；分出胜负即停止。
export function advanceTo(world, targetTime) {
  const step = values.simulation.fixedStep;
  while (world.time < targetTime && !world.winner) world.tick(step);
}
