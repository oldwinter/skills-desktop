# 术语表

这些术语来自 `CONTEXT.md`、公共契约和运行时类型。中文说明用于阅读代码，标识符、协议值、Harness ID 和证据值在实现中不会被翻译。

| 术语 | 含义 | 代码入口 |
| --- | --- | --- |
| Skills Dialect | 对固定 `skills@1.5.23` 命令、解析器和证据语法的审阅合同 | `packages/skills-runtime/src/inventory.ts` |
| Harness | 一个精确的规范 CLI 集成，由 `HarnessId` 标识 | `packages/skills-runtime/src/harness-registry.ts` |
| Harness Compatibility Registry | 与固定方言绑定的 Harness 集合、范围支持和共享效果映射 | `packages/skills-runtime/src/harness-registry.ts` |
| Target | 一台机器、一个规范 workspace 和一组 Harness 的应用内稳定身份 | `apps/desktop/src/main/targets/skills-targets.ts` |
| Target Generation | 会影响 Target 执行的定义或绑定发生变化时递增的代次 | `apps/desktop/src/main/targets/local-skills-targets.ts` |
| Effective Target Binding | 打开 Target 时冻结的执行事实；Local 包含 workspace 与 Harness，SSH 还包含解析后的 OpenSSH 绑定 | `apps/desktop/src/main/targets/skills-targets.ts` |
| Skills Process | Local 与 SSH 共享的 `observeInventory`、`prepareMutation`、`executeConfirmed` 接口 | `apps/desktop/src/main/adapters/skills-process.ts` |
| Inventory | 通过固定 CLI 完成的一次 project 与 global 归一化观察 | `packages/skills-runtime/src/inventory.ts` |
| Fresh Inventory | 当前会话、当前 Target Generation 的最新完整观察，是准备变更的必要条件 | `apps/desktop/src/main/application/desktop-capabilities.ts` |
| Stale Inventory | 刷新失败、Target 改变或重启恢复后的最后完整证据，可查看但不能授权变更 | `apps/desktop/src/main/persistence/recovery-records.ts` |
| Unknown Evidence | 权威接口没有提供 revision 或 fingerprint；未知不代表相等或漂移 | `packages/skills-runtime/src/inventory.ts` |
| Declared Source | CLI 报告的精确 `(sourceType, source)`，不做别名重写 | `packages/skills-runtime/src/inventory.ts` |
| Comparison Key | 仅用于在两个 Inventory 中按区分大小写名称对齐条目的键，不等同于完整 Skill Identity | `apps/desktop/src/main/application/comparison.ts` |
| Mutation Intent | 只包含 add/remove/update、精确名称、范围与受限源的结构化请求 | `packages/skills-runtime/src/mutation.ts` |
| Prepared Mutation | 绑定 Target、Generation、Fresh Inventory、摘要与过期时间的待审阅计划 | `apps/desktop/src/main/adapters/skills-process.ts` |
| Command Plan | Prepared Mutation 的可读投影；其中的 preview 不是可执行输入 | `apps/desktop/src/main/adapters/skills-process.ts` |
| Trusted Review | 主进程拥有、独立渲染窗口显示、只能单次批准或拒绝的审阅机会 | `apps/desktop/src/contracts/review.ts` |
| Mutation Guard | 变更开始前写入的持久安全标记，用于重启和不确定结果恢复 | `apps/desktop/src/main/persistence/recovery-records.ts` |
| Reconciliation Required | 无法证明变更终态时的阻塞状态，必须等待截止时间并显式建立 Fresh Inventory | `apps/desktop/src/main/application/desktop-capabilities.ts` |
| Official Collection | 随应用分发、带固定源和独立审阅收据的技能菜谱，不是安装状态 | `apps/desktop/src/main/application/official-collections.ts` |
| Workspace Protocol v2 | 普通渲染器、preload 与主进程之间的封闭请求、结果、事件和 Snapshot 协议 | `apps/desktop/src/contracts/workspace.ts` |
| Review Protocol v2 | 独立审阅窗口使用的投影与 approve/reject 协议 | `apps/desktop/src/contracts/review.ts` |
| Remote Bootstrap | SSH 操作中运行的构建时固定 Node 程序，目前属于后续范围 | `packages/remote-bootstrap/src/index.ts` |
| Wire Protocol | SSH transport 与 Remote Bootstrap 之间的有界长度前缀结构化帧 | `packages/skills-runtime/src/wire.ts` |
| Unsigned Developer Preview | 有校验和、SBOM 与 attestation 的公开预发布字节，不是签名稳定版 | `docs/unsigned-developer-preview.md` |

术语之间的数据流可回到[系统架构](architecture.md)查看；持久格式和公共投影见[数据模型](../reference/data-models.md)。
