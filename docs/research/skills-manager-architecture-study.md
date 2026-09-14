# Skills Manager 架构研究与落地路线

状态：研究记录（evidence），不是决策。任何会改变产品行为的条目都必须先经过
`wayfinder` 决策票据与 ADR，再进入 `to-spec` / `to-tickets`。

研究对象：[skillsmanager.dev](https://skillsmanager.dev/) 对应的开源仓库
`xingkongliang/skills-manager`（Tauri + Rust + SQLite，桌面端 + `skills-manager-cli`）。
研究时的上游提交：`97f86c8`。下文的文件路径均相对该仓库根目录。

本文分三部分：

1. Skills Manager 的管理架构拆解（它做了什么、怎么做的、为什么）。
2. 与本仓库现有 ADR 的逐项对照（哪些已经等价实现、哪些冲突、哪些是空白）。
3. 可落地的路线图：按"无需决策即可做"与"需要新 ADR"分层。

---

## 1. Skills Manager 的管理架构

### 1.1 核心模型：一个中央库，多次部署

Skills Manager 的全部设计都围绕一条原则：**技能只存一份，agent 目录里放的是
部署产物**。

- 中央库固定在 `~/.skills-manager/`，下有 `skills/`（技能本体，同时是一个 git
  仓库）、`scenarios/`、`cache/`、`logs/`、`bin/`（见 `src-tauri/src/core/central_repo.rs`
  的 `skills_dir()`、`scenarios_dir()`、`cache_dir()`、`logs_dir()`、`db_path()`）。
- 每个 agent（Cursor、Claude Code、Codex 等）的技能目录只是"部署目标"，通过
  **symlink 或 copy** 指向中央库（`src-tauri/src/core/sync_engine.rs` 中
  `SyncMode::{Symlink, Copy}`，默认 symlink，`sync_mode_for_tool()`）。
- 因而"给某个 agent 启用某个技能"是一次幂等的部署，而不是一次安装。

### 1.2 持久化：SQLite 作为"部署意图"账本

Schema 见 `src-tauri/src/core/migrations.rs`（`migrate_v0_to_v1`），关键表：

| 表 | 作用 | 值得注意的列 |
| --- | --- | --- |
| `skills` | 中央库中每个技能一行 | `source_type / source_ref / source_revision / remote_revision`（来源与版本证据）、`central_path`（唯一）、`content_hash`、`enabled`、`update_status`、`last_check_error` |
| `skill_targets` | 技能 × agent 的部署记录 | `tool`、`target_path`、`mode`（symlink/copy）、`source_hash`、`UNIQUE(skill_id, tool)` |
| `discovered_skills` | 在 agent 目录里扫到但不归中央库管理的技能 | `fingerprint`、`imported_skill_id` |
| `scenarios` / `scenario_skills` / `scenario_skill_tools` / `active_scenario` | Presets（按场景成组切换） | 每个 preset 可以细到"这个技能在这个 agent 上是否启用" |
| `projects` | 工作区（项目级技能目录）登记 | `workspace_type`、`linked_agent_key`、`disabled_path` |
| `skill_tags` | 标签 | |
| `audit_log` | 追加式审计日志 | 见 1.6 |
| `pending_conflicts` | 多机同步时等待用户裁决的冲突 | 见 1.7 |
| `settings` / `skillssh_cache` | 键值设置、skills.sh 目录缓存 | |

关键点：**`skill_targets` 行是"历史意图"，不是"磁盘现状的证明"**。这句话
直接写在 `sync_engine.rs` 的 `ReplacePolicy::Recorded` 注释里，并决定了整个
安全模型（1.4）。

SQLite 本身**不进 git**。可随库同步的元数据另存为 JSON
（`sync_metadata.rs`：`skills/.skills-manager/skills/<id>.json` 的 `SkillMetaFile`、
`scenarios/`、`scenario-skills/`），重建索引时再写回数据库。敏感设置
（代理、备份远端 URL）用 `.secret.key` 做 AES-GCM 加密后存入 `settings`。

### 1.3 技能格式识别

`docs/skill-format-detection-spec.md` 明确：

- 规范规则：目录内存在 `SKILL.md` 才算技能。
- 兼容规则：`skill.md` 可视作遗留变体。
- `README.md`、`CLAUDE.md` **不**作为技能标记。

该规则被中央库扫描、项目工作区扫描、本地导入校验、git 仓库发现四处共用。

### 1.4 安全模型：分类目标 → 授权策略 → 拒绝而非覆盖

这是 Skills Manager 最值得学习的部分，集中在 `src-tauri/src/core/sync_engine.rs`，
源于其 issue #363（部署路径曾直接删除用户未托管目录）。

1. **`TargetState` 只用 `symlink_metadata` 分类，从不 `is_dir()`**（后者会跟随
   链接，把 Windows junction 或目录 symlink 误判成真目录）：
   `Absent | LinkToSource | ForeignLink | RealDir | RealFile`。
2. **`ReplacePolicy` 是枚举而不是 bool**，让每个调用点必须声明意图：
   - `NoClobber`：只有能证明"是我们的"才动。
   - `Recorded { mode }`：有 `skill_targets` 行，但只授权删除**当前类型与记录
     mode 一致**的对象——记录说 symlink，绝不能因此删除后来替换进去的真目录。
   - `UserConfirmed`：用户明确 `--force` / 采纳（adopt）/"从中央更新这份拷贝"。
3. **`ReplaceRefused` 是独立错误类型**，让"所有权拒绝"与普通 IO 错误在调用方
   分流：前者要上报冲突给用户，后者可容忍并记录。
4. **`preflight_replace()` 先整批预检，再逐个写入前重新检查**（文件系统在两次
   之间可能改变）。批量操作必须"要么全部拒绝，要么开始改动"。
5. **拒绝文案只在 `refusal_message()` 一处**，保证 `ReplaceRefused` 与
   `TargetConflict` 永不漂移。

配套的还有：

- `scenario_service.rs` 中 `DeployIntent::{Managed, AdoptExisting}`：普通部署与
  "采纳已有目录"走不同代码路径，不能共用（#363）。
- 采纳时 `detach_source_refs_from_adoption_target()` 把所有 `source_ref` 指向该
  目录的技能重新指到自己的中央副本（#425），避免被采纳目录变成部署产物后
  更新检查永远 `source_missing`。
- `path_guard.rs`：`sanitize_name()`（去分隔符、遍历、Windows 保留字符、控制
  字符、长度）与 `is_path_safe()`（含 symlink 逃逸测试）。
- `removals.rs`：`removed_paths()` 在更新前列出"这次更新会删掉哪些文件"。
  `commands/skills.rs` 据此把更新拆成两步：会删文件的更新先**held back**，
  返回 `removal_approval` token（由 `removal_approval_token(revision, pending)`
  绑定到具体 revision 与删除清单）；只有桌面端用户接受后带 token 重试才真正
  删除，CLI 无法越过（`manage-skills` 技能也明文禁止 agent 强制）。
- `content_hash.rs`：`hash_directory()` 对内容文件（含可执行位）做确定性哈希，
  作为 `skill_targets.source_hash` 与 `skills.content_hash` 的新鲜度依据。

### 1.5 Agent 适配与工作区

- `src-tauri/src/core/tool_adapters.rs` 的 `default_tool_adapters()` 内置 54 个
  `ToolAdapter`（`cursor`、`claude_code`、`codex`、`gemini_cli`、`github_copilot`、
  `windsurf`、`cline`、`hermes`……，与 README「54 agents」一致），每个描述全局
  技能目录、项目级目录、附加扫描目录、是否递归扫描等；另有 `CustomToolDef`
  允许用户自定义 agent。
- `project_scanner.rs`：`AgentSkillConfig { key, relative_skills_dir }` 描述
  项目级技能目录（如 `.claude/skills`），`read_project_skills()` 产出
  `ProjectSkillInfo`，带 `in_center / sync_status / center_skill_id` 用于和中央
  库对账。

### 1.6 可观测性与"自己写的别当成外部改动"

- `audit_log.rs`：追加式审计表，`MAX_ENTRIES = 10_000` 自动裁剪，写入是
  best-effort（失败不阻塞用户操作），字段 `action / skill / tool / success / detail`。
- `file_watcher.rs`：`notify` 监听中央库与 agent 目录，`SELF_WRITE_MUTE = 1200ms`
  按路径屏蔽应用自己写入产生的回声（#248），`WATCH_RESCAN_INTERVAL = 3s` 兜底。

### 1.7 备份与多机同步

- 中央库本身是 git 仓库；`git_backup.rs` 提供 init/clone/set-remote/pull/push/
  commit；凭据经 `git_credentials.rs` 写入 OS keychain（`keyring::Entry`），
  日志经 `log_sanitize.rs` 脱敏。
- `auto_backup.rs`：文件变化后 `DEBOUNCE = 120s` 再后台 commit+push，
  `INITIAL_DELAY = 90s`，失败指数退避上限 `2^5 × 2min ≈ 1h`；不打 tag（tag
  留给用户可见的手动备份点）。
- `merge/`：**对象级三方合并**（以技能目录为单位而非行级），默认启用，
  `settings.merge_engine = "system"` 是回退到 git 行级合并的逃生门；每次 app
  提交带协议标记，旧客户端的行级合并提交会被识别为违规。无法自动裁决的进入
  `pending_conflicts`（本地工作副本保留，UI 标记 Needs attention），自动备份在
  该技能上退避，其它技能照常流动。用户裁决为 `merge/resolve.rs` 的
  `ResolveAction::{KeepLocal, UseRemote, KeepBoth}`，裁决前先打安全快照 tag。

### 1.8 面向 agent 的 CLI 与"自举"技能

- `src-tauri/src/bin/skills-manager-cli.rs` 子命令：`library {status,set-path,
  reset-path}`、`agents {list,enable,disable}`、`skills {list,show,export,install,
  update,check,remove,enable,disable,deploy,undeploy,status,sync,search,set-source,
  adopt}`、`tags {...}`、`presets {list,current,show,create,update,delete,preview,
  apply,deactivate,deploy,undeploy,status,add-skill,remove-skill}`、
  `git {status,init,clone,set-remote,pull,push,commit}`。
- `cli_bridge.rs`：桌面应用把 CLI 复制到固定路径 `~/.skills-manager/bin/`，
  并**最后写、最先删**一个 `.version` 戳文件：有戳才可用；没戳的二进制视为
  半途失败的拷贝，一律不用（因为旧二进制可能早于安全修复）。
- `skills/manage-skills/SKILL.md`：随应用分发的一个技能，教 agent 先解析 CLI
  路径（三种结局：桥接路径 / `BRIDGE_BROKEN` 停止 / PATH 上的 CLI），再用它
  管理库。这是"让 agent 自己管理技能"的入口。

---

## 2. 与本仓库 ADR 的对照

| 主题 | Skills Manager 做法 | 本仓库现状 | 结论 |
| --- | --- | --- | --- |
| 事实来源 | 自建中央库 + 自扫描 + 自装协议 | ADR 0001：`npx skills` 是唯一权威，不扫目录、不定义注册表、不实现另一套安装协议 | **冲突**。不能引入中央库/自扫描。可学的是"意图账本 vs 磁盘证据"的区分 |
| 多 agent 适配表 | `tool_adapters.rs` 内置 19 个 + 自定义 | ADR 0014 + `packages/skills-runtime/src/harness-registry.ts` 的 pinned registry | **已等价**。差异是我们的 registry 是 pinned 与 CLI 版本绑定，不接受运行时自定义 |
| 技能识别 | `SKILL.md` 规范规则 | ADR 0004/0015：只比较 pinned CLI 输出的权威证据 | **已覆盖**（由 CLI 负责）。可把 spec 里"`README.md` 不是标记"写进用户文档 |
| 部署方式 | symlink/copy 到 agent 目录 | 由 `npx skills add/remove` 决定，`mutation.ts` 只做参数数组 | **不采纳**实现，但采纳"部署前分类目标"的检查思路（见 3.2） |
| 破坏性保护 | `TargetState` × `ReplacePolicy` × `ReplaceRefused` × 预检 | ADR 0002 输入确认、Mutation Guard v3、`removed_paths` 类预览缺失 | **部分覆盖**。缺"变更会删除什么"的预览与"记录不等于证明"的显式判定 |
| 采纳已有目录 | `DeployIntent::AdoptExisting` 独立路径 | 无 | 属于 CLI 职责；仅需在 UI 区分"未托管"证据 |
| Presets | scenarios 表 + 逐 agent 开关 | ADR 0008/0017：Official Collection 是 reviewed、pinned 的 recipe，不是用户自由分组 | **概念不同**。用户自定义 preset 需新 ADR |
| 工作区 | `projects` 表 + 项目级目录扫描 | 无 | 需新 ADR；且 CLI 是否支持项目级枚举决定可行性 |
| 审计日志 | SQLite 追加表，best-effort | ADR 0007/0022：`RecoveryRecords` 有界恢复记录 | **部分覆盖**。可加一个"操作历史"的只读视图，不新增权威状态 |
| 自写屏蔽 | 按路径 1200ms 静音 | 本仓库不 watch 文件系统 | 不适用；如将来加刷新触发需带上 |
| 备份/同步 | 中央库 git + 对象级三方合并 + keychain | ADR 0020：隔离、守卫式 git 发布；ADR 0003：SSH 密钥留给 OpenSSH；V1 Local-only | **冲突/超范围**。多机对账已被 AGENTS.md 明确排除在 V1 |
| Agent 自举 | `~/.skills-manager/bin` 桥接 + `manage-skills` 技能 | `.cursor/skills/verify-skills-desktop` 只用于验证 | **空白**。可以随仓库发一个 `manage-skills-desktop` 技能，但它只能调用 `npx skills`，不能调用桌面端 |
| CLI 版本一致性 | `.version` 戳文件"最后写、最先删" | `inventory.ts` 的 `CLI_PACKAGE@CLI_VERSION` pinned | **已等价**（pinned 优于戳文件） |

结论：Skills Manager 的价值主要在 **安全语义** 与 **可解释性**，而不在中央库。
本仓库不应复制其存储模型，但应把它的判定逻辑迁移到"证据 → 计划 → 确认"的
现有流水线里。

---

## 3. 落地路线

### 3.1 已在本 PR 内完成

- `apps/website`：落地页，段落结构复刻 skillsmanager.dev，主题、文案、下载与
  CLI 示例均来自本仓库真实数据（`harness-registry.ts`、`mutation.ts`、
  `docs/user-guide.md` 截图）。见 README「Website」一节。
- 本研究文档。

### 3.2 无需新 ADR、可直接开票的改进（tracer-bullet 候选）

按对 V1 Local-only 承诺的贴合度排序：

1. **Mutation 预览的"会删除什么"清单**（对应 `removals.rs`）
   - 位置：`packages/skills-runtime/src/mutation.ts` 的计划输出 + Trusted Review。
   - 做法：对 `remove` / `update` 类 `MutationIntent`，在 Inventory Snapshot 的
     证据里标出受影响的 skill 路径与名称，确认对话框逐条列出。
   - 借鉴其 `removal_approval` token：把确认与"具体 revision + 具体删除清单"
     绑定，证据变了确认即失效。这与 Mutation Guard v3 的 digest 绑定同构，
     只需把"删除清单"纳入 digest 输入。
   - 边界：只呈现 CLI 已报告的证据，不自行遍历目录（ADR 0001/0004）。
   - 测试：diff 语义、确认文案与计划的绑定、证据变更后 token 失效。
2. **"记录不等于证明"显式化**（对应 `ReplacePolicy::Recorded`）
   - 位置：Comparison / Mutation Guard。
   - 做法：当 Snapshot 为 Stale 时，任何 mutation 计划必须先刷新 Inventory；
     把"上次记录"与"当前 CLI 证据"在 UI 上分开着色，而不是合并展示。
   - 现状检查：ADR 0022 已要求 Stale Snapshot 只能通过 allowlist 恢复，这一
     项主要是把约束外显给用户。
3. **拒绝文案单一来源**（对应 `refusal_message()`）
   - 做法：Guard 拒绝、Comparison 冲突、Recovery 阻塞共用一个文案函数与
     i18n key（ADR 0023 双语要求）。
   - 测试：快照测试保证三处文案一致。
4. **只读操作历史视图**（对应 `audit_log`）
   - 位置：`apps/desktop/src/main/persistence/recovery-records.ts` 已有
     `DurableChange` 闭合联合；增加只读投影而非新表。
   - 边界：有界（沿用 ADR 0007 的 bounded records），best-effort，不成为权威。
5. **随仓库分发 `manage-skills-desktop` 技能**（对应 `manage-skills/SKILL.md`）
   - 位置：`.cursor/skills/` 或新的 `skills/` 目录。
   - 做法：教 agent 用 `npx skills@<pinned>` 的**参数数组**完成 list/add/remove，
     并在任何 mutation 前提示用户在桌面端确认；不提供桥接二进制。
   - 边界：绝不让 agent 生成的 shell 文本被桌面端执行（AGENTS.md）。
6. **用户文档补充技能识别规则**
   - 在 `docs/user-guide.md` 说明 `SKILL.md` 是唯一标记，`README.md` /
     `CLAUDE.md` 不会被识别；引用上游 `skills.sh` 文档。

### 3.3 需要先出决策票据（wayfinder）的方向

| 方向 | 需要回答的问题 | 与现有 ADR 的张力 |
| --- | --- | --- |
| 用户自定义 Preset（本地 Collection） | 与 Official Collection 的关系是什么？是否有 review receipt？能否导出/导入？ | ADR 0008/0017 把 Collection 定义为 reviewed、pinned；用户 preset 是另一个概念，需要新词汇进入 `CONTEXT.md` |
| 项目级工作区 | pinned CLI 能否枚举项目级技能目录？如不能，是否等待上游？ | ADR 0001 禁止自扫描，可行性完全取决于 CLI 能力 |
| 采纳未托管目录 | 是否呈现"CLI 未报告但目录存在"的差异？ | ADR 0004 只比较权威证据；这属于证据缺口，可能需要"Content Fingerprint policy"（ADR 0001 已预留此名） |
| 中央库 git 备份 | V1 Local-only 下是否需要？ | AGENTS.md 明确跨机对账在 V1 之外；ADR 0020 的守卫式 git 面向发布而非备份 |
| 桌面端 ↔ agent 桥接 | 是否允许 agent 触发桌面端的 mutation？ | ADR 0009 渲染器隔离、ADR 0002 输入确认，极大概率拒绝；`manage-skills` 技能应只走 CLI |

### 3.4 明确不采纳

- 自建中央技能库与自扫描（与 ADR 0001 根本冲突）。
- 运行时可编辑的 agent 适配表（与 ADR 0014 pinned registry 冲突）。
- 对象级三方合并引擎（V1 无多机场景；复杂度远超收益）。
- 桥接二进制 + 戳文件（本仓库用 pinned `CLI_PACKAGE@CLI_VERSION` 已解决同一问题）。

---

## 附：本次研究读取的上游文件

- `README.md`、`skills/manage-skills/SKILL.md`、`docs/skill-format-detection-spec.md`
- `src-tauri/src/core/{migrations,sync_engine,scenario_service,tool_adapters,
  project_scanner,content_hash,path_guard,removals,audit_log,file_watcher,
  auto_backup,git_backup,git_credentials,cli_bridge,central_repo}.rs`
- `src-tauri/src/core/merge/mod.rs`
- `src-tauri/src/bin/skills-manager-cli.rs`
