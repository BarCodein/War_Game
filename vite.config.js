import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// 多页构建：主页（落地页）、游戏页、地图编辑器页各自独立入口。
// 开发模式由 Vite dev server 直接提供这些 .html；build 时以 rollupOptions.input 产出多个静态页面。
export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        home: `${root}index.html`,
        game: `${root}game.html`,
        editor: `${root}editor.html`,
      },
    },
  },
});
