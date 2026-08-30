# 维护机会

本页只列当前仓库能够复核的维护线索，不把文件大、近期 churn 高或依赖树深直接解释成缺陷。仓库级 grep 未发现 `TODO`、`FIXME` 或 `HACK`，现有证据也不足以声称存在 dead code；因此这里不建立虚构的“删除清单”。

规模和 churn 的完整口径见[代码库数字](by-the-numbers.md)。模块职责见 [DesktopCapabilities](systems/desktop-capabilities/index.md)、[恢复与持久化](systems/recovery-and-persistence.md)和[桌面应用](apps/desktop/index.md)。

## 当前热点复核

以下 LOC 是本页最终复核时对当前检出工作树运行 `wc -l` 的结果。它修正了早期估值：`apps/desktop/src/main/application/desktop-capabilities.test.ts` 是 **6,936** 行，不是约 6,979 行；`apps/desktop/src/main/persistence/recovery-records.ts` 是 **2,405** 行，不是约 2,056 行。工作树正在演进时，后续提交可能再次改变这些数字。

Churn 取自[代码库数字](by-the-numbers.md)已经记录的 `origin/main` 最近 90 天 `added + deleted`。仓库历史只有约一周，所以这个“90 天”窗口实际接近全部历史，适合找阅读热点，不适合推断长期维护趋势。

| 完整仓库路径 | 当前 LOC | 已记录 churn | 可验证的维护含义 |
| --- | ---: | ---: | --- |
| `apps/desktop/src/main/application/desktop-capabilities.ts` | 4,011 | 4,593 | 大型主进程编排实现，也是近期核心改动集中处 |
| `apps/desktop/src/main/application/desktop-capabilities.test.ts` | 6,936 | 7,377 | 最大测试文件，覆盖同一个深接口的多类行为 |
| `apps/desktop/src/main/persistence/recovery-records.ts` | 2,405 | 2,423 | schema、迁移和 durable transition 的高风险集中区 |
| `apps/desktop/src/renderer/features/inventory/InventoryApp.tsx` | 1,355 | 2,551 | workspace 顶层组件与 Inventory 交互的高 churn 入口 |
| `scripts/release/release-integrity.mjs` | 1,585 | 1,819 | 候选 manifest、digest 与发行完整性验证的集中脚本 |

高 LOC 与高 churn 同时出现，说明这些文件值得优先改善导航和变更隔离。它们不证明模块边界错误、测试重复或函数应按任意行数切分。

## 大文件可能是有意的深模块

`docs/adr/0010-center-production-on-desktop-capabilities.md` 明确接受大型 `DesktopCapabilities` 实现，因为它把授权、Target session、Fresh Inventory、Trusted Review、Guard 顺序、恢复、事件和脱敏留在一个很小的接口后。当前公开方法主要是 `attach()`、`initialize()`、`restartSafety()` 与 `shutdown()`；ADR 0012 又要求测试从这一接口观察行为，而不是为私有状态增加端口。

因此维护目标应是“减轻单文件导航与局部改动成本”，不是“让每个目录都有一个公共接口”。仓库已经给出可复用模式：`apps/desktop/src/main/application/comparison.ts` 和 `apps/desktop/src/main/application/official-collections.ts` 是进程内私有协作者，没有把 authority 转移给 renderer 或插件。

## 可行动的渐进提取

### 1. 先整理 DesktopCapabilities 的测试版图

可以按现有可观察场景把 `apps/desktop/src/main/application/desktop-capabilities.test.ts` 拆成多个共置测试文件，例如 Inventory/Target session、Mutation/Trusted Review、Collection、事件/teardown 和恢复/reconciliation。共享 fixture 可以保留为测试私有 helper，但所有场景仍通过 `DesktopCapabilities` session contract 进入。

完成标准不是测试文件变短，而是：

- 原有角色矩阵、单次审阅、Guard-before-spawn、事件重同步和 fail-closed 场景仍在；
- 没有导出生产私有 Map、状态或 helper；
- `npm run test:coverage`、`npm run typecheck` 和 `npm run check:imports` 保持通过。

这是较低行为风险的第一步，也会为后续实现提取提供清楚的回归分区。

### 2. 从 DesktopCapabilities 提取私有策略模块

对 `apps/desktop/src/main/application/desktop-capabilities.ts`，一次只选择一个已经有契约测试保护的职责簇，提取为同目录私有模块。候选应由现有调用内聚度决定，例如 request 的纯校验/投影、事件投影，或某个不持有额外 authority 的工作流协作者；不要先按文件长度预设类层次。

提取时保留以下边界：

- `DesktopCapabilities` 继续拥有 session、authorization 和副作用顺序；
- `SkillsTargets`、`SkillsProcess`、`RecoveryRecords` 仍是现有 principal interfaces；
- renderer contract 不增加通用 request、argv、path、persistence 或 confirmation；
- 新模块默认不从 workspace package 对外导出。

每次只移动一类逻辑，并以现有 contract 测试证明 Snapshot、Result、事件序号、Guard 和 postflight 行为未变。不要把一次机械搬迁与 schema 或产品行为变化放在同一变更中。

### 3. 隔离 RecoveryRecords 的私有实现层

`apps/desktop/src/main/persistence/recovery-records.ts` 的公共价值来自 `restore()` 和 `commit(DurableChange)` 的窄 seam。若继续增长，可在不增加 repository 接口的前提下，把以下实现关注点逐步移到私有文件：

