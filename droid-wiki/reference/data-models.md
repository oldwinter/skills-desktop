# 数据模型
活跃贡献者：oldwinter、chendongdong

## 模型边界

Skills Desktop 把“展示数据”“执行授权”和“持久化安全证据”分开。普通 renderer
只接收严格公共投影；参数数组、Prepared/Confirmed authority、Mutation Guard 和
原始 CLI/SSH 数据留在主进程。整体状态所有权见
[系统架构](../overview/architecture.md)。

## Target Definition 与 Generation

Target 表示一台机器、一个规范 workspace 和一个非空规范 Harness 集合。稳定身份是
应用生成的 UUID `TargetId`；label、workspace、scope 和 SSH connection reference
都不是身份。

当前 durable Target Definition v4 的字段：

| 字段 | 约束与含义 |
| --- | --- |
| `id` | UUID，跨 definition 更新保持稳定 |
| `generation` | 正整数、单调推进；绑定所有会影响执行的变化 |
| `kind` | `local` 或 `ssh`；V1 只公开 Local |
| `label` | 非空展示名，最多 256 字符 |
| `workspace` | 规范执行路径，最多 4,096 字符 |
| `harnessIds` | 1–77 个精确 HarnessId，去重且按 Registry v1 顺序 |
| `connectionReference` | Local 必须为 `null`；SSH 为非秘密 OpenSSH alias |
| `dialectId` | 固定 `skills-1.5.23` |
| `registryVersion` / `registryDigest` | 固定兼容性 Registry 绑定 |
| `executionBindingDigest` | Local 为 `null`；SSH 可记录有效执行绑定摘要 |

公共 `TargetDefinition` 在 durable 形状上增加 `workspaceLabel`；创建/编辑使用的
`TargetDraft` 不允许 renderer 提供 id、generation、dialect 或 digest。内部
`EffectiveTargetBinding` 冻结 generation、Harness 集、kind、workspace 与可选 SSH
绑定，`TargetSession` 再把它与一个 `SkillsProcess` 关联。

Generation 绑定 definition、有效 transport/host trust、Skills Dialect、Harness
Registry、Wire 与 Remote Bootstrap 等执行事实。任一相关变化都使旧 Inventory
stale，并使依赖它的 Prepared Mutation 失效。

权威源码：

- `apps/desktop/src/contracts/workspace.ts`
- `apps/desktop/src/main/targets/skills-targets.ts`
- `apps/desktop/src/main/targets/local-skills-targets.ts`
- `packages/skills-runtime/src/harness-registry.ts`

## Inventory、Entry 与 Evidence

`Inventory` 是固定 `skills@1.5.23` 方言的一次完整 project + global 观察，不是
安装数据库。Inventory schema version 为 **1**：

| 层次 | 字段 |
| --- | --- |
| `Inventory` | `cliVersion`、`schemaVersion`、`observedAt`、`entries` |
| `NormalizedSkill` | `name`、`scope`、`agents`、`declaredSource`、`revision`、`contentFingerprint`、`path`、`sourceUrl`、`extensions` |
| `declaredSource` | 精确、区分大小写的 `sourceType` 与 `source`，均可为 `null` |
| `InventoryEvidence` | `{status:"unknown"}`，或带 `authority`、`kind`、`value` 的 `{status:"known"}` |

Skill Identity 是 case-sensitive name 加 declared source；path 只是证据。当前 CLI
没有权威 revision/fingerprint 时，两者保持 `unknown`。Parser 对 8 MiB output、
5,000 entries、字段长度、scope、重复/冲突身份和有界 additive extensions
fail closed。

公共 `PublicInventoryEntry` 故意删除 `path`、`sourceUrl` 和 `extensions`；
`PublicInventoryState` 添加 freshness（`fresh`/`stale`/`none`）、phase、
operation/error 与 persistence warning。只有当前会话、未变化 Target 的 Fresh
Inventory 能准备 mutation；Recovery Snapshot 恢复后总是 stale。

权威源码：

- `packages/skills-runtime/src/inventory.ts`
- `apps/desktop/src/contracts/workspace.ts`
- `apps/desktop/src/main/adapters/local-skills-process.ts`
- `apps/desktop/src/main/persistence/recovery-records.ts`

工作流说明见[Inventory](../features/inventory.md)。

## Mutation Intent、Plan、Guard 与 Outcome

### Intent

`MutationIntent` 是 strict discriminated union：

| `type` | 数据 | 限制 |
| --- | --- | --- |
| `add` | names、scope、GitHub `owner/repo` source、可选 40 位 commit | 不接受任意 URL、argv、flag 或 command |
| `remove` | names、scope | 只允许命名项 |
| `update` | names、scope | 只允许命名项 |
| `update-all` | scope | 在主进程依据 Fresh Inventory 展开；不属于当前 Wire mutation 闭集 |

