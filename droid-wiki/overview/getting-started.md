# 开始开发

本页说明如何在本地安装依赖、运行质量门禁、构建 Electron 应用和执行隔离 smoke。命令来源于根目录 `package.json`、`README.md` 和 `CONTRIBUTING.md`。

## 前置条件

- Node.js 22.20 或更高版本。CI 在 `.github/workflows/verify.yml` 中使用 Node.js 24。
- npm，仓库使用根 `package-lock.json` 管理三个 workspace。
- Linux 打包候选还需要 `fakeroot` 与 `rpmbuild`；打包 Electron smoke 通常需要 Xvfb。
- 真实 CLI smoke 会运行固定的 `skills@1.5.23`，但使用隔离 HOME、workspace 和 npm cache。

## 安装

在仓库根目录运行：

```bash
npm install
```

CI 使用可复现安装：

```bash
npm ci
```

## 常用开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run typecheck` | 运行 TypeScript project references 检查 |
| `npm run lint` | 使用 ESLint 检查 JS、TS 和 React 代码 |
| `npm run check:imports` | 验证 renderer、preload、runtime 和 bootstrap 的依赖边界 |
| `npm test` | 运行 Vitest 单元与契约测试 |
| `npm run test:coverage` | 运行 V8 coverage，并执行 80% 全局阈值 |
| `npm run build` | 构建所有 workspace |
| `npm run verify` | 依次执行 typecheck、lint、import 检查、coverage 和 build |

行为变更完成前应运行：

```bash
npm run verify
```

## Smoke 与打包

```bash
npm run smoke:cli
npm run package:linux
xvfb-run -a npm run smoke:packaged
```

`tests/real-cli.smoke.test.ts` 验证真实固定 CLI 的只读边界。`tests/packaged-electron.smoke.mjs` 使用临时配置和伪 CLI 边界测试完整观察、脱敏、重启与 stale 恢复，不读取开发者真实 Inventory。独立的 SSH smoke 使用 `vitest.ssh-smoke.config.ts`，但它证明的是后续架构的 localhost tracer，不代表 SSH 已进入 V1。

## 运行原型

只有在研究交互证据时才运行原型：

```bash
cd prototype
npm install
npm run prototype:electron
```

`prototype/` 不属于生产 workspace，不能把其中的样例数据、命令预览拼接或单体 UI 直接复制到生产代码。背景见[原型与产品演进](../background/prototype-and-evolution.md)。

## 修改前检查

1. 阅读 `AGENTS.md`、`README.md`、`CONTEXT.md` 和相关 `docs/adr/*.md`。
2. 确认改动没有把 SSH 或跨机器行为写成当前 V1 承诺。
3. 保持 `npx skills` 为发现和变更的权威，不自行扫描技能目录。
4. 新增边界行为时，优先补充解析、IPC、持久化、差异语义或确认流程的测试。

更多测试分层与排错命令见[测试](../how-to-contribute/testing.md)和[调试](../how-to-contribute/debugging.md)。
