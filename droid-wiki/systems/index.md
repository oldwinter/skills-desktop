# 内部系统
活跃贡献者：oldwinter、chendongdong

## 目的

本目录说明 Skills Desktop 在 Electron 主进程内拥有权限的系统边界，以及它们如何把 UI 请求连接到 Target、`npx skills`、恢复记录和更新运行时。整体架构先读[系统架构](../overview/architecture.md)；应用级状态机与授权集中在 [Desktop Capabilities](desktop-capabilities/index.md)，本目录其余页面只展开各自的边界，不重复功能页。

V1 的公开承诺是 **Local-only**。SSH、OpenSSH、Wire 和 Remote Bootstrap 虽有架构与实验代码，但不得据此宣称远端能力已经发布。

## 目录布局

| 区域 | 仓库根路径 | 责任 |
| --- | --- | --- |
| 公共协议 | `apps/desktop/src/contracts/` | Workspace、Review、About 的严格 Zod schema 与 renderer bridge 类型 |
| Electron 边界 | `apps/desktop/src/preload/`、`apps/desktop/src/main/adapters/electron-*.ts` | 受限 preload、发送者授权、窗口安全、更新适配 |
| 应用编排 | `apps/desktop/src/main/application/` | 主进程状态、审阅、恢复协调和更新状态机 |
| Target 与进程 | `apps/desktop/src/main/targets/`、`apps/desktop/src/main/adapters/*skills-process.ts` | Target Definition、冻结绑定、Local/SSH `SkillsProcess` |
| 持久化 | `apps/desktop/src/main/persistence/` | 封闭恢复记录与更新记录 |
| 环境中立运行时 | `packages/skills-runtime/src/` | 固定 CLI 方言、Harness Registry、Inventory 解析和 Wire codec |
| 远端实验 | `apps/desktop/src/main/ssh/`、`packages/remote-bootstrap/` | OpenSSH 主机信任与固定 Remote Bootstrap |

## 关键抽象

| 抽象 | 权限与职责 |
| --- | --- |
| `DesktopCapabilities` | 主进程唯一应用编排器；拥有状态、授权、审阅、执行顺序和事件 |
| `SkillsTargets` | 管理稳定 `TargetId`、Definition、Generation，并打开冻结的 Target Session |
| `SkillsProcess` | 只暴露 `observeInventory`、`prepareMutation`、`executeConfirmed` |
| `RecoveryRecords` | 只暴露 `restore()` 与 `commit(DurableChange)` |
| Workspace/Review Protocol v2 | 普通渲染器与可信审阅渲染器的两个封闭协议 |
| `UpdateCoordinator` | 唯一调用 Electron `autoUpdater` 的主进程组件 |

## 工作方式

```mermaid
flowchart LR
    UI[普通渲染器] --> Preload[Workspace preload]
    Review[可信审阅渲染器] --> ReviewPreload[Review preload]
    Preload --> IPC[Electron IPC]
    ReviewPreload --> IPC
    IPC --> Cap[DesktopCapabilities]
    Cap --> Targets[SkillsTargets]
    Targets --> Local[Local SkillsProcess]
    Cap --> Records[RecoveryRecords]
    Local --> CLI[skills@1.5.23]
    Cap --> Updates[UpdateCoordinator]
```

普通渲染器只有请求和投影；主进程验证当前角色与状态后才调用深接口。Local CLI 是 V1 的执行边界。任何恢复快照都以 stale 状态返回，任何变更都必须重新取得 Fresh Inventory 并经过可信审阅。详见 [IPC 与渲染器隔离](ipc-and-renderer-isolation.md)、[本地 CLI 边界](local-cli-boundary.md)与[恢复与持久化](recovery-and-persistence.md)。

## 集成点

- Inventory 与变更功能通过 `DesktopCapabilities → SkillsTargets → SkillsProcess` 集成，功能语义见[库存](../features/inventory.md)与[变更和可信审阅](../features/mutations-and-trusted-review.md)。
- Target Definition 通过 `RecoveryRecords` 持久化，但 Target 执行绑定由每次 `open(TargetId)` 建立。
- About 页面通过独立的 About IPC 合约读取 `UpdateCoordinator` 投影。
- 远端代码只作为后续范围存在；准确状态见[远端传输实验](remote-transport-experimental.md)。

## 修改入口

1. 新增 renderer 能力时，先扩展严格 contract，再同步 preload、IPC 角色授权与 `DesktopCapabilities` 请求处理；不要增加通用 IPC。
2. 修改 CLI 行为时，从 `packages/skills-runtime/src/` 的固定方言与 schema 开始，再改 Local adapter 和契约测试。
3. 修改持久化含义时，只扩展 `DurableChange` 与相邻版本迁移，不向调用方暴露文件或 JSON repository。
4. 修改发布能力声明时，以 `apps/desktop/src/main/composition-root.ts` 的实际组合和已通过的 tracer 为准，不以在树代码或 ADR 目的地代替发布证据。

## Key source files

- `apps/desktop/src/main/composition-root.ts`
- `apps/desktop/src/main/application/desktop-capabilities.ts`
- `apps/desktop/src/contracts/workspace.ts`
- `apps/desktop/src/contracts/review.ts`
- `apps/desktop/src/main/targets/skills-targets.ts`
- `apps/desktop/src/main/adapters/skills-process.ts`
- `apps/desktop/src/main/persistence/recovery-records.ts`
- `docs/adr/0010-center-production-on-desktop-capabilities.md`
