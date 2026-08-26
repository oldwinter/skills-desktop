# 代码库沿革

本页按 Git 可达历史、文件首次出现的提交、tag 时间和 ADR 的演变梳理仓库。历史从 **2026-08-20** 的初始导入开始，到当前 HEAD `5311da1`（**2026-08-26**）为止，共 **177 个提交**。这里区分“已经写入 ADR 的目标架构”“仓库中已有的实验实现”和“通过当前产品验收的能力”；当前结构另见 [项目概览](overview/index.md)，原型关系另见 [原型与产品演进](background/prototype-and-evolution.md)。

## 时代一：原型证据（2026-08-20）

**2026-08-20**，根提交 `cbb18b2` 以“Initial commit: import Skills Desktop prototype”为题导入了 23 个文件。此时仓库主体是 `prototype/`：`prototype/src/main.js` 把主要交互集中在一个 812 行的模块中，`prototype/src/styles.css` 有 1,920 行，另有 Inventory、Diff 和 Fleet 三组概念图。仓库还没有生产 TypeScript/TSX 代码。

**2026-08-20** 的 `prototype/VERDICT.md` 已经留下后来长期存续的产品形状：以 Inventory 为主壳，把成对 Target 选择和差异矩阵放进 Comparison，并把多设备与 Collection 流程留给后续阶段。它也明确把命令预览当作说明文本，而不是执行输入。

这一时代最重要的边界同样写于 **2026-08-20**：`prototype/` 是可丢弃的交互证据，不是生产实现。后来 `apps/desktop/` 没有逐步改造这份单体 JavaScript，而是在 **2026-08-21** 另起生产工作区；因此初始原型是最长存续的交互依据之一，却不是最长存续的代码路径。

## 时代二：ADR 定界与生产 tracer 重写（2026-08-21）

**2026-08-21**，三个连续的决策提交建立了第一版架构骨架：

- **2026-08-21**，`a9b575e` 新增 ADR 0001—0004，确定由固定的 `npx skills` 负责发现和变更、只执行结构化且确认过的操作、把 SSH 秘密留给 OpenSSH，并且只比较权威证据。
- **2026-08-21**，`28fa505` 新增 ADR 0005，把本地 Inventory、准备变更和确认执行收进一个 `LocalSkillsProcess` 生命周期。
- **2026-08-21**，`8e66120` 新增 ADR 0006—0012，补齐 SSH 形状、恢复记录、Collection、Trusted Review、`DesktopCapabilities`、签名发行和分阶段 tracer 验证。

**2026-08-21**，提交 `7045e90` 完成第一次重大重写：它没有提升 `prototype/src/main.js`，而是新建 `apps/desktop/`、`packages/skills-runtime/` 和 `packages/remote-bootstrap/` 三个私有 workspace，并一次引入 58 个文件、约 16,492 行新增内容。阶段末仓库已有 94 个受跟踪文件和约 5,568 行 TypeScript/TSX。`packages/remote-bootstrap/` 当时只是为统一依赖方向预留的工作区；它的出现本身不代表远端产品已经交付。

这一版真正落地的 production tracer 是 **2026-08-21** 的本地 Target Inventory：`apps/desktop/src/main/adapters/local-skills-process.ts` 通过固定 CLI 方言读取 project/global 清单，`packages/skills-runtime/src/inventory.ts` 负责有界解析。到 **2026-08-26**，这条“`npx skills` 是已安装状态权威、应用只保留证据快照”的主线仍然存在，是生产架构中存续时间最长的规则。完整 ADR 脉络见 [架构决策](background/architecture-decisions.md)。

## 时代三：能力快速铺开（2026-08-22）

**2026-08-22** 是功能面扩张最密集的一天，共有 74 个提交按作者日期落在当天。几个阶段性事件依次发生：

- **2026-08-22**，`bbdce5c` 加入安全的本地变更与恢复，形成 Fresh Inventory、Prepared Mutation、确认、Mutation Guard 和后置观察的闭环。
- **2026-08-22**，`e62cea4` 加入 Target 管理与 Comparison，把原型中的成对比较改写到生产 React 和主进程状态模型中。
- **2026-08-22**，`684ace3` 到 `3cc79db` 先后加入 SSH Inventory、显式 host trust、冻结 binding、结构化远端协议和 guarded SSH mutation。
- **2026-08-22**，`5fe5305` 与 `aab229f` 加入 Official Collections 及跨 Target 应用计划，但仍复用普通 Mutation Intent，没有创建第二套安装器。
- **2026-08-22**，`90be693` 开始构建 macOS、Windows 和 Linux 的未签名原生候选，随后又加入主进程拥有的更新检查和候选完整性证据。

