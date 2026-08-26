# Skills Desktop

Skills Desktop 是一个跨平台 Electron 桌面客户端，用于查看、比较和变更开发者机器上的 Agent Skills。应用把实际的发现与变更委托给固定版本的 `npx skills`，自身负责目标建模、证据归一化、变更计划、可信确认、恢复记录和桌面交互，产品入口见 `apps/desktop/src/main/index.ts`。

## 当前产品边界

当前公开承诺是 **Local-only V1**。本地 Inventory、允许列表化的陈旧快照恢复、变更计划和确认属于已交付路径；SSH Target、远端 Bootstrap 和跨机器协调虽然已有架构与实验实现，但仍是后续范围，不能据此宣称远端能力已经发布。边界由 `README.md`、`SECURITY.md` 和 `AGENTS.md` 共同约束。

应用当前提供五个工作区视图：

| 视图 | 用途 | 主要实现 |
| --- | --- | --- |
| Inventory | 查看 project 与 global 技能清单，搜索、筛选并准备变更 | `apps/desktop/src/renderer/features/inventory/InventoryApp.tsx` |
| Comparison | 对齐两个 Target 的技能证据并显示多维差异 | `apps/desktop/src/renderer/features/comparison/ComparisonView.tsx` |
| Collections | 评估官方合集并生成受审阅的应用计划 | `apps/desktop/src/renderer/features/collections/CollectionsView.tsx` |
| Targets | 创建、编辑、切换和删除 Target | `apps/desktop/src/renderer/features/targets/TargetsView.tsx` |
| About | 显示版本、更新策略和诊断导出入口 | `apps/desktop/src/renderer/features/about/AboutView.tsx` |

## 仓库结构

生产代码位于三个私有 npm workspace：

```text
apps/desktop/                  Electron 主进程、preload、普通渲染器与审阅渲染器
packages/skills-runtime/       固定 CLI 方言、Inventory、Mutation 与 Wire 协议
packages/remote-bootstrap/     后续 SSH 路径使用的固定远端 Node 程序
```

`prototype/` 是交互证据，不是生产依赖；`scripts/release/` 和 `.github/workflows/` 组成未签名候选构建与验证流水线。详细依赖方向见[系统架构](architecture.md)，本地构建步骤见[开始开发](getting-started.md)。

## 从哪里开始阅读

- 先读[系统架构](architecture.md)，了解 Electron 角色隔离、主进程状态所有权和外部边界。
- 需要改功能时，从[贡献指南](../how-to-contribute/index.md)和[模式与约定](../how-to-contribute/patterns-and-conventions.md)开始。
- 需要理解 Target、Fresh Inventory、Prepared Mutation 等术语时，查阅[术语表](glossary.md)。
- 需要确认当前用户可见行为时，以 `docs/user-guide.md` 为准，而不是把 `docs/adr/` 中的目标架构当作已交付能力。
