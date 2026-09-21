import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeUser } from '../../src/user-storage.js';

// BGM 曲目解析（public/bgm-controller.js）：classic script，页面直接 <script src>，
// 所以这里用"注入假 window/document/localStorage"的方式把它跑起来测纯逻辑
// （与 tests/unit/user-storage.test.js 测 public/user-storage.js 同一套路）。
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    raw: map,
  };
}

function loadController({ session = 'zhangsan', progress = null, bgmSong = null, bgmState = null } = {}) {
  const code = read('public/bgm-controller.js');
  const storage = fakeStorage();
  if (session) storage.setItem('war-of-dots.session', JSON.stringify({ username: session }));
  if (progress) storage.setItem(`war-of-dots.u.${normalizeUser(session)}.campaign-progress`, JSON.stringify(progress));
  if (bgmState) storage.setItem(`war-of-dots.bgm.${bgmSong || 'piano_string'}`, JSON.stringify(bgmState));
  const fakeWindow = { addEventListener() {}, BGM_SONG: bgmSong || undefined };
  // 控制器只在 document.body 存在时才注入 iframe；body=null 就只跑纯逻辑分支
  const fakeDocument = { currentScript: null, body: null, addEventListener() {} };
  const factory = new Function('window', 'document', 'localStorage', `${code}\nreturn window.BgmController;`);
  return { api: factory(fakeWindow, fakeDocument, storage), storage, fakeWindow };
}

describe('BGM 曲目解析', () => {
  it('默认曲目是《江山如此多娇》，全战役通关（打完渡江）后换成钢琴曲', () => {
    const fresh = loadController().api;
    expect(fresh.DEFAULT_SONG).toBe('jiangshanruciduojiao');
    expect(fresh.CLEARED_SONG).toBe('piano_string');
    expect(fresh.CLEARED_LEVEL).toBe('dujiang_battle'); // 与 result.html / ending.html 的结局关卡同口径
    expect(fresh.resolveSong()).toBe('jiangshanruciduojiao');

    const cleared = loadController({ progress: { dujiang_battle: { completed: true, wins: 1 } } }).api;
    expect(cleared.campaignCleared()).toBe(true);
    expect(cleared.resolveSong()).toBe('piano_string');
  });

  it('只通关别的战役不算通关（口径 = 渡江那一关）', () => {
    const api = loadController({
      progress: { subei_battle: { completed: true }, pingjin_battle: { completed: true }, dujiang_battle: { wins: 3 } },
    }).api;
    expect(api.campaignCleared()).toBe(false);
    expect(api.resolveSong()).toBe('jiangshanruciduojiao');
  });

  it('页面显式指定的曲目优先于通关状态（game / battlebackground / 结局页都靠这条）', () => {
    const cleared = loadController({ progress: { dujiang_battle: { completed: true } }, bgmSong: 'zaitaihangshandshang' }).api;
    expect(cleared.resolveSong()).toBe('zaitaihangshandshang');
    const fresh = loadController({ bgmSong: 'piano_string' }).api;
    expect(fresh.resolveSong()).toBe('piano_string');
  });

  it('曲目按账号解析：换账号登录读的是各自进度，不会串', () => {
    const { api, storage } = loadController({ session: 'alice', progress: { dujiang_battle: { completed: true } } });
    expect(api.resolveSong()).toBe('piano_string');
    storage.setItem('war-of-dots.session', JSON.stringify({ username: 'bob' }));
    expect(api.campaignCleared()).toBe(false);
    expect(api.resolveSong()).toBe('jiangshanruciduojiao');
  });

  it('账号归一化与 src/user-storage.js 同一套规则', () => {
    const api = loadController().api;
    for (const name of ['', 'Zhang San', 'E2E-User', 'dz634220@163.com', '...', undefined]) {
      expect(api.normalizeUser(name)).toBe(normalizeUser(name));
    }
  });

  it('savedPaused 读的是"用户意图"（war-of-dots.bgm.<曲目>.paused）', () => {
    const { api } = loadController({ bgmState: { paused: true, t: 12 } });
    expect(api.savedPaused('war-of-dots.bgm.piano_string')).toBe(true);
    expect(api.savedPaused('war-of-dots.bgm.jiangshanruciduojiao')).toBe(false);
    const fresh = loadController().api;
    expect(fresh.savedPaused('war-of-dots.bgm.piano_string')).toBe(false);
  });
});

describe('bgm.html 存的是用户意图而不是当前播放状态', () => {
  it('写回 paused 用 intentPaused；视频让位的内部 pause 不碰用户意图', () => {
    const html = read('public/bgm.html');
    expect(html).toContain('var intentPaused');
    // 轮询落盘写的是意图
    expect(html).toMatch(/paused:\s*intentPaused/);
    // 不许再把 audio.paused 直接当用户意图写进去
    expect(html).not.toMatch(/paused:\s*audio\.paused/);
    // 内部让位（pause 命令）与用户按钮（toggle）分开
    expect(html).toContain("msg.cmd === 'pause'");
    expect(html).toContain('intentPaused = !intentPaused');
  });
});
