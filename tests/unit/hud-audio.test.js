import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 局内音效契约：**单位接触战斗时的音效（blade）与单位阵亡时的音效（hurt）已按需求移除**。
// 实现原来在 src/rendering/hud.js（两个 setInterval：检测蓝兵进战斗的上升沿 / 读 unitDied 事件），
// 现在整段删掉。这两个音效很容易在后续改战斗表现时被顺手加回来，所以这里用契约测试盯住。
//
// 注意：public/audio.js 里的 blade / hurt **映射表与素材刻意保留**（要恢复时直接重新触发即可），
// 所以这一条只扫 src/（局内逻辑），不去管映射表本身。
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('局内战斗音效（已移除）', () => {
  it('hud.js 不再触发 blade / hurt，也不再留着那两个检测定时器', () => {
    const hud = read('src/rendering/hud.js');
    expect(hud).not.toMatch(/playSfx\??\.\(\s*'blade'/);
    expect(hud).not.toMatch(/playSfx\??\.\(\s*'hurt'/);
    expect(hud).not.toContain('checkCombatSfx');
    expect(hud).not.toContain('checkDeathSfx');
    expect(hud).not.toContain('combatSfxIntervals');
  });

  it('src/ 下没有任何地方再播这两个音效', () => {
    const offenders = walk(`${root}src`)
      .filter((file) => /['"](blade|hurt)['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(root, ''));
    expect(offenders, `这些文件还在引用 blade/hurt：${offenders.join(', ')}`).toEqual([]);
  });

  it('没有误删别的局内音效：据点易主仍播 explosion', () => {
    expect(read('src/rendering/hud.js')).toContain("playSfx?.('explosion')");
    // 映射表与素材保留，方便以后恢复
    const audio = read('public/audio.js');
    expect(audio).toContain("blade: 'blade.mp3'");
    expect(audio).toContain("hurt: 'hurt.mp3'");
  });
});
