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

- `src/main.js` — 入口；`src/config/` — 全部数值唯一来源；`src/i18n/` — 文案集中管理
- `src/rendering/` — Phaser 场景；`src/simulation/`、`src/input/`、`src/controllers/` — 后续阶段接入
- `public/assets/` — 静态资源；`tests/unit/` — Vitest 单元测试；`tests/e2e/` — Playwright 端到端测试
- `REQUIREMENTS.md` — 产品需求与 MVP 验收范围
- `AGENTS.md` — 仓库开发规范
- `CONTRIBUTING.md` — 团队协作流程
- `docs/` — 设计文档（gdd / architecture / acceptance-criteria / development-plan）

旧浏览器原型（`game.js` 等）已迁移，保留在 git 历史（019796f）。

## 进度

- [x] 阶段 0：设计文档与全部数值统一配置
- [x] 阶段 1：Vite + Phaser 工程骨架（`npm run dev / test / test:e2e / build` 全部跑通）
- [x] 阶段 2：纯模拟层（固定步长、战斗、士气、补给、占领、迷雾、胜负、脚本敌军，headless 可跑完整一局）
- [x] 阶段 3：Phaser 渲染 + 输入 + HUD（地形/迷雾三态/单位与虚影/选择/指挥/暂停/速度/胜利结算）
- [x] 阶段 4：教学战役调优（平衡实测、被围停产规则、任务链判定、胜负双分支 e2e）
- [x] 阶段 5：地图编辑器（绘制/对象/校验/localStorage/导入导出/一键试玩往返）
- [x] 阶段 6：性能验收（地形/迷雾纹理烘焙；500 单位 tick 4.06ms 达标；60FPS 待真实 GPU 三浏览器确认）

详见 `REQUIREMENTS.md` 中的 MVP 功能需求与验收标准。
