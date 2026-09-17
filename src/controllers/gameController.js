import { values } from '../config/index.js';

// 游戏控制器：暂停、游戏速度与**开局准备阶段**（REQUIREMENTS.md §4.5、gdd.md §11）。
// 状态被 GameScene 读取（暂停时跳过模拟 tick；准备阶段只走倒计时），HUD 通过 onChange 订阅刷新。
export function createGameController({ prepSeconds = values.prep.seconds } = {}) {
  let paused = false;
  let speed = 1;
  // 准备阶段剩余秒数（0 = 已开打）；按真实时间倒计时，不受游戏速度影响
  let prepRemaining = Math.max(0, prepSeconds);
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    get paused() {
      return paused;
    },
    get speed() {
      return speed;
    },
    get prepRemaining() {
      return prepRemaining;
    },
    // 是否还在开局准备阶段（此期间 GameScene 不推进模拟，但输入照常产生命令）
    isPrepping() {
      return prepRemaining > 0;
    },
    // 推进准备阶段倒计时（传真实 dt）；返回是否仍在准备阶段
    tickPrep(dt) {
      if (prepRemaining <= 0) return false;
      prepRemaining = Math.max(0, prepRemaining - dt);
      return prepRemaining > 0;
    },
    // 直接跳过准备阶段（编辑器试玩用）
    skipPrep() {
      if (prepRemaining === 0) return;
      prepRemaining = 0;
      notify();
    },
    togglePause() {
      paused = !paused;
      notify();
    },
    setSpeed(next) {
      if (values.simulation.speeds.includes(next)) {
        speed = next;
        notify();
      }
    },
    onChange(listener) {
      listeners.add(listener);
    },
  };
}
