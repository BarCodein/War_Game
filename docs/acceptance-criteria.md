# MVP 验收标准

> 将 `REQUIREMENTS.md` §6 细化为可勾选清单。验证方式：**Vitest**（单元）/ **Playwright**（端到端）/ **手动** / **评审**（代码走查）。全部勾选即 MVP 达成。数值依据见 `gdd.md`，实现方案见 `architecture.md`。

## A. 单位与操作

- [x] A1 轻型与重型单位属性（生命/伤害/间隔/距离/速度/视野）来自配置且符合 gdd.md 数值表 — Vitest
- [ ] A2 左键单选单位 — Playwright
- [ ] A3 拖动框选单位 — Playwright
- [ ] A4 Shift 增减选择 — Playwright
- [ ] A5 右键移动（含轨迹多路径点）— Playwright
- [ ] A6 右键攻击移动 / 攻击指定敌军 — Playwright
- [ ] A7 ≥100 单位统一下令无阻塞，命令经统一接口分发 — Vitest + 手动性能
- [ ] A8 输入与战斗逻辑解耦（input 只产命令，simulation 独立可测）— 评审 + Vitest

## B. 城市、生产与补给

- [x] B1 己方城市每 12 s 自动生产 1 个轻型单位，补给容量满时暂停 — Vitest
- [x] B2 每座己方城市默认补给容量 5 — Vitest
- [x] B3 超出补给上限的单位生命受损耗且士气下降（−1 /s、−2 /s）— Vitest
- [x] B4 占领进度：每单位 5% /s、上限 15% /s；敌方单位在场冻结；离开后 3% /s 衰减 — Vitest
- [x] B5 占领进度 100% 时城市变更阵营 — Vitest
- [x] B6 己方城市附近恢复生命与士气（+3 /s、+5 /s）— Vitest

## C. 战斗、地形与视野

- [x] C1 敌对单位进入交战距离自动攻击 — Vitest
- [x] C2 伤害公式含地形修正（森林 0.85、桥梁 0.9）— Vitest
- [x] C3 四种地形通行性与移动倍率正确（水域仅桥梁可通行）— Vitest
- [ ] C4 战争迷雾正确区分三态：当前可见 / 已探索 / 从未探索 — Vitest + Playwright
- [ ] C5 不可见敌军不显示实时状态；显示最后已知位置虚影并在重新目视后更新 — Vitest + Playwright
- [x] C6 森林视野阻挡：森林中敌军仅在 60 px 内可见 — Vitest

## D. 士气

- [x] D1 士气受友军/城市/补给/交战/友军阵亡影响，修正值符合 gdd.md §6 — Vitest
- [x] D2 低士气削弱效果（削弱 ×0.75 伤害，动摇 ×0.5）— Vitest
- [x] D3 士气归零触发溃逃（不受指挥、向己方城市撤退、恢复至 20 停止）— Vitest
- [x] D4 无法撤退（被困或无己方城市）时投降移除 — Vitest
- [ ] D5 士气变化有 UI 反馈（血条旁士气条变色、状态标签）— Playwright

## E. 关卡、控制器与胜负

- [ ] E1 教学关卡完整闭环可玩：选择 → 指挥 → 交战 → 观察迷雾与士气 → 占领 → 胜负结算 — Playwright
- [x] E2 脚本敌军支持驻守、定时增援、条件触发进攻、预设目标移动 — Vitest
- [x] E3 脚本敌军经统一命令接口控制世界（与玩家输入同一通道）— 评审 + Vitest
- [x] E4 胜利条件：占领全部敌方城市；或消灭全部敌军且敌方无可生产城市 — Vitest
- [x] E5 失败条件与胜利对称 — Vitest
- [ ] E6 暂停与游戏速度控制（空格暂停、×0.5/×1/×2）— Playwright

## F. 地图编辑器

- [ ] F1 新建地图并设置名称、尺寸 — Playwright
- [ ] F2 绘制与擦除地形 — Playwright
- [ ] F3 放置、移动、删除城市、出生点、桥梁 — Playwright
- [ ] F4 设置城市初始阵营 — Playwright
- [ ] F5 校验基本可玩条件（双方出生点与城市）— Vitest
- [ ] F6 localStorage 保存与载入 — Playwright
- [ ] F7 文件 API 导入、导出 — Playwright
- [ ] F8 从编辑器一键测试地图并安全返回 — Playwright
- [ ] F9 编辑器与运行时共享同一地图模型 — 评审
- [x] F10 地图为版本化 JSON，读取时结构校验并具备迁移机制 — Vitest

## G. 数据、表现与性能

- [x] G1 固定时间步长模拟与帧率无关（同输入下结果确定）— Vitest
- [x] G2 无全单位两两检测（空间分区邻居查询）— 评审 + Vitest
- [ ] G3 约 500 活动单位下保持 60 FPS 的可测量基线（tick ≤ 8 ms，渲染 ≤ 8 ms）— 手动三浏览器 + 基准页
- [ ] G4 支持最新版 Chrome、Firefox、Edge — Playwright 三工程
- [ ] G5 1280×720 至 1920×1080 布局正常 — Playwright + 手动
- [ ] G6 用户可见文本集中管理，中文优先并预留英文 — 评审
- [ ] G7 构建产物可静态部署（`npm run build` 后 `dist/` 独立可用）— 手动

## H. 工程规范

- [ ] H1 规则与数值全部配置化，无魔法数字 — 评审
- [ ] H2 模拟/渲染/输入/控制器分离，simulation 无 Phaser/DOM 依赖 — 评审
- [ ] H3 `npm test`、`npm run test:e2e`、`npm run build`、`git diff --check` 全部通过 — 每次提交前
- [ ] H4 视觉/交互改动经三浏览器两分辨率手动检查 — 提交前
- [ ] H5 全部数值（规则/交互/UI/教学/性能）唯一来源为 `src/config/values.js`，与 gdd.md §12 镜像表一致 — Vitest + 评审

## 完成定义

以上全部勾选，且 `REQUIREMENTS.md` §8 各事项在本仓库文档中标注为「已确认」或「暂定」（无「待决定」遗留），MVP 即达成。
