import { values } from '../config/index.js';

// 固定时间步长累积器（architecture.md §4）：模拟步长 1/60s，与渲染帧率无关；
// 每帧最多补 maxCatchUpTicks 个 tick，掉帧时丢弃积压；speed 为游戏速度倍率。
export function createLoop(world) {
  let accumulator = 0;
  return {
    advance(renderDt, speed = 1) {
      accumulator += renderDt * speed;
      const step = values.simulation.fixedStep;
      let ticks = 0;
      while (accumulator >= step && ticks < values.simulation.maxCatchUpTicks) {
        world.tick(step);
        accumulator -= step;
        ticks += 1;
      }
      if (accumulator >= step) accumulator = 0; // 掉帧：丢弃积压
      return ticks;
    },
    get accumulator() {
      return accumulator;
    },
  };
}

// 直接推进 world 到目标时刻（测试与 headless 对局用）；分出胜负即停止。
export function advanceTo(world, targetTime) {
  const step = values.simulation.fixedStep;
  while (world.time < targetTime && !world.winner) world.tick(step);
}
