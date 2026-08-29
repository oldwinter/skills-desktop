# 调试

调试时先判断失败发生在 parser、应用状态、IPC、持久化还是打包壳，再缩小到一个可重复的测试。项目没有可依赖的统一应用日志系统；优先使用公开的结构化错误、测试失败、受控 fixture 和 QA 收据，不要假设存在某个日志目录，也不要把原始 CLI/SSH 输出粘贴到 Issue。系统边界总览见[模式与约定](patterns-and-conventions.md)。

## 通用顺序

1. 记录目标、workspace、Harness、scope、Inventory freshness 和刚执行的用户操作。
2. 用最窄的同层测试复现，不先运行最慢的打包矩阵。
3. 确认输入在进入边界时的规范形式，以及公开结果中的 `code`、`phase`、`effects`、`retryable` 等字段。
4. 只在 Unit/Contract 通过后升级到真实 CLI、打包 Electron 或 UI QA。
5. 修复根因并补回归测试，不通过放宽 schema、跳过确认、禁用 sandbox 或清空恢复数据来制造“通过”。

## Inventory 无法刷新或内容异常

排查入口：

- `apps/desktop/src/main/adapters/local-skills-process.ts`：`--version`、project/global argv、受限环境、进程超时与 postflight；
- `packages/skills-runtime/src/inventory.ts`：CLI 版本常量、有界 JSON parser 与规范 Inventory entry；
- `apps/desktop/src/main/application/desktop-capabilities.ts`：刷新操作、Fresh/none/stale 投影和 Target 绑定；
- `apps/desktop/src/renderer/features/inventory/InventoryApp.tsx`：公开 Snapshot 的筛选、状态与重取逻辑。

先确认 project 与 global 两次观察都成功；Local adapter 只在两者均通过 parser 后发布一个完整 Inventory，不应出现“半份成功”。建议依次运行：

```bash
npm test -- packages/skills-runtime/src/inventory.test.ts
npm test -- apps/desktop/src/main/adapters/local-skills-process.test.ts
npm test -- apps/desktop/src/renderer/features/inventory/InventoryApp.test.tsx
npm run smoke:cli
```

只有前三层通过、且问题确实依赖真实固定 CLI 时才运行最后一项。不要直接扫描 `.agents/skills` 来“核对真相”，这会绕过产品的 CLI 权威。

## stale 一直不消失

恢复出的 Snapshot 被标记为 stale 是预期行为，不是单独的持久化故障。检查：

1. 最近一次 fresh observation 是否完整成功；失败只会把已有证据保持/降为 stale。
2. TargetId 与 Generation 是否仍匹配当前 Target Definition。
3. 是否存在 surviving Mutation Guard，使 Target 进入 `reconciliation-required`。
4. Inventory Snapshot 的持久化是否成功，Guard 是否在 postflight Inventory durable 后才清除。

主要入口是 `apps/desktop/src/main/application/desktop-capabilities.ts` 与 `apps/desktop/src/main/persistence/recovery-records.ts`，聚焦测试为：

```bash
npm test -- apps/desktop/src/main/application/desktop-capabilities.test.ts
npm test -- apps/desktop/src/main/persistence/recovery-records.test.ts
```

不要手工把恢复文件中的 `freshness` 改为 fresh，也不要直接删除 Guard。恢复语义和各 store 的 fail-closed 规则见[恢复与持久化](../systems/recovery-and-persistence.md)。

## CLI incompatibility

固定方言要求 `skills@1.5.23` 的版本输出与 parser 契约精确匹配。若真实 smoke 或应用报告不兼容：

1. 在同一 Node/npm 环境运行 `npm run smoke:cli`，区分 CLI 获取/启动失败与 parser 失败。
2. 检查 `packages/skills-runtime/src/inventory.ts` 中的固定版本和 fixtures。
3. 检查 `apps/desktop/src/main/adapters/local-skills-process.ts` 的 executable 解析、环境 allowlist、参数数组和输出边界。
4. 若上游确实改变语法，把它作为新的 reviewed Skills Dialect：先更新常量、fixture 与 parser，再更新 argv 和边界测试。

