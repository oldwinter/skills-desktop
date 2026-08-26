# 参考资料
活跃贡献者：oldwinter、chendongdong

## 用途

本章节汇总维护和排障时最常查阅的稳定事实：仓库配置、跨边界数据模型与直接依赖。
功能行为仍以源码和已接受 ADR 为准；V1 的公开承诺是 **Local-only**，不能因为
SSH、Wire 或 Remote Bootstrap 代码仍在树中，就把它们描述为已发布能力。

## 页面导航

| 页面 | 内容 |
| --- | --- |
| [配置](configuration.md) | npm scripts、环境变量、Vite/TypeScript/Vitest、lint、Forge、CI 与更新策略 |
| [数据模型](data-models.md) | Target、Inventory、Mutation、Review、Collection、Recovery 与三套协议 |
| [依赖](dependencies.md) | 四个 workspace manifest 的直接依赖、固定版本、根 overrides 与 lockfile |
| [维护者](../maintainers.md) | CODEOWNERS 所有权与 `origin/main` 的分区贡献活动 |

## 阅读顺序

1. 修改构建、测试、打包或 CI 前先读[配置](configuration.md)。
2. 修改 renderer contract、CLI parser 或持久化 schema 前先读
   [数据模型](data-models.md)。
3. 升级包前同时检查[依赖](dependencies.md)与
   `package-lock.json`，不要只改一个 workspace manifest。
4. 需要评审人时查阅[维护者](../maintainers.md)，不要从提交数量推断所有权。

## 权威入口

- `CONTEXT.md`：产品术语和非协商边界。
- `package.json`：根 scripts、Node engine、overrides。
- `apps/desktop/src/contracts/`：renderer 可见协议。
- `packages/skills-runtime/src/`：固定 Skills 方言、Inventory、
  Mutation Intent、Harness Registry 与 Wire codec。
- `apps/desktop/src/main/persistence/recovery-records.ts`：
  durable records、迁移与 schema version。
- `.github/workflows/`：CI 与 unsigned candidate 实际门禁。

架构入口见[系统架构](../overview/architecture.md)。
