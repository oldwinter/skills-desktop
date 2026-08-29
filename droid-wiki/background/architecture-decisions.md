# 架构决策

24 篇 ADR 不是 24 个彼此独立的功能清单。它们共同定义了权威从哪里来、谁能授权副作用、哪些证据可以持久化，以及一个能力需要经过什么验证才能被称为已交付。总体实现关系见[系统架构](../overview/architecture.md)。

## 先区分决策状态与产品状态

`docs/adr/README.md` 将 ADR 0014—0024 标为 accepted comprehensive-evolution decisions。这里的 accepted 只授权依赖它们的实现工作，并要求后续代码遵守这些约束。它不证明 UI、生产适配器、恢复路径、打包 smoke 或平台资格已经完成。

```mermaid
flowchart LR
    A[Accepted architecture] --> I[实现票据]
    I --> C[接口与 schema 契约]
    C --> T[production tracer]
    T --> R[恢复与负面路径]
    R --> P[打包和平台 gate]
    P --> S[Shipped capability]
```

截至当前 V1：

- 已通过的公开主线是本地 Target 的 Inventory 与受保护本地操作；
- SSH 的最终方向是 Local 加 POSIX Remote SSH，但 Inventory/来源检查要等待 Milestone 3，远端 Mutation 要等待 Milestone 4；
- 仓库里存在 SSH 或 Remote Bootstrap 实现，不会绕过这些 gate；
- accepted 的 Studio、Package、确定性发布和 Recovery Center 同样不能仅凭 ADR 或类型存在就写成已交付功能。

## 权威、证据与固定方言

[ADR 0001](../../docs/adr/0001-delegate-skill-operations-to-npx-skills.md) 把发现、添加、移除和更新的权威交给 `npx skills`。应用可以规范化 CLI 证据、持久化最后一次完整观察、生成计划，但不能扫描 Skill 目录来建立第二份已安装状态。

[ADR 0004](../../docs/adr/0004-compare-only-authoritative-skill-evidence.md) 将这一原则扩展到 Comparison：

- 比较候选按大小写敏感的 Skill 名对齐；
- Skill Identity 还需要 CLI 报告的精确 Declared Source；
- presence、source、Harness coverage、Revision、Content Fingerprint 和 freshness 分开表达；
- 缺失 Revision 或 fingerprint 是 unknown，不会被改写成相等或漂移；
- stale Inventory 可以查看和比较，不能授权 Mutation。

[ADR 0014](../../docs/adr/0014-adopt-multi-harness-targets-and-a-pinned-registry.md) 对“应用不定义 registry”作了窄幅修正。应用可以为固定 `skills@1.5.23` 方言维护经过审阅的 Harness Compatibility Registry，提供 canonical CLI identifier 和证据映射；这个 registry 不宣称某个 Harness 已安装，也不取代 CLI Inventory。Display name 和翻译始终只是呈现。

[ADR 0015](../../docs/adr/0015-inspect-stable-sources-through-the-pinned-cli.md) 用同样的方法处理来源检查：`SourceDescriptorV1` 只接受封闭来源形式，候选列表仍由固定 CLI 的 `add <source> --list` 产生。Source Inspection 是会话证据，不是 Mutation 权限，也不能证明安装后的 Revision 或 Content Fingerprint。

## Typed Mutation 与主进程授权

[ADR 0002](../../docs/adr/0002-execute-only-typed-confirmed-skill-operations.md) 和 [ADR 0005](../../docs/adr/0005-own-the-local-skill-process-lifecycle.md) 建立了核心执行链：

```text
Mutation Intent
→ Prepared Mutation
→ Command Plan
→ Trusted Review
→ Confirmed Mutation
→ Guard
→ execution
→ postflight Inventory
```

Intent 是封闭结构，不含命令文本或任意参数。Command Plan 可以展示预览，但执行只消费主进程私有的参数数组。确认绑定精确计划、Target Generation 和 Fresh Inventory，过期且单次使用。Mutation Outcome 把进程终止状态与可观察效果分开，零退出码本身不是成功证明。