不要改成宽松版本探测、吞掉未知字段、执行 shell fallback，或把 raw stdout/stderr 送给 renderer。详细约束见[本地 CLI 边界](../systems/local-cli-boundary.md)。

## IPC 请求被拒绝或 renderer 不更新

按请求流逐层检查：

- `apps/desktop/src/contracts/workspace.ts`、`apps/desktop/src/contracts/review.ts`、`apps/desktop/src/contracts/about.ts`：请求、结果和 Snapshot schema；
- `apps/desktop/src/preload/workspace.ts` 与 `apps/desktop/src/preload/review.ts`：固定 bridge 方法；
- `apps/desktop/src/main/adapters/electron-ipc.ts`：channel、WebContents、主 frame、role、URL 与 `attachmentEpoch`；
- `apps/desktop/src/main/application/desktop-capabilities.ts`：session、授权、`sequence` 与 `stateRevision`。

旧 document、subframe、错误角色、导航后的 URL 或 stale epoch 被拒绝是正确结果。事件出现序列缺口或待发送事件被覆盖时，renderer 应处理 `resync.required` 并重新取得完整 Snapshot，而不是自行修补主进程状态。

```bash
npm test -- apps/desktop/src/contracts/workspace.test.ts
npm test -- apps/desktop/src/preload/workspace.test.ts
npm test -- apps/desktop/src/main/adapters/electron-ipc.test.ts
```

协议与窗口隔离细节见[IPC 与渲染器隔离](../systems/ipc-and-renderer-isolation.md)。

## persistence 恢复、迁移或写入失败

先确认失败属于哪个独立 store，而不是把所有恢复状态视为一个 JSON：

- Inventory Snapshot；
- Mutation Guard；
- Target Definition；
- OpenSSH 公共 host trust；
- Collection acknowledgement；
- 独立的 update-check 或 deferred-update 记录。

`apps/desktop/src/main/persistence/recovery-records.ts` 负责 schema、相邻版本迁移、backup、quarantine、failure marker、临时文件写入、flush 与 atomic replace；`apps/desktop/src/main/composition-root.ts` 只负责在 Electron user data 下组装生产实例。使用测试 fixture 复现 corrupt JSON、新版 schema、写入中断或迁移失败：

```bash
npm test -- apps/desktop/src/main/persistence/recovery-records.test.ts
npm test -- apps/desktop/src/main/composition-root.test.ts
```

不要假设所有平台的 user data 在同一绝对目录，不要直接编辑、覆盖新版记录或清空目录。修复应表现为具名 `DurableChange`、确定性迁移或保守拒绝，而不是通用 `set`/`clear`。

## packaged smoke 或 UI QA 失败

先区分阶段：

1. `npm run build`：TypeScript/Vite bundle；
2. `npm run package:linux`：Electron Forge package；
3. `npm run smoke:packaged`：打包壳、preload/IPC、隔离 CLI 与恢复主路径；
4. `npm run qa:packaged-ui:linux`：CDP 驱动的 UI/UX 契约。

UI QA 可先打印其实际使用方式，不启动应用：

```bash
node tests/packaged-ui-qa/run.mjs --help
```

本地 UI QA 的原始 Electron 输出、截图和视频只存在于一次性 fixture；CI 失败上传的是 allowlisted `failure.json`，可用其中的 stage、check、diagnostic code 判断是 launch、keyboard、focus、axe、layout、state、console 还是 cleanup。不要把这些生成物提交到仓库。

Ubuntu 24.04 的 Chromium sandbox 可能需要与 `.github/workflows/verify.yml`、`.github/workflows/packaged-ui-qa.yml` 相同的 executable-scoped AppArmor `userns` 配置。不要加 `--no-sandbox`。跨平台只出现的失败应由对应 hosted matrix 复现，不要拿 Linux package 推断 macOS/Windows 已通过。

若需要提交调试证据，只记录最小复现、公开结构化错误、平台/架构、执行命令与脱敏后的结果。安全披露与敏感信息规则见[安全](../security.md)。
