# 测试

本仓库把测试证据分成默认 Vitest、边界契约、真实 CLI、localhost SSH、打包 Electron 与跨平台 UI QA。层次越靠后，越接近真实运行环境，但不能替代前一层的精确失败定位。开发命令总览见[开始开发](../overview/getting-started.md)。

## 测试分层

| 层次 | 主要入口 | 证明什么 | 是否属于默认测试 |
| --- | --- | --- | --- |
| Unit | `npm test` 或聚焦的 `npm test -- <路径>` | 纯函数、parser、领域状态、renderer 组件和 adapter 的局部行为 | 是 |
| Contract | `npm test`、`npm run check:imports` | 公共 schema、共享 adapter 约束、IPC sender/role、持久化迁移、导入方向、workflow 结构 | 是；导入检查由 `verify` 另跑 |
| Real CLI smoke | `npm run smoke:cli` | 生产 Local adapter 能调用真实固定 `skills@1.5.23` 完成隔离观察和固定来源安装 | 否 |
| Localhost SSH smoke | `npm run smoke:ssh` | POSIX 上系统 OpenSSH、host trust、wire framing、远端观察/变更与取消的后续架构 tracer | 否 |
| Packaged Electron smoke | `npm run smoke:packaged` | Linux 打包应用的 Local-only 主路径、隔离、脱敏、重启与 stale 恢复 | 否 |
| Packaged UI QA | `npm run qa:packaged-ui:linux` | 打包 UI 的键盘、焦点、axe、窄屏、减弱动态、空/错状态和 renderer console 契约 | harness contract 属于默认测试；真实应用运行不属于 |

## Unit 与 Contract

根配置 `vitest.config.ts` 收集 `**/*.test.ts`、`**/*.test.tsx` 和 `tests/packaged-ui-qa/**/*.test.mjs`，并排除 `prototype/`、构建输出以及两类独立 smoke。测试通常与实现同目录，使用 `*.test.ts` 或 `*.test.tsx`。

常用命令：

```bash
npm test
npm test -- apps/desktop/src/main/adapters/local-skills-process.test.ts
npm test -- apps/desktop/src/main/adapters/electron-ipc.test.ts
npm test -- apps/desktop/src/main/persistence/recovery-records.test.ts
npm test -- packages/skills-runtime/src/inventory.test.ts
```

Contract 不一定以目录名区分。典型入口包括：

- `apps/desktop/src/main/adapters/skills-process-observation.contract.test.ts`：不同进程 adapter 必须共享的观察语义；
- `apps/desktop/src/contracts/workspace.test.ts` 与 `apps/desktop/src/contracts/review.test.ts`：版本化 IPC schema；
- `apps/desktop/src/main/adapters/electron-ipc.test.ts`：sender、角色、attachment 和双向解析；
- `apps/desktop/src/main/persistence/recovery-records.test.ts`：schema、迁移、原子写与 fail-closed 恢复；
- `tests/check-imports.test.ts`：Windows 路径下也要成立的导入规则；
- `tests/verify-workflow.test.ts`、`tests/packaged-ui-qa.workflow.test.ts`：CI workflow 本身的安全与矩阵契约。

新增边界行为时，应先在对应 contract 中固定公共结果，再给实现补平台或 adapter 专属测试。

## 覆盖率与完整门禁

```bash
npm run test:coverage
npm run verify
```

`vitest.config.ts` 对 statements、branches、functions 和 lines 设置 80% 全局阈值。`npm run verify` 依次执行 typecheck、ESLint、导入边界、coverage 和全部 workspace build。行为变化不能只跑一个聚焦测试后就宣告完成。

## Real CLI smoke

`vitest.smoke.config.ts` 只运行 `tests/real-cli.smoke.test.ts`，超时为 120 秒：

```bash
npm run smoke:cli
```

它通过生产 `LocalSkillsProcess` 调用真实固定 CLI，并创建独立临时 HOME、workspace 与 npm cache。当前场景既包含空 Inventory 观察，也包含从精确 reviewed commit archive 安装到隔离 workspace；不会读取或修改开发者 Inventory。该测试可能需要 npm/网络可用，不属于 `npm test`。`.github/workflows/verify.yml` 只在推送到 `main` 时运行它，不在每个 PR job 中运行。

## Localhost SSH smoke

`vitest.ssh-smoke.config.ts` 只运行 `tests/localhost-ssh.smoke.test.ts`：

```bash
npm run smoke:ssh
```

该测试在 Windows 上跳过；POSIX 环境需要系统 `ssh`、`ssh-keygen` 和可执行的 `/usr/sbin/sshd`。它生成临时 host/client keys、临时配置、localhost daemon、伪 `npx` 与恢复目录，并覆盖首次信任、key rotation、Inventory、mutation、framing 和取消清理。

**SSH smoke 通过不代表 SSH 已进入 V1，也不是 SSH 交付验收。** V1 公开承诺仍为 Local-only；`.github/workflows/verify.yml` 还明确不安装或启动 sshd。这个 smoke 只是后续里程碑架构的本地 tracer 证据，不能用于放宽产品文档、UI 或发布范围。

## Packaged Electron smoke

```bash
npm run smoke:packaged
```

根脚本先执行 Linux package，再通过 Xvfb 运行 `tests/packaged-electron.smoke.mjs`。它使用临时 HOME、workspace、user data 和伪固定 CLI，覆盖真实打包壳、Fresh Inventory、变更审阅、脱敏、重启后的 stale 恢复、Local Target 与 V1 SSH 拒绝等边界，不读取开发者 Inventory。

在 Ubuntu 24.04 CI 中，`.github/workflows/verify.yml` 为 Chromium sandbox 临时加载“仅该可执行文件”的 AppArmor `userns` profile，并在退出时清理。不要用 `--no-sandbox` 绕过本机配置问题。

## Packaged UI QA

在 Linux 一次完成打包和 headless QA：

```bash
npm run qa:packaged-ui:linux
```

已有打包可执行文件且有桌面会话时，可运行：

```bash
npm run qa:packaged-ui
```

无桌面会话时：

```bash
xvfb-run -a npm run qa:packaged-ui
```

`tests/packaged-ui-qa/run.mjs` 创建一次性 HOME、配置、cache、temp、workspace、CDP session 和伪 `npx`。场景定义在 `tests/packaged-ui-qa/scenarios.mjs`，覆盖 keyboard workflow、focus order、axe semantics、narrow layout、reduced motion、empty/error state 和 console failures。`tests/packaged-ui-qa/harness.test.mjs` 只验证 harness，不启动 Electron。

`.github/workflows/packaged-ui-qa.yml` 在 hosted Linux x64、macOS arm64/x64 与 Windows x64 上运行真实打包 QA。失败时 CI 只上传 allowlisted 的 `failure.json`；原始异常文本、Electron 输出、截图与视频留在一次性 fixture。不要提交这些视觉或日志产物。

## 如何选择证据

- parser、diff、状态机或组件变化：聚焦 Unit，再跑默认测试与 `verify`。
- adapter、IPC、persistence 或权限变化：补 Contract，再跑 `verify`。
- 固定 CLI 方言、argv、环境或进程生命周期变化：在前两层通过后补跑 Real CLI smoke。
- Electron 安全、preload、恢复启动或完整变更路径：补跑 Packaged Electron smoke。
- 可访问性、焦点、响应式、review 窗口或视觉状态：补跑 Packaged UI QA。
- SSH/wire 实验：可补跑 Localhost SSH smoke，但必须继续标注“非 V1 交付”。

失败定位方法见[调试](debugging.md)，候选与发布门禁见[部署](../deployment.md)。