名称列表非空、唯一、最多 128 项且总长度有界。

### Prepared Mutation 与 Command Plan

`SkillsProcess.prepareMutation()` 只接受 `freshness: "fresh"`、Inventory 与
`inventoryId`。它产生：

- main-only `PreparedMutation`：`id`、digest、10 分钟 expiry、Inventory id、
  TargetId、Target Generation 与 Command Plan；
- main-only argv：由 trusted adapter 构造；
- renderer-visible `CommandPlan` v1：operation、scope、names、Harness、source、
  timeout 和解释性 preview。

Remove timeout 为 2 分钟，add/update 为 10 分钟。preview 从不被解析或执行。
`ConfirmedMutation` 只带 prepared id 与 digest，是单次执行授权。

### Guard

Mutation Guard v3 在执行前 durable 写入，包含：

- `targetId`、generation、operationId、deadline；
- `phase: executing | reconciliation-required`；
- `effects: none | possible`；
- dialect、registry、Harness set 与 binding digests。

Guard 不是 outcome，也不是重试令牌。应用重启后仍存在的 Guard 会进入
Reconciliation Required；普通刷新、窗口关闭和进程退出都不能替代显式协调。

### Outcome

`MutationOutcome` 将两个维度分开：

| 维度 | 值 |
| --- | --- |
| Process | disposition：`cancelled` / `completed` / `failed` / `timed-out`；exit code；termination `known` / `unknown` |
| Effects | `verified` / `content-unverified` / `not-observed` / `possible` |

内部 outcome 还可携带 postflight Inventory 与 prepared id；公共投影只暴露
process/effects。零退出本身不等于效果已验证。

权威源码：

- `packages/skills-runtime/src/mutation.ts`
- `apps/desktop/src/main/adapters/skills-process.ts`
- `apps/desktop/src/main/application/desktop-capabilities.ts`
- `apps/desktop/src/main/persistence/recovery-records.ts`

完整授权顺序见[变更与可信审阅](../features/mutations-and-trusted-review.md)。

## Review

Review Protocol v2 与 Workspace Protocol 分离。`ReviewSnapshot` 有三种状态：

- `unavailable`：没有分配的有效 review；
- `pending`：携带一个严格 projection；
- `settled`：只记录 `approve` 或 `reject`。

Pending projection 的闭集为：

1. mutation execution/cancellation：Target、Command Plan、purpose、expiry；
2. host trust：Target、key algorithm/fingerprint/identity、first-use 或 rotation；
3. Collection：Target、Collection Plan、expiry。

Review renderer 只能 `getReview()`、`approve()`、`reject()`。批准消息不携带
argv、Prepared Mutation 或可复用 token；main 在消费一次性 review 时重新验证绑定。
源码为：

- `apps/desktop/src/contracts/review.ts`
- `apps/desktop/src/review-renderer/ReviewSurface.tsx`
- `apps/desktop/src/main/adapters/electron-ipc.ts`

## Collection

Official Collection 是受审 recipe，不是 installed state 或 desired-state controller。
当前模型由下列对象组成：

| 对象 | 主要字段/规则 | 版本 |
| --- | --- | --- |
| Catalog | release 列表；同 collection releaseNumber 与 digest 唯一 | 1 |
| Manifest | collectionId、releaseNumber、status、source、reviewedRevision、exact skills、compatibility、supersedesDigest | 1 |
| Review Receipt | author、独立 reviewer、review time/location/policy、manifest digest；approved 必须独立审阅 | 1 |
| Assessment | 对 Target/scope 分类 compatibility、missing、unknown content、source conflict、removal candidate 等 | 由 Workspace v2 投影 |
| Acknowledgement | release/delta、collection/release/digest、acknowledgedAt；不证明已安装 | durable v1 |
| Single-target Plan | release evidence、assessment/inventory/review digests、selection、child Command Plan | 1 |
| Multi-target Plan | 稳定 child order、各 Target binding/evidence/plan；顺序且非事务 | 2 |

只有 active 且 approved 的 release 可生成新 intent；deprecated/revoked 不会自动删除
已安装 Skills。Collection 执行复用普通 `SkillsProcess.prepareMutation` 和 Trusted
Review，不建立第二安装协议。

权威源码：

- `apps/desktop/src/main/application/official-collections.ts`
- `apps/desktop/src/main/application/bundled-official-collections.ts`
- `apps/desktop/src/contracts/workspace.ts`
- `apps/desktop/src/main/application/desktop-capabilities.ts`

## Recovery 文档

