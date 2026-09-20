import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROGRESS_KEY } from '../../src/achievements.js';

// 静态页面的"契约"测试。
//
// battlebackground.html / loading.html 是 classic script 页面（不能 import ES 模块），
// 里面的关卡 id 兜底逻辑与 src/level-link.js 是同一套规则的副本，无法直接单测，
// 这里守两件事：
//   1) 这三个页面确实都带了 hash / sessionStorage 兜底（只有 ?level= 会被静态服务器丢掉）；
//   2) dist 里带上了 serve.json（关闭 serve 的 cleanUrls，从根上避免 URL 被重写）。
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('战役页面：关卡 id 的多重兜底契约', () => {
  it('battlebackground.html 同时认 ?level=、#level= 与 sessionStorage', () => {
    const html = read('battlebackground.html');
    expect(html).toContain("params.get('level')");
    expect(html).toContain("hashParams.get('level')");
    expect(html).toContain("sessionStorage.getItem('war-of-dots.campaign')");
    // 兜底键必须存在：以前写死 CAMPAIGNS.liaoshen 会让整段脚本抛错（注释里提到旧写法不算）
    expect(html).not.toMatch(/\|\|\s*CAMPAIGNS\.liaoshen/);
  });

  it('loading.html 用统一的解析函数，并把 #level= 透传到下一跳', () => {
    const html = read('loading.html');
    expect(html).toContain('window.resolveCampaignLevel');
    expect(html).toContain("hashParams.get('level')");
    expect(html).toContain("'#level=' + encodeURIComponent(level)");
    expect(html).not.toMatch(/\|\|\s*LOADING_DATA\.liaoshen/);
  });

  it('battlechoose.html 的战役卡片同时带 ?level= 与 #level= 并记录选择', () => {
    const html = read('battlechoose.html');
    expect(html).toContain('function battleHref');
    expect(html).toContain("'#level=' + id");
    expect(html).toContain("sessionStorage.setItem('war-of-dots.campaign'");
  });

  it('成就页由 entry 模块渲染，风格与 introduce 同源，首页有入口', () => {
    const page = read('achievements.html');
    expect(page).toContain('/src/entries/achievements.js'); // 判定逻辑在 src/achievements.js，页面只渲染
    expect(page).toContain('members/css/introduce.css');     // 风格参考 introduce
    expect(page).toContain('id="achGrid"');
    expect(page).toContain('id="achSummary"');
    expect(read('index.html')).toContain('href="/achievements.html"');
  });

  it('result.html 读 casualtiesBlue / casualtiesRed 并展示双方伤亡', () => {
    // 结算页是 classic script 页面，参数解析与 src/rendering/hud.js 的 resultQuery 是同一套约定，
    // 但无法直接单测——这里守住契约：参数名一致、缺参数时整块隐藏。
    const html = read('result.html');
    expect(html).toContain("params.get('casualtiesBlue')");
    expect(html).toContain("params.get('casualtiesRed')");
    expect(html).toContain('id="casualtyPanel"');
    expect(html).toContain('id="casualtyOwn"');
    expect(html).toContain('id="casualtyEnemy"');
    expect(html).toMatch(/id="casualtyPanel"\s+hidden/); // 默认隐藏，有参数才显示
  });

  it('battlechoose 的关卡解锁：链条与索引一致、教学关与西安始终开', () => {
    const html = read('battlechoose.html');
    const listFrom = (name) => {
      const match = html.match(new RegExp(`var ${name} = \\[([^\\]]*)\\]`));
      if (!match) throw new Error(`battlechoose.html 里找不到 ${name}（解锁配置被删了？）`);
      return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
    };
    const progression = listFrom('PROGRESSION');
    const always = listFrom('ALWAYS_UNLOCKED');
    const index = JSON.parse(read('public/assets/levels/index.json'));
    const indexIds = new Set(index.levels.map(level => level.id));

    expect(progression.length).toBeGreaterThan(1);
    // 链条里的关卡必须真实存在（写错 id 会让那一关永远锁着）
    for (const id of progression) {
      expect(indexIds.has(id), `解锁链里的关卡不在 index.json：${id}`).toBe(true);
    }
    // 常开集合：教学关在索引里；西安是没有关卡文件的登山小游戏
    for (const id of always) {
      expect(indexIds.has(id) || id === 'xian_battle', `常开集合里的未知关卡：${id}`).toBe(true);
    }
    // 本轮决定：断裂峡谷不在地图 pin 上，不进链条
    expect(progression).not.toContain('fracture-canyon');
    // battleData 里出现的每个关卡 id 都要被解锁配置覆盖，否则那个 pin 会被"未知关卡"规则放行
    for (const match of html.matchAll(/level:\s*'([a-zA-Z0-9_-]+)'/g)) {
      const id = match[1];
      expect(progression.includes(id) || always.includes(id), `battleData 里的关卡没进解锁配置：${id}`).toBe(true);
    }
    // 通关信号：数据名与成就模块一致，且必须经账号存储层读取（键 = war-of-dots.u.<账号>.<数据名>）
    expect(html).toContain(`'${PROGRESS_KEY}'`);
    expect(html).toContain('/user-storage.js');
    expect(html).toContain('window.UserStorage.readJSON(PROGRESS_NAME');
    // 未解锁的 pin 也能打开卡片：只是"进入战役"按钮置灰 + 显示"未解锁"
    expect(html).toContain('applyEnterState');
    expect(html).toContain('未解锁');
    expect(read('members/css/battlepages.css')).toMatch(/\.battle-btn\.disabled/);
    expect(html).not.toContain('pinLockedHint'); // 旧的浮动提示已换成置灰按钮
  });

  it('战役流程页面（battlechoose / result / climb）带未登录守卫', () => {
    // 这三个是 classic script 页面，不能 import /src/auth.js，所以各带一份同样的内联守卫：
    // 没有会话 → 跳登录页并带 next。守卫必须出现在页面脚本/游戏脚本之前。
    for (const file of ['battlechoose.html', 'result.html', 'climb/climb.html']) {
      const html = read(file);
      expect(html, file).toContain("localStorage.getItem('war-of-dots.session')");
      expect(html, file).toContain("'/login.html?next='");
      // 守卫在业务脚本之前：climb 页尤其重要（否则小游戏先启动再被弹走）
      const guardAt = html.indexOf('未登录守卫');
      const bodyAt = html.indexOf('<body');
      expect(guardAt, file).toBeGreaterThan(bodyAt);
      if (file === 'climb/climb.html') {
        expect(guardAt).toBeLessThan(html.indexOf('<script src="climb.js'));
      }
    }
  });

  it('public/serve.json 关闭 cleanUrls、把 / 指回 index.html，并兜住无扩展名的干净 URL', () => {
    // cleanUrls: false 会连带关掉"目录请求自动使用 index.html"，
    // 只写 cleanUrls 的话访问 / 会变成目录列表（实测 serve 14："Files within dist"），
    // 所以必须显式把 / 重写到 /index.html。
    //
    // 另外两条 rewrite 是"外网能开、localhost 404"的修复：关掉 cleanUrls 之后
    // serve 不再把 /login 解析成 /login.html，手输的干净 URL 与浏览器缓存的旧 301 都会 404。
    // 用"不含 . 和 / 的一段"作为匹配条件，带扩展名的真实文件（/audio.js、/assets/x-hash.js）
    // 不会被卷进来；rewrite 不产生 301，查询参数因此原样保留。
    expect(JSON.parse(read('public/serve.json'))).toEqual({
      cleanUrls: false,
      rewrites: [
        { source: '/', destination: '/index.html' },
        { source: '/:page([^/.]+)', destination: '/:page.html' },
        { source: '/:dir/:page([^/.]+)', destination: '/:dir/:page.html' },
      ],
    });
  });
});
