# 参与贡献

## 开始开发

项目使用 Node.js 22.12 或更高版本、npm、Vite 和原生 JavaScript。首次开发前运行：

```sh
nvm use
npm install
npm run dev
```

不要提交 `node_modules/`、构建产物、测试报告、日志或本地环境文件。依赖变更必须同时提交 `package.json` 与安装后生成的 `package-lock.json`。

## 分支与提交

从最新主分支创建短期功能分支，建议命名为 `feat/map-editor`、`fix/unit-selection` 或 `docs/architecture`。提交应保持单一目的，并使用简短的 Conventional Commit 风格主题，例如：

```text
feat: add city capture progress
fix: keep simulation independent of frame rate
docs: clarify morale assumptions
```

不要把尚未确认的设计建议作为既定规则实现。需求变化应先更新相关文档，并标明“已确认”“暂定”或“待决定”。

## 提交前检查

```sh
npm test
npm run test:e2e
npm run build
git diff --check
```

涉及 UI、动画或交互时，还应在最新版 Chrome、Firefox 和 Edge 中手动检查，并覆盖 1280×720 与 1920×1080。

## Pull Request

PR 描述应说明目的、主要变更、验证步骤和已知限制，并关联对应任务或 Issue。视觉或交互改动应附截图或短视频；规则改动应说明配置变化并补充测试。至少由一名其他成员审查后再合并，避免在同一 PR 中夹带无关重构。