生产组合根在 Electron userData 的 `recovery/` 下创建
`RecoveryRecords`。当前独立 stores：

| 文件 | `kind` / 格式 | 当前 schema | Authority allowlist |
| --- | --- | --- | --- |
| `inventory-snapshots.json` | `inventory-snapshots` | 3 | 每 Target 一份 CLI version、entries、generation、observedAt；不保存 path/sourceUrl/extensions |
| `mutation-guards.json` | `mutation-guards` | 3 | Guard 绑定与未解析 legacy guards |
| `target-definitions.json` | `target-definitions` | 4 | durable Target Definition |
| `known_hosts` | 严格 OpenSSH 公钥行 | 非 JSON、无 schemaVersion | identity、algorithm、public key；不含 credential |
| `collection-acknowledgements.json` | `collection-acknowledgements` | 1 | bounded acknowledgements |

Inventory Snapshot 可迁移 v1/v2，Mutation Guard 可迁移 v1/v2，Target Definition
可迁移 v1–v3；新于当前版本的文档保留并 write-block。Guard/Target/Host Trust
损坏还会建立 schema-v1 failure marker，防止把未知 authority 当空。迁移前验证
backup，写入使用同目录 `0600` 临时文件、flush、atomic replace 与必要的目录 sync。

`RecoveryRecords` 只暴露 `restore()` 和 `commit(DurableChange)`。当前 change
闭集是 target replace/remap、inventory replace、guard put/clear/typed corruption
repair、host trust replace 与 collection acknowledgement replace。Prepared/
Confirmed Mutation、review、argv、raw output、Comparison 和 renderer Snapshot
都不持久化。

更新子系统另有 `updates/check-record-v1.json` 与
`updates/deferred-restart-v1.json`，两者都是 schema v1，但不属于
`RecoveryRecords`。

权威源码：

- `apps/desktop/src/main/persistence/recovery-records.ts`
- `apps/desktop/src/main/persistence/deferred-update-records.ts`
- `apps/desktop/src/main/persistence/update-check-records.ts`

恢复策略见[恢复与持久化](../systems/recovery-and-persistence.md)。

## Workspace、Review 与 Wire 协议

| 边界 | 当前源码版本 | 传输内容 | 明确不传输 |
| --- | --- | --- | --- |
| Workspace Protocol | **v2** | strict requests、result、ordered event、Snapshot；Target、Inventory、Mutation、Comparison、Collection 公共投影 | 通用 process/filesystem/SSH、argv、确认 authority |
| Review Protocol | **v2** | 一个 role-bound review projection 与 `approve`/`reject` | 可执行输入、可复用 confirmation |
| Wire Protocol | **v2** | 4-byte big-endian 长度 + UTF-8 JSON；observe/mutate/cancel 与 hello/inventory/mutation-result/failure | renderer command、任意 argv、`update-all` |

Workspace request 的 `version` 与 Snapshot 的 `schemaVersion` 都固定为 2；event
用 session epoch、sequence 和 state revision 保序，buffer overflow 要求重新获取
Snapshot。Review request/Snapshot 同样固定为 2。Wire v2 将 protocol version
绑定到每帧，request payload 最大 64 KiB，Inventory JSON 最大 8 MiB，frame 上限为
16 MiB 加 64 KiB。

ADR 0016 已接受目标 Wire v3，但
`packages/skills-runtime/src/wire.ts` 的当前常量仍是
`WIRE_PROTOCOL_VERSION = 2`。因此 v3 是后续架构目标，不是已交付 codec；公开 V1
仍是 Local-only。

协议源码：

- `apps/desktop/src/contracts/workspace.ts`
- `apps/desktop/src/contracts/review.ts`
- `apps/desktop/src/contracts/desktop.ts`
- `packages/skills-runtime/src/wire.ts`
- `packages/remote-bootstrap/src/index.ts`

## Schema version 速查

| 模型 | 当前版本 |
| --- | --- |
| Skills CLI dialect | `skills@1.5.23` / `skills-1.5.23` |
| Harness Compatibility Registry | 1 |
| Inventory | 1 |
| Command Plan | 1 |
| Workspace Protocol | 2 |
| Review Protocol | 2 |
| Review-window-closed event | 1 |
| Wire Protocol | 2 |
| Official Collection Catalog / Manifest / Receipt | 1 / 1 / 1 |
| Collection Plan | single-target 1；multi-target 2 |
| Inventory Snapshot / Mutation Guard / Target Definition / Collection Acknowledgement | 3 / 3 / 4 / 1 |
| Update check / Deferred update | 1 / 1 |

版本号属于各自边界，不能用应用版本 `0.1.0`、CLI 版本或另一个协议版本替代。