[ADR 0009](../../docs/adr/0009-isolate-trusted-review-from-renderer-capabilities.md) 把普通 workspace renderer 与独立 review renderer 分成两个角色。[ADR 0010](../../docs/adr/0010-center-production-on-desktop-capabilities.md) 进一步选择一个窄公共接口后的深 `DesktopCapabilities` 模块，集中状态、授权、审阅、执行顺序、事件和脱敏。Comparison、Collection assessment 等可以提取为私有模块，但不为测试便利或假想适配器增加公共端口。

[ADR 0023](../../docs/adr/0023-ship-a-native-bilingual-accessible-shell.md) 将这一边界升级为严格的 Workspace Protocol v2 和 Review Protocol v2，并加入主进程拥有的菜单、对话框、焦点恢复、语言和外观状态。v2 不与 v1 协商，也不暴露通用 process、filesystem、URL、SSH、Git 或 confirmation 能力。当前实现边界可继续阅读 [DesktopCapabilities](../systems/desktop-capabilities/index.md) 与 [IPC 和 renderer 隔离](../systems/ipc-and-renderer-isolation.md)。

## Target、OpenSSH 与不确定远端结果

[ADR 0003](../../docs/adr/0003-leave-ssh-secrets-with-openssh.md) 规定凭据留在系统 OpenSSH 配置和 agent 中。[ADR 0006](../../docs/adr/0006-bind-ssh-targets-to-one-skills-process.md) 进一步定义稳定 `TargetId`、可变 Generation、冻结的 Effective Target Binding、应用自有的公共 host-key trust store，以及 Local/SSH 共用的 `SkillsProcess` 深接口。

这里有几条持续有效的安全规则：

- Target label 和 SSH alias 不是身份；任何影响执行的 binding 漂移都会推进 Generation；
- 每次观察或执行使用新的非交互 SSH session，不保留连接池；
- 远端命令是 build-time constant，动态值只走有界结构化 Wire frame；
- 没有最终 cleanup 和 postflight 证据时，结果是 Remote Outcome Uncertain；
- 不确定结果保留 Guard、阻止重试，并要求 deadline-aware reconciliation。

[ADR 0014](../../docs/adr/0014-adopt-multi-harness-targets-and-a-pinned-registry.md) 把 Target 从单 Harness 改为同一机器、同一 canonical workspace 和非空 Harness 集合。[ADR 0016](../../docs/adr/0016-promote-posix-ssh-with-wire-v3.md) 接受 POSIX SSH 目标并以 Wire v3 替换早期 Wire 合同，同时保留 ADR 0006 的 fixed command、显式 trust、fresh session 和 uncertain-outcome 规则。它还明确要求 public claims 落后于 Milestone 3/4 的打包门禁。仓库中远端代码的当前定位见[远端传输（实验与后续范围）](../systems/remote-transport-experimental.md)。

## 持久化、Guard 与恢复

[ADR 0007](../../docs/adr/0007-persist-bounded-recovery-records.md) 选择了少量、独立版本化、字段 allowlist 的恢复记录。Inventory Snapshot 重启后总是 stale；Prepared/Confirmed Mutation、token、私有 argv、预览、raw stream 和未知字段都不持久化。Mutation 启动前必须先 durable 地写入最小 Guard。

[ADR 0022](../../docs/adr/0022-recover-through-versioned-records-and-typed-repairs.md) 没有把恢复改成通用 JSON 数据库，而是扩展同一个 `restore()` / `commit(DurableChange)` seam。相邻版本迁移、备份、原子替换、quarantine、newer-schema write block 和 surviving Guard 保留继续有效。Recovery Center 只能提供按状态命名的修复动作，没有通用 clear、retry、accept-any-host 或 overwrite-newer。

[ADR 0020](../../docs/adr/0020-publish-through-isolated-guarded-git.md) 将同一种“副作用前 durable、结果不确定则协调”的结构应用到 Git push。Publication Guard 与 Mutation Guard 属于不同操作域，但都拒绝在结果不确定时自动重试。恢复实现详见[恢复与持久化](../systems/recovery-and-persistence.md)。

## Collection、Package、Studio 与发布内容