**2026-08-22** 的 SSH 代码是 ADR 0006 架构的实验性实现，证明 Local 与 SSH 可以共用 `SkillsProcess` 深接口，也带来了 `packages/remote-bootstrap/` 和 Wire 协议的实际测试面。不过它没有取代本地 tracer 的交付地位：同一天稍后的范围收紧明确把它排除在 V1 公开承诺之外。换言之，仓库里“有 SSH 代码”、ADR 中“接受 SSH 架构”和产品“已经交付 SSH”是三件不同的事。

## 时代四：Local-only 收口与未签名预览（2026-08-22 至 2026-08-23）

**2026-08-22**，提交 `cd0d285` 首次在文档中明确 **V1 Local-only**，把 SSH Target、远端 Bootstrap 和跨机器协调标为后续范围。随后同日的 `73764a8` 隐藏 SSH Target 创建入口，`e46ad02` 在生产 composition 中启用 `v1LocalOnlyTargets`，`c3c58e1` 和 `9e213a2` 又在主进程侧拒绝 SSH Target 草稿、SSH mutation prepare 与 collection prepare。这不是只改界面文案，而是 fail-closed 的验收边界。

**2026-08-23**，这次收口继续扩展到 Collections、已有 SSH Target 编辑和 host-key Trusted Review；`3022aa3` 同日新增 `docs/user-guide.md`，将用户可见行为固定为 Local-only。由此，被替代的不是 ADR 0006 的长期 SSH 安全约束，而是“把 2026-08-22 已写入仓库的 SSH 路径当作 V1 已交付功能”的早期假设。当前实际能力应以本地 tracer、打包 smoke 和用户指南为准。

发行策略也在 **2026-08-22** 发生了窄幅替代。ADR 0011 原先不允许公开未签名的 macOS 或 Windows 产物；`6f79a54` 新增 ADR 0013，只放开有校验和、SBOM 与 attestation 的 **Unsigned Developer Preview**，但保留 ADR 0011 对 Stable Release 的签名、公证、独立批准和更新要求。当天创建了两个 preview tag：

- **2026-08-22 21:26 +08:00**，`preview-v0.1.0-6f79a54a9d223e3d184b75fdc5df3094b4fcee8a` 指向首次发布 attested unsigned preview 的提交。
- **2026-08-22 22:04 +08:00**，`preview-v0.1.0-34ff7b72b63773bfde8b37e6eb01ec44bdb2583f` 指向修复 Finder 根工作区恢复的提交。

这两个 **2026-08-22** tag 都是预览里程碑，不是签名稳定版，也不进入自动更新。构建、候选和预览之间的区别见 [构建与发布](deployment.md)。

## 时代五：可验证性与桌面生命周期加固（2026-08-23 至 2026-08-24）

**2026-08-23** 有 81 个提交，是整个短历史中提交最集中的一天。当天加入 `LICENSE`、`SECURITY.md`、`CONTRIBUTING.md`、CODEOWNERS、Dependabot 和统一 lint；界面侧集中处理不可用原因、错误文案、空状态、窄屏 Target 选择、可点击区域和无障碍名称。`9457552` 在 **2026-08-23** 把 Vitest 80% 覆盖率设为验证门槛，`2efd0b9` 与 `0f538a4` 同日加入隔离的 packaged Electron UI/UX 套件并让 Local-only QA 在每个 V1 桌面构建上运行。

**2026-08-24**，`fbeb6ae` 是第二次明显的横切重写：59 个文件发生变化，新增 8,263 行、删除 952 行。它加强了恢复记录迁移和唯一操作身份、Electron 入口安全测试、Remote Bootstrap 边界、release integrity 工具以及 packaged QA harness。当天后续提交又连续修正 Windows 原生模态窗口后的 Trusted Review 焦点恢复、review 窗口关闭信号和 workspace attachment 绑定。

**2026-08-24**，`6e6fb8c` 进一步加固 tagged unsigned preview 流程。这个阶段没有扩大公开产品范围；它看起来是在把 **2026-08-22** 快速铺开的能力改造成可重复验证、失败时保守恢复的桌面系统。

## 时代六：综合演进架构获接受（2026-08-26）

**2026-08-26**，提交 `5099f16` 一次新增 ADR 0014—0024，并更新 `CONTEXT.md`。这些 Accepted ADR 描述的是 Local 加 POSIX SSH 的后续目标：多 Harness Target、稳定来源检查、Wire v3、Skillpack、Studio、确定性导出、受 Guard 保护的 Git 发布、系统浏览器 handoff、Recovery Center、双语无障碍壳和未签名 mission candidate。ADR 被接受只授权后续实现，不证明对应功能已经通过产品 gate。

