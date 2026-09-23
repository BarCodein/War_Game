import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

// members/ 等 classic 页面的**相对资源引用**必须能在部署产物里找到。
//
// 回归背景（部署后"成员页没内容"）：`members/member.html` 用
//   <script src="pagedata.js" defer></script> + <script src="srcipt_member.js" defer></script>
// 引用数据与渲染脚本，`pagedata.js` 里还写着 `images/xxx.jpg`。
// Vite 只处理「模块脚本 / CSS / 被它识别的资源」：
//   · `<link rel=stylesheet href="css/style.css">` → 会打包成 /assets/*.css 并改写（没问题）；
//   · **classic `<script src="...">` 与 `<img src="...">` 原样保留**，而这些文件既不在 public/ 里、
//     又不会被构建复制 → 部署后 404（`npm run dev` 反而正常，因为 dev 直接按源码目录提供文件）。
// 所以规则是：**这类相对引用指向的文件必须放在 public/ 的同一相对路径下**（Vite 原样复制到 dist）。
// climb 小游戏就是这么活的（`climb/climb.html` → `climb.js` → 实际来自 `public/climb/climb.js`）。
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.verify-tmp', 'test-results']);

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) htmlFiles(full, out);
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

const isRelative = (url) => url && !/^(?:[a-z]+:|\/\/|\/|#|data:)/i.test(url);

function collectRefs(html, { images = false } = {}) {
  const refs = [];
  // classic <script src>（没有 type="module"）：Vite 从不打包它，必须自己放进 public/
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (/type\s*=\s*["']module["']/i.test(attrs)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (src && isRelative(src[1])) refs.push({ kind: 'script', url: src[1] });
  }
  // <img src>：只在 members/ 里检查 —— 那些页面的图片实测**不会**被打包器改写
  // （dist/members/group.html 里仍是 images/xxx.jpg）；别的页面（如 battlechoose 的
  // ./assets/texture/index.png）会被打包成 /assets/*.png 并改写，不能一概而论。
  if (images) {
    for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[1]);
      if (src && isRelative(src[1])) refs.push({ kind: 'img', url: src[1] });
    }
  }
  return refs;
}

describe('classic 页面的相对资源必须在 public/ 下（否则构建后 404）', () => {
  const pages = htmlFiles(ROOT);

  it('能扫到页面（避免测试自己失效）', () => {
    expect(pages.length).toBeGreaterThan(8);
  });

  it('每个相对 <script src>（以及 members/ 里的 <img src>）都能在 public/ 同路径找到', () => {
    const problems = [];
    for (const page of pages) {
      const relativePage = relative(ROOT, page).replace(/\\/g, '/');
      const html = readFileSync(page, 'utf8');
      for (const ref of collectRefs(html, { images: relativePage.startsWith('members/') })) {
        const clean = ref.url.split(/[?#]/)[0];
        if (!clean) continue;
        const mirrored = join(ROOT, 'public', relative(ROOT, dirname(page)), clean);
        if (!existsSync(mirrored)) {
          problems.push(`${relativePage} 的 <${ref.kind}> ${ref.url}`
            + ` 不在 public/（期望 ${relative(ROOT, mirrored).replace(/\\/g, '/')}）`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('成员页的数据脚本与照片都在 public/members/ 下', () => {
    // member.html 的两个 classic 脚本 + pagedata.js 里写的 images/*.jpg|png
    for (const file of ['pagedata.js', 'srcipt_member.js']) {
      expect(existsSync(join(ROOT, 'public/members', file)), file).toBe(true);
    }
    const pagedata = readFileSync(join(ROOT, 'public/members/pagedata.js'), 'utf8');
    const images = [...pagedata.matchAll(/['"]images\/([^'"]+)['"]/g)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(existsSync(join(ROOT, 'public/members/images', image)), image).toBe(true);
    }
  });
});
