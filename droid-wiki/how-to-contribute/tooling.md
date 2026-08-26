# 工具链

仓库使用 npm workspaces、TypeScript、ESLint、Vitest、Vite 与 Electron Forge。质量门禁由根 `package.json` 统一编排；不要把未进入门禁的辅助工具误写成自动格式化或发布授权。测试层次见[测试](testing.md)。

## 运行环境与 workspace

- 根 `package.json` 要求 Node.js 22.20.0 或更高版本；GitHub Actions 使用 Node.js 24。
- 根 `package-lock.json` 锁定依赖；本地初次安装可用 `npm install`，CI 和可复现检查使用 `npm ci`。
- 生产 workspace 是 `apps/desktop`、`packages/skills-runtime` 与 `packages/remote-bootstrap`。后者保留给 gated SSH 工作，不是当前 V1 公开能力。
- `apps/desktop/package.json` 定义 Electron 应用的 Vite build 与 Forge package；`prototype/package.json` 属于独立证据应用，不进入生产 workspace。

## 根脚本

| 命令 | 配置或入口 | 用途 |
| --- | --- | --- |
| `npm run typecheck` | `tsconfig.json` 与各 workspace `tsconfig*.json` | TypeScript project references |
| `npm run lint` | `eslint.config.js` | 对 JS、TS、TSX 运行 ESLint，零 warning |
| `npm run check:imports` | `scripts/check-imports.mjs` | 强制 runtime、bootstrap、contracts、preload 与 renderer 的导入方向 |
| `npm test` | `vitest.config.ts` | 默认 Unit 与 Contract |
| `npm run test:coverage` | `vitest.config.ts` | V8 coverage 与四项 80% 全局阈值 |
| `npm run build` | 根 `package.json`、workspace scripts | 构建所有存在 build script 的 workspace |
| `npm run verify` | 根 `package.json` | typecheck → lint → imports → coverage → build |
| `npm run smoke:cli` | `vitest.smoke.config.ts` | 隔离的真实固定 CLI smoke |
| `npm run smoke:ssh` | `vitest.ssh-smoke.config.ts` | 实验性的 localhost OpenSSH smoke |
| `npm run smoke:packaged` | `tests/packaged-electron.smoke.mjs` | Linux 打包 Electron smoke |
| `npm run qa:packaged-ui:linux` | `tests/packaged-ui-qa/run.mjs` | Linux package 与 headless UI QA |

修改行为后的标准本地门禁是：

```bash
npm run verify
```

## ESLint 与 Biome

`eslint.config.js` 是 `npm run lint` 和 `verify` 使用的 lint 配置。它覆盖 JS、MJS、CJS、TS 和 TSX，启用基础 recommended、React 与 React Hooks 规则，并把 `eqeqeq`、`no-debugger`、重复导入、未使用变量、JSX key 和 Hooks 依赖等作为 error。`dist`、`out`、`node_modules`、`coverage` 与 `release-candidates` 被忽略。

`biome.json` 只检查 `apps/desktop/src/**`，关闭 formatter 和 organize imports，仅把未使用变量、未使用导入与 debugger 作为 warning。辅助命令是：

```bash
npm run lint:biome
```

它不属于 `npm run verify`，也不是自动格式化命令。仓库当前没有由 Biome 承担的 formatter；编辑时应遵循相邻源码风格，并以 ESLint、TypeScript 和测试为准。

## 导入边界检查

`scripts/check-imports.mjs` 使用 Babel parser 遍历以下生产源码根：

- `apps/desktop/src`；
- `packages/skills-runtime/src`；
- `packages/remote-bootstrap/src`。

它强制：

- `packages/skills-runtime` 不依赖 Node 或 Electron primitive；
- `packages/remote-bootstrap` 除相对模块外只依赖 `@skills-desktop/skills-runtime`；
- `apps/desktop/src/contracts` 保持 runtime-neutral；
- renderer 与 review-renderer 不导入 Node、Electron、main、preload 或 skills-runtime；
- preload 只依赖 Electron 与 `apps/desktop/src/contracts`。

任何新边界都应设计成具名深接口，而不是简单修改脚本 allowlist。规则与图示见[模式与约定](patterns-and-conventions.md)。

## Vitest

- `vitest.config.ts`：默认 Unit/Contract、fork pool、V8 coverage 和 80% thresholds；排除真实 CLI 与 localhost SSH smoke。
- `vitest.smoke.config.ts`：仅 `tests/real-cli.smoke.test.ts`，120 秒超时。
- `vitest.ssh-smoke.config.ts`：仅 `tests/localhost-ssh.smoke.test.ts`，120 秒超时。

聚焦测试可把仓库根完整路径传给 Vitest，例如：

```bash
npm test -- apps/desktop/src/main/adapters/electron-ipc.test.ts
```

不要用 `.only`、跳过断言或降低覆盖率阈值修复失败。

## Vite、Electron Forge 与平台前置条件

`apps/desktop/package.json` 的 build 依次使用：

- `apps/desktop/vite.main.config.ts`；
- `apps/desktop/vite.preload.config.ts`；
- `apps/desktop/vite.review-preload.config.ts`；
- `apps/desktop/vite.renderer.config.ts`；
- `apps/desktop/vite.review-renderer.config.ts`。

Electron Forge 配置位于 `apps/desktop/forge.config.ts`。Linux 本地 package：

```bash
npm run package:linux
```

Linux 候选制作还需要 `fakeroot` 与 `rpmbuild`；headless Electron 运行通常需要 Xvfb。包必须在目标操作系统上生成，不能用一个平台的本地结果代替跨平台矩阵。

## GitHub Actions 门禁

- `.github/workflows/verify.yml`：PR 与 `main` push 的基础门禁。Linux 跑 `npm run verify` 和打包 smoke；macOS/Windows 跑 typecheck、导入检查与默认测试。真实 CLI smoke 只在 `main` push 执行。
- `.github/workflows/packaged-ui-qa.yml`：在 Linux x64、macOS arm64/x64、Windows x64 上运行隔离的打包 UI QA。
- `.github/workflows/release-candidates.yml`：构建各平台 unsigned candidates，并在 tag 或受控手动流程中复用 verify/UI QA、生成 checksum、SPDX SBOM、attestation，重验精确 bytes 后才发布非 latest prerelease。

这些 workflow 中的 GitHub Actions 固定到完整 commit SHA，checkout 不保留凭据。不要把 CI 有写权限的发布 job 复制到普通验证 job，也不要把 unsigned developer preview 描述为签名 Stable Release。

候选构建、tag 与发布边界见[部署](../deployment.md)，renderer 和进程权限工具边界见[安全](../security.md)。
