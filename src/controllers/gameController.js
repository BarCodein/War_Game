import { values } from '../config/index.js';

// 游戏控制器：暂停与游戏速度（REQUIREMENTS.md §4.5）。
// 状态被 GameScene 读取（暂停时跳过模拟 tick），HUD 通过 onChange 订阅刷新。
export function createGameController() {
  let paused = false;
  let speed = 1;
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
