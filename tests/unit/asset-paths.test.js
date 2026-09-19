import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 资源路径守卫（事故驱动）：
// 双堆集的地图背景图曾经因为文件名拼错（map_pics/shaungduiji.jpg）而 404，
// 引擎按设计静默回退到"逻辑地形烘焙"，表现就是"背景地图加载不出来但游戏还能玩"。
// 这类错误不会让任何测试变红，所以在这里逐条检查资源路径是否真的存在。
const root = process.cwd();
const inPublic = (urlPath) => join(root, 'public', urlPath.replace(/^\//, ''));
// 战役介绍页引用的 ./assets/... 既可能在 public/assets 下，也可能在仓库根的 assets 下（两者都会进构建产物）
const existsAnywhere = (relative) => {
  const cleaned = relative.replace(/^\.?\//, '');
  return existsSync(join(root, cleaned)) || existsSync(join(root, 'public', cleaned));
};

describe('资源路径：地图与关卡', () => {
  const mapDir = join(root, 'public/assets/maps');

  it('每张地图声明的 background 背景图都存在（写错会静默回退到逻辑地形）', () => {
    const maps = readdirSync(mapDir).filter(name => name.endsWith('.json'));
    expect(maps.length).toBeGreaterThan(0);
    for (const name of maps) {
      const map = JSON.parse(readFileSync(join(mapDir, name), 'utf8'));
      if (!map.background) continue; // 未声明 background 的地图走逻辑地形烘焙，合法
      expect(existsSync(inPublic(map.background)), `${name} 的 background 缺失：${map.background}`).toBe(true);
    }
  });

  it('关卡索引里每一关的地图文件都存在', () => {
    const index = JSON.parse(readFileSync(join(root, 'public/assets/levels/index.json'), 'utf8'));
    expect(index.levels.length).toBeGreaterThan(0);
    for (const entry of index.levels) {
      const levelPath = join(root, 'public/assets/levels', `${entry.id}.json`);
      expect(existsSync(levelPath), `关卡文件缺失：${entry.id}.json`).toBe(true);
      const level = JSON.parse(readFileSync(levelPath, 'utf8'));
      expect(existsSync(inPublic(level.map)), `${entry.id} 的 map 缺失：${level.map}`).toBe(true);
    }
  });
});

describe('资源路径：战役介绍页（battlebackground.html）', () => {
  const html = readFileSync(join(root, 'battlebackground.html'), 'utf8');
  // CAMPAIGNS 是内联 JS 对象，这里按字段抽取（本地路径才检查，http(s) 外链跳过）
  const entries = [...html.matchAll(/title:\s*'([^']+)'[\s\S]*?video:\s*'([^']+)'[\s\S]*?mapImg:\s*'([^']+)'/g)]
    .map(([, title, video, mapImg]) => ({ title, video, mapImg }));
  const local = (path) => !/^https?:\/\//.test(path);

  it('能抽到战役条目（抽取失败说明页面结构变了，需要同步这条测试）', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('本地视频与态势图都存在', () => {
    for (const entry of entries) {
      if (local(entry.video)) {
        expect(existsAnywhere(entry.video), `${entry.title} 的视频缺失：${entry.video}`).toBe(true);
      }
      if (entry.mapImg) {
        expect(existsAnywhere(entry.mapImg), `${entry.title} 的态势图缺失：${entry.mapImg}`).toBe(true);
      }
    }
  });
});
