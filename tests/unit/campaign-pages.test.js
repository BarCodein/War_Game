import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
