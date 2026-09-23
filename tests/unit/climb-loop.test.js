import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 西安事变登山小游戏（climb/）主循环契约：**逻辑固定 60Hz 步进**，与显示器刷新率无关。
//
// 为什么要单独守这条：
//   1. requestAnimationFrame 的频率跟着显示器刷新率走，而这个小游戏所有数值
//      （SPEED 5.5px/帧、GRAV、JUMP_V、冷却、flash、shake…）都是按"一帧一步 @60Hz"调的，
//      逐帧更新会让 120Hz/144Hz 的机器整局跑成 2~2.4 倍速；
//   2. 这个文件有**两份副本**：`climb/climb.js`（仓库根，Vite 构建输入）与
//      `public/climb/climb.js`（真正被页面加载的那份——dev 由 Vite 的 public 目录直出，
//      构建后 public 会覆盖到 dist/climb/climb.js；单元测试也读它）。
//      两份已经漂移过（根副本少 5 个成就定义），改小游戏必须改 public 这份。
//      下面同时断言"页面引用的那份"里带固定步长循环。
const LIVE_FILE = new URL('../../public/climb/climb.js', import.meta.url);

describe('登山小游戏：主循环固定步长', () => {
  const source = readFileSync(LIVE_FILE, 'utf8');

  it('页面真正加载的副本（public/climb/climb.js）带固定步长累加器', () => {
    expect(source).toContain('const STEP_MS = 1000 / 60');
    expect(source).toContain('stepAccumulator += elapsed');
    expect(source).toContain('while (stepAccumulator >= STEP_MS');
    expect(source).toContain('MAX_STEPS_PER_FRAME'); // 掉帧时最多补几步，避免瞬移
  });

  it('逻辑更新在累加器循环里，而不是每帧直接调一次', () => {
    const loopAt = source.indexOf('while (stepAccumulator >= STEP_MS');
    const drawAt = source.indexOf('drawSky()', loopAt); // 注意：要找"调用"而不是函数定义
    expect(loopAt).toBeGreaterThan(-1);
    expect(drawAt).toBeGreaterThan(loopAt); // 绘制在循环之外（每帧都画）
    // 循环体内应有地形/玩家/敌人/子弹/危险物五步（顺序与原来一致）
    for (const call of ['updatePlatforms()', 'updatePlayer()', 'updateEnemies()', 'updateBullets()', 'updateHazards()', 'checkCollisions()', 'updateCamera()']) {
      const at = source.indexOf(call, loopAt);
      expect(at, call).toBeGreaterThan(loopAt);
      expect(at, call).toBeLessThan(drawAt);
    }
  });

  it('受控时钟/掉帧有防护：单帧计时上限 + 追不上就丢积压', () => {
    expect(source).toContain('MAX_FRAME_MS');
    expect(source).toContain('stepAccumulator = 0');
    expect(source).toContain('if (elapsed < 0) elapsed = 0');
  });
});
