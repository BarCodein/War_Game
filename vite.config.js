import { cpSync, createReadStream, existsSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// 页面入口：自动收集根目录 + members/ 下的所有 .html。
// 以前这里是手写列表，新增页面忘记登记时会出现「dev 能打开、build 后页面不存在」，
// 而 vite preview / 多数静态托管的单页回退会把 404 变成首页，
// 表现出来就是「点了某个入口跳回主页面」——很难排查，所以改成自动扫描。
function pageEntries() {
  const entries = {};
  for (const [dir, prefix] of [[root, ''], [resolve(root, 'members'), 'members-']]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.html')) continue;
      entries[`${prefix}${file.slice(0, -'.html'.length)}`] = resolve(dir, file);
    }
  }
  return entries;
}

// 项目根 assets/ 是美术资源目录（见 assets/texture/Readme），不在 public/ 下。
// 该插件让它以 /assets/** 的 URL 对外提供：
//   dev  —— 加中间件，按 /assets/** 读取根 assets/ 下的文件；
//   build—— 结束后把根 assets/ 复制到 dist/assets（与打包产物同目录，URL 一致）。
// public/assets/**（地图 JSON）仍由 Vite 的 publicDir 机制提供，两者互不冲突。
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

function rootAssets() {
  const srcDir = resolve(root, 'assets');
  return {
    name: 'war-of-dots-root-assets',
    configureServer(server) {
      server.middlewares.use('/assets', (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0]);
        const file = resolve(srcDir, `.${urlPath}`);
        // 路径穿越保护；文件不存在时交回后续中间件（例如 public/assets 下的地图）
        if (!file.startsWith(srcDir) || !existsSync(file)) return next();
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      if (existsSync(srcDir)) cpSync(srcDir, resolve(root, 'dist/assets'), { recursive: true });
    },
  };
}

// 多页构建：所有页面各自独立入口（见 pageEntries 自动扫描）。
// 开发模式由 Vite dev server 直接提供这些 .html；build 时以 rollupOptions.input 产出多个静态页面。
export default defineConfig({
  base: '/',
  plugins: [rootAssets()],
  build: {
    rollupOptions: {
      input: pageEntries(),
    },
  },
});