[ADR 0008](../../docs/adr/0008-ship-reviewed-pinned-collection-recipes.md) 将 Official Collection 定义为经过审阅的 recipe，而不是已安装状态或另一套安装器。Collection Plan 最终展开为普通 child Mutation；按稳定顺序执行，首个失败或不确定结果后停止，不回滚已完成 child。

[ADR 0017](../../docs/adr/0017-separate-package-origins-in-canonical-skillpacks.md) 增加 User Package 与 Imported Package，并保持 Official、User、Imported 和 Installed Skill 四种身份不可互相冒充。`.skillpack` 只有 metadata/source，不含 Skill 内容、凭据、Target、argv、Guard 或 Official receipt。

[ADR 0018](../../docs/adr/0018-author-skills-with-static-studio-grants.md) 为 Studio 选择 Local-only 静态 authoring：renderer 获得的是用途绑定、document-epoch 绑定的 opaque Filesystem Grant，不是路径或通用文件系统桥。验证和预览不运行脚本、插件、hook 或嵌入命令。

[ADR 0019](../../docs/adr/0019-export-deterministic-well-known-artifacts.md) 固定 well-known discovery 的路径、JSON 字节、排序、digest 和 archive metadata。[ADR 0020](../../docs/adr/0020-publish-through-isolated-guarded-git.md) 将可选 Git 发布隔离到应用自有临时仓库，并限制为 fast-forward。[ADR 0021](../../docs/adr/0021-handoff-to-skills-sh-through-the-system-browser.md) 只允许主进程生成 allowlisted HTTPS URL 并交给系统浏览器；“浏览器已打开”不等于“发布成功”。

这些 ADR 描述的是彼此隔离的 authority：静态 authoring、确定性字节、Git 副作用和外部浏览器 handoff 不能合并成通用文件、命令或网络接口。

## 验证与发行分类

[ADR 0012](../../docs/adr/0012-verify-deep-interfaces-through-staged-tracers.md) 将长期测试面固定在 `skills-runtime`、`SkillsProcess`、`RecoveryRecords` 和 `DesktopCapabilities` 四个深接口，并要求每个 vertical slice 穿过真实生产 seam。mock、renderer 或私有 helper 单独存在都不算完成。

[ADR 0011](../../docs/adr/0011-ship-signed-platform-artifacts.md) 定义签名 Stable Release 的平台信任、独立批准、不可变产物和更新要求。[ADR 0013](../../docs/adr/0013-publish-attested-unsigned-developer-previews.md) 只窄幅取消“任何公开 unsigned artifact 都不允许”的禁令，允许带 checksum、SPDX SBOM 和 attestation 的 Unsigned Developer Preview。它没有放宽 Stable Release 的签名、公证、publisher identity 或自动更新要求。

[ADR 0024](../../docs/adr/0024-qualify-an-unsigned-mission-candidate.md) 为综合演进增加可重复的 Linux Electron、隔离真实 CLI、localhost SSH、本地 HTTP 和 bare Git hard surfaces，同时明确这些 fixture 不能外推为真实外部主机、macOS/Windows 原生无障碍或平台签名证据。公开文档只有在对应 tracer 与 validator 通过后才能升级能力表述。

## 如何处理看似冲突的 ADR

| 后续决策 | 对早期决策的处理 |
| --- | --- |
| ADR 0013 对 ADR 0011 | 只允许独立分类的 unsigned preview；Stable Release 合同不变 |
| ADR 0014 对 ADR 0001 | 允许固定 CLI 方言的兼容性 registry；已安装状态仍由 CLI 决定 |
| ADR 0015 对 ADR 0005 | 允许封闭、由 CLI 执行的 source listing；不增加通用 parser 或 planner |
| ADR 0016 对 ADR 0006 | Wire v3 替换早期 Wire 合同；OpenSSH、trust、fresh session 和 uncertainty 规则保留 |
| ADR 0022 对 ADR 0007 | 扩展封闭 durable transitions；不改成通用持久化或通用清除 |
| ADR 0023 对 ADR 0009/0010 | 升级到 Workspace/Review v2；角色隔离和主进程 authority 保留 |

因此阅读顺序不是“编号越大就全部覆盖越小”。应先找到决策主题，再看后续 ADR 明确写出的 amend 或 narrow supersede 范围；未被明确替换的安全约束继续有效。
