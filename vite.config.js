import { cpSync, createReadStream, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

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

// 多页构建：主页（落地页）、战役选择页、游戏页、地图编辑器页各自独立入口。
// 开发模式由 Vite dev server 直接提供这些 .html；build 时以 rollupOptions.input 产出多个静态页面。
export default defineConfig({
  base: '/',
  plugins: [rootAssets()],
  build: {
    rollupOptions: {
      input: {
        home: `${root}index.html`,
        login: `${root}login.html`,
        battlechoose: `${root}battlechoose.html`,
        game: `${root}game.html`,
        editor: `${root}editor.html`,
        battle: `${root}battle.html`,
        membersMain: `${root}members/main.html`,
        membersAbout: `${root}members/about.html`,
        membersGroup: `${root}members/group.html`,
        membersProgress: `${root}members/progress.html`,
        member: `${root}members/member.html`,
      },
    },
  },
});