**2026-08-26** 的 ADR 0014 接受从“一个 Target 对应一个 Harness”转向“一个 Target 对应非空 Harness 集合”，并窄幅修正 ADR 0001 的“应用不定义 registry”：应用可以为固定 `skills@1.5.23` 方言维护兼容性元数据，但仍不能自行声明已安装状态。`2274821` 先落地包含 77 个 canonical CLI identifier 的 pinned Harness Compatibility Registry；随后 `5311da1` 把 Target Definition、持久化迁移、请求合同和命令计划改为规范化的非空 Harness 集合。这个提交完成了 Target v4 数据合同迁移，但不代表 POSIX SSH 或完整后续产品里程碑已经公开交付。

**2026-08-26** 的 ADR 0016 接受 POSIX SSH 与 Wire Protocol v3，保留系统 OpenSSH、固定远端命令、显式 host trust、新 SSH session 和不确定结果需协调等旧约束，同时替代较早的 Wire 合同。该 ADR 自己规定：SSH Inventory 要等 Milestone 3 的打包 trust/observation gate，SSH mutation 要等 Milestone 4 的 uncertainty/recovery gate。因此截至 **2026-08-26**，accepted SSH architecture 是未来交付合同，实际公开验收仍是 Local-only。

## 长期存续与被替代的设计（截至 2026-08-26）

| 起始或替代日期 | 设计演变 | 截至 2026-08-26 的状态 |
| --- | --- | --- |
| **2026-08-20** | Inventory 主视图、成对 Comparison 和 Collection 作为元数据的交互概念最早出现在 `prototype/VERDICT.md` | 概念继续存在；`prototype/src/main.js` 的单体实现已在 **2026-08-21** 被独立的 TypeScript 生产工作区取代 |
| **2026-08-21** | ADR 0001 把 `npx skills` 设为发现和变更权威 | 仍是最长存续的生产规则；**2026-08-26** 的 registry 只增加固定方言兼容性元数据，不成为第二个已安装状态来源 |
| **2026-08-21 至 2026-08-22** | Typed Intent、Prepared Mutation、Trusted Review、单次确认、Mutation Guard 和 stale Snapshot 逐步形成 | 继续约束 Local-only 已交付路径，也是后来 SSH 架构必须复用的安全边界 |
| **2026-08-22 至 2026-08-23** | 早期把 SSH 实现视作近期 V1 能力的方向被 `v1LocalOnlyTargets` 和用户指南收紧 | SSH 实验代码留在仓库，公开 UI 与主进程都拒绝相应 V1 操作 |
| **2026-08-22** | ADR 0013 窄幅替代 ADR 0011 的“公开渠道一律不得有未签名产物” | 允许 unsigned preview；签名 Stable Release、自动更新和平台信任要求没有被废弃 |
| **2026-08-26** | ADR 0014 接受多 Harness Target，ADR 0016 接受 Wire v3 | pinned registry 与 Target v4 Harness 集合迁移已落地；公开 SSH 仍须后续 tracer 和 gate |

## 增长轨迹（2026-08-20 至 2026-08-26）

下表的提交数按 Git 作者日期统计；文件数和 TypeScript/TSX 行数取该阶段末代表提交的受跟踪树，不包含工作区未提交内容。

| 日期 | 当日提交数 / 累计提交数 | 阶段末代表提交 | 受跟踪文件 | TypeScript/TSX 行数 |
| --- | ---: | --- | ---: | ---: |
| **2026-08-20** | 1 / 1 | `cbb18b2` | 23 | 0 |
| **2026-08-21** | 5 / 6 | `7045e90` | 94 | 5,568 |
| **2026-08-22** | 74 / 80 | `1a27a6b` | 170 | 38,692 |
| **2026-08-23** | 81 / 161 | `0f538a4` | 194 | 43,177 |
| **2026-08-24** | 13 / 174 | `6e6fb8c` | 206 | 50,185 |
| **2026-08-26** | 3 / 177 | `5311da1` | 223 | 52,396 |

这条 **2026-08-20 至 2026-08-26** 的增长曲线不是持续扩张产品承诺：代码量在 **2026-08-22** 因 SSH、Collections、更新和发行路径陡增，公开范围却在同日收回 Local-only；**2026-08-23 至 2026-08-24** 的主要增长来自测试、恢复和桌面生命周期加固；**2026-08-26** 先扩展决策地图，再落地 pinned Harness Registry 和 Target v4 Harness 集合合同。阅读当前能力时，应把这条提交史与 [项目概览](overview/index.md)、[架构决策](background/architecture-decisions.md) 和 [构建与发布](deployment.md) 一起看。
