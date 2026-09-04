# War of Dots（War_Game）

极简、俯视视角、2D、实时运行的桌面浏览器单机战略游戏课程项目，玩法参考 Steam 上的 [War of Dots](https://store.steampowered.com/app/3902430/War_of_Dots/)，但代码、地图、关卡、文案、UI 与资源均为原创。

## 项目规划

- **短期目标**：复制重现 War of Dots 的核心玩法
- **后续目标**：在其基础上添加新功能
- **内容划分**：项目分为「战役剧情」和「战役」两个模块

## 技术栈

- Phaser 3 + Vite + 原生 JavaScript ES Modules，使用 npm 管理依赖
- Vitest 做单元测试，Playwright 做端到端测试
- Node.js ≥ 22.12（见 `.nvmrc`），成品作为纯静态 Web 应用部署

## 开发

```sh
nvm use
npm install
npm run dev        # 启动 Vite 开发服务器
npm test           # Vitest 单元测试
npm run test:e2e   # Playwright 端到端测试
npm run build      # 构建到 dist/
```

## 项目结构

- `index.html`、`styles.css`、`game.js` — 当前浏览器原型（Canvas 2D）
- `REQUIREMENTS.md` — 产品需求与 MVP 验收范围
- `AGENTS.md` — 仓库开发规范
- `CONTRIBUTING.md` — 团队协作流程

## 进度

- [x] 可运行的原型：选择与框选、轨迹行军、接触战斗、士气、战争迷雾与战线
- [ ] 迁移至 Phaser 3 + Vite 工程结构（`src/`）
- [ ] 城市占领、生产与补给系统
- [ ] 地形与战争迷雾三态
- [ ] 教学战役与脚本敌军
- [ ] 地图编辑器
- [ ] 单元与端到端测试

详见 `REQUIREMENTS.md` 中的 MVP 功能需求与验收标准。