- 各 store 的 schema 与相邻版本 migration；
- 临时文件、flush、atomic replace、目录同步和 quarantine；
- `DurableChange` 到具体 store transition 的内部 dispatch。

每次提取都要保留 memory/JSON adapter 契约，以及 old、corrupt、newer-version、fault injection、backup、idempotence 和 surviving Guard fixture。这里的拆分风险高于普通 UI 重构，应在[恢复与持久化](systems/recovery-and-persistence.md)列出的 fail-closed 不变量下逐项进行。

### 4. 缩小 InventoryApp 的视图职责

`apps/desktop/src/renderer/features/inventory/InventoryApp.tsx` 同时是 workspace shell 与 Inventory 顶层组件。可优先抽取不拥有 domain authority 的 feature-local 部分，例如纯 selector、局部 reducer/hook、无状态展示区域或焦点恢复 helper。

边界仍应是：

- Snapshot mirror 可以随 renderer reload 丢弃；
- 搜索、选中项、路由、焦点和未提交表单保持 view-local；
- bridge request 仍使用 `apps/desktop/src/contracts/workspace.ts` 的封闭 schema；
- renderer 不导入 Electron、Node、主进程模块或可执行计划。

拆分后要跑现有 `InventoryApp` 测试与 packaged UI QA，特别复核 event gap resync、窄屏布局、可访问名称和 Trusted Review 关闭后的焦点恢复。

### 5. 给发行完整性脚本建立私有阶段边界

`scripts/release/release-integrity.mjs` 位于发布信任路径。可将纯 manifest 解析、路径 allowlist、digest/SBOM/attestation 关联检查等可独立验证的步骤提取为 `scripts/release/` 下的私有模块，同时保留一个稳定的 CLI 入口。

不要在重构时放宽：

- candidate bytes 在批准后不可重建或替换；
- Stable、Unsigned Candidate 与 Unsigned Developer Preview 的分类；
- 平台、架构、版本、source commit 和 digest 绑定；
- 错误时 fail closed，且不把发布 credential 或原始敏感输出写入证据。

该脚本应以现有 release fixture 和 `npm run candidate:build` 相关验证保护。代码移动本身不应改变 artifact naming、manifest schema 或发布资格。

## 建议的工作粒度

| 步骤 | 范围 | 为什么适合单独提交 |
| --- | --- | --- |
| 1 | 拆分 `apps/desktop/src/main/application/desktop-capabilities.test.ts`，不改生产代码 | 先改善场景导航，并建立更清楚的保护网 |
| 2 | 一次提取一个 `DesktopCapabilities` 私有协作者 | 容易判断 Snapshot、Result 和副作用顺序是否保持 |
| 3 | 一次提取一个 renderer 局部职责 | 与主进程 authority 无关，可用组件和 packaged QA 验证 |
| 4 | 一次迁移一个 RecoveryRecords 实现关注点 | 避免把 schema、I/O 与 domain transition 同时改动 |
| 5 | 一次提取一个 release integrity 纯阶段 | 保持候选入口和发布资格不变，便于 fixture 对照 |

不建议用“每个文件低于 N 行”作为完成标准。更可靠的标准是公共接口没有变宽、依赖方向未改变、原有负面测试仍能证明没有副作用或 authority 泄漏。

## 依赖新鲜度能证明什么

本页没有联网查询 registry、release date、维护状态或安全公告，因此不把任何依赖标为 outdated 或 unmaintained。仅凭 manifests 与 lockfile，可以复核以下事实：

- 根 `package.json` 要求 Node `>=22.20.0`，并使用 npm workspace `apps/*`、`packages/*`；
- 根开发依赖和 `apps/desktop/package.json` 的直接依赖都使用精确版本，没有 `^` 或 `~` 范围；
- `package-lock.json` 使用 lockfile v3，并在根和 `apps/desktop` workspace 条目中记录与 manifests 相同的直接版本；
- `packages/skills-runtime/package.json` 固定 `zod` `4.5.4`，`packages/remote-bootstrap/package.json` 只依赖内部 runtime `0.1.0`；
- 根 overrides 将 `extract-zip` 指向 `@electron-internal/extract-zip@1.0.5`，并固定 `tar` `7.5.22`、`tmp` `0.2.7`；
- Electron `44.0.0` 同时出现在 `allowScripts` 和 desktop devDependency 中。

这些信息证明当前依赖解析是有意固定且 manifest/lockfile 在已检查入口上一致。它们不能证明这些版本是最新、仍受维护或没有漏洞。依赖维护的可行动做法是把“版本变更”和“行为/打包验证”绑定：每次只更新一个相关依赖组，审查 lockfile diff，然后运行 `npm run verify` 以及受影响的 packaged、candidate 或平台测试；不要根据版本号外观批量升级。

## 明确不报告的内容

- **TODO/FIXME/HACK：** 已复核为 0，不创建空的待办清单。
- **Dead code：** 没有 import graph、运行入口和平台构建的完整可达性证明，不声称某个模块可删除。
- **过期依赖：** 没有外部 registry 或 advisory 证据，不做 freshness 排名。
- **质量结论：** LOC、churn 和近似复杂度只用于选择阅读与提取起点，不用于给模块打分。

若要实施上述任一提取，先阅读[模式与约定](how-to-contribute/patterns-and-conventions.md)，并把改动限制在现有深接口与测试门禁内。
