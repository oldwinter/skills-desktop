# 维护者

## 所有权来源

官方代码所有权以
[`.github/CODEOWNERS`](../.github/CODEOWNERS) 为准。
当前默认规则 `* @oldwinter` 覆盖整个仓库，并对 `/.github/`、
`/apps/desktop/src/main/`、`/packages/` 和 `/docs/` 再次指定
`@oldwinter`。未列出额外 owner 的目录仍继承默认规则。

“近期贡献者”和“最后活动”来自本地 `origin/main` 的 path-scoped `git log`，
采集到 2026-08-24；只保留人类作者 oldwinter、chendongdong，并排除
`dependabot[bot]`。这张表用于定位评审上下文，不是贡献排行榜，也不改变
CODEOWNERS。

## 维护分区

| 分区 | 完整代码路径 | 官方 owner | `origin/main` 近期人类贡献者 | 最后人类活动 |
| --- | --- | --- | --- | --- |
| Desktop main | `apps/desktop/src/main/` | `@oldwinter` | oldwinter、chendongdong | 2026-08-24 |
| Renderer | `apps/desktop/src/renderer/`；`apps/desktop/src/review-renderer/`；`apps/desktop/src/preload/`；`apps/desktop/src/contracts/` | `@oldwinter`（默认规则） | oldwinter、chendongdong | 2026-08-24 |
| skills-runtime | `packages/skills-runtime/` | `@oldwinter` | oldwinter、chendongdong | 2026-08-24 |
| remote-bootstrap | `packages/remote-bootstrap/` | `@oldwinter` | oldwinter、chendongdong | 2026-08-24 |
| Release tooling | `scripts/release/`；`.github/workflows/`；`apps/desktop/forge.config.ts` | `@oldwinter` | oldwinter、chendongdong | 2026-08-24 |
| Docs | `docs/`；`droid-wiki/`；`README.md`；`CONTRIBUTING.md`；`SECURITY.md` | `@oldwinter` | oldwinter、chendongdong | 2026-08-24 |

## 评审路由

- 修改 Desktop main authority、IPC、persistence 或 update 行为时，请求
  `@oldwinter` 评审，并同时运行对应 contract tests。
- renderer 变更若修改公共形状，必须连同
  `apps/desktop/src/contracts/`、preload 与 IPC 一起评审。
- `skills-runtime` 或 `remote-bootstrap` 的协议改动必须同步 consumer、fixture、
  digest 与 release build gates；SSH 仍不能扩大 Local-only V1 声明。
- release tooling 改动需要审阅固定 Actions、候选字节证据、unsigned-preview
  标签和凭据拒绝规则。
- 文档必须区分当前源码、已接受但未交付的 ADR 目标，以及 V1 公开范围。

提交和验证约定见[模式与约定](how-to-contribute/patterns-and-conventions.md)；
参考入口见[参考资料](reference/index.md)。
