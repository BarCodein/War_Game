import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// 教学关卡（基础教学 / 地形与士气）的**对话过场已整体移除**：
// 以前进关卡先播开场剧情（9 段 / 13 段），打完再播结束剧情（6 段 / 5 段），
// 现在直接进教学面板、打完直接回作战地图。过场用到的素材目录也一起删了。
// 这里把这些"删掉的东西"钉住，免得以后谁顺手把剧情加回来却忘了素材/流程。
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('教学关卡：对话过场已移除', () => {
  it('tutorial.js 里没有剧情配置与过场遮罩，进关卡直接 startTutorial()', () => {
    const js = read('public/tutorial.js');
    expect(js).not.toContain('TUTORIAL_STORY');        // 第一关开场剧情配置
    expect(js).not.toContain('TUTORIAL_END_STORY');    // 第一关结束剧情配置
    expect(js).not.toContain('tutorialStoryOverlay');  // 过场遮罩元素
    expect(js).not.toContain('assetPath: "/assets/tutorial/"');
    expect(js).not.toContain('buildStoryOverlay(');    // 只允许注释里提到，不允许调用
    // 直接开始教学引导
    expect(js).toContain('startTutorial();');
    // 打完教学仍然要回作战地图（结束剧情那一步换成了直接跳转）
    expect(js).toContain('window.location.href = "/battlechoose.html"');
  });

  it('过场素材目录已经删掉（bg / 立绘 / 三个过场音效）', () => {
    expect(existsSync(new URL('../../assets/tutorial', import.meta.url))).toBe(false);
  });

  it('步骤引导面板不受影响：两关都还有各自的任务清单', () => {
    const js = read('public/tutorial.js');
    // 第一关 7 步用默认 steps，第二关用 STEPS_LEVEL2
    expect(js).toContain('steps = STEPS_LEVEL2');
    expect(js).toContain('function buildPanel()');
    expect(js).toContain('tutorialChecklist');
  });
});
