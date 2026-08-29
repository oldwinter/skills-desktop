# 原型与产品演进

`prototype/` 是一次被保留的交互实验，不是生产代码的早期版本。它帮助团队选择信息架构、确认固定 CLI 能提供哪些证据，并暴露远端、Collection 和命令预览仍缺少哪些生产合同。产品随后在 TypeScript/Electron 工作区中重新实现这些结论。

## 导入来源

根 [`README.md`](../../README.md) 记录了完整出处：原型从 **SimplexAI Agent-First Control Plane** 的提交 `e4c5cb0f41a1944b369fbe20da72af456f806d2f` 导入。本仓库保留该来源，是为了让概念和视觉选择可追溯，而不是把原型当作生产依赖。

`prototype/README.md` 对边界写得很直接：

- Electron 模式会通过真实、只读的 `npx skills list --json` 读取当前工作区；
- 浏览器模式、SSH Snapshot 和 Collection catalog 使用样例数据；
- add、remove、update 与远端命令形状只展示，不执行；
- 没有生产持久化、更新器、打包、完整错误恢复或广泛测试；
- 唯一的 Electron smoke 只锁定本地 list IPC 边界。

这些限制决定了原型可以证明“界面是否看得懂”，不能证明“副作用是否安全”或“远端能力是否交付”。

## Variant A、B、C 的结论

[`prototype/VERDICT.md`](../../prototype/VERDICT.md) 没有选出三个并列产品，而是给一个产品分配了三种任务密度。

| Variant | 原型关注点 | Verdict |
| --- | --- | --- |
| A | Inventory-first；固定 scope tree、中央 Inventory、右侧 inspector | 作为 V1 Local Inventory 主壳 |
| B | Compare-first；成对 Target picker、差异矩阵、摘要 rail | 将 Target 配对和 diff matrix 吸收到独立 Comparison 视图 |
| C | Fleet-first；机器 lane、跨设备 rollout、Collection planning | 保留给 SSH transport 存在后的多设备和 Collection 工作流 |

结论不是“发布 A、B、C 三套 shell”，而是共享同一导航、Target 模型和 Command Plan 边界。Variant 之间验证的是布局语法，不是三个互相独立的状态模型。

## 原型实际证明了什么

### 固定 CLI 可以支撑本地 Inventory

原型 smoke 在当时的机器上用 `npx skills` 1.5.23 渲染出 121 个 project/global 条目。这证明 Electron 可以复用 CLI，而不需要另写目录扫描器。生产实现随后把这条证据收紧为固定 `skills@1.5.23` 方言、有界解析、完整 project/global 原子观察和 stale-on-restore Snapshot。

### 已安装 Skill 没有可安全虚构的语义版本

原型研究发现 `npx skills` 不提供 package-style installed version。于是 UI 只比较 presence、source 和 CLI 明确提供的 revision/hash；没有证据时显示 unknown。这个交互结论后来成为 ADR 0004 的多维 Comparison 语义。

### Harness 比较与设备比较可以共用 Target 语言

Variant B 说明两侧都是 Target descriptor，选择、交换和差异阅读可以复用同一种交互。生产架构后来把 Target 扩展为稳定 `TargetId`、Generation、canonical workspace 和 Harness 集合，并把本地与 SSH 的具体执行隐藏在 `SkillsProcess` 后。原型中的样例 SSH 数据没有自动获得 Target authority。

### Collection 应复用现有安装协议

Variant C 把 Collection 表达成来源和精确 Skill 选择的 metadata。生产 ADR 保留这个方向：Official Collection、Package 或 Imported recipe 最终只能产生普通 Mutation Intent，不能成为第二套 installer，也不能宣称某个 Collection 已“安装”。

### 用户需要在副作用前看到计划

原型确认 add、remove、update、SSH 与 Collection 都需要可检查的 preview。生产架构保留“先看计划”，但改变了 authority：`Command Plan.preview` 是解释文本，真实参数数组由主进程从 normalized intent 生成并私有保存，Trusted Review 也由独立角色决定。

## 生产 tracer 如何吸收证据

| 原型证据 | 生产中的吸收方式 | 没有复制的捷径 |
| --- | --- | --- |
| Inventory-first 三栏阅读线 | React feature view、Snapshot mirror、主进程 Inventory session | 不复制 `prototype/src/main.js` 的单体 UI 和本地状态混合 |
| Target picker 与 diff matrix | 独立 Comparison 视图和多维 freshness/source/harness 结果 | 不把路径、样例 revision 或颜色状态当权威 |
| Collection catalog 与选择 | 经过审阅的 catalog、assessment、普通 child Mutation | 不复制样例 catalog，不增加第二套 installer |
| 命令预览 | 主进程生成的不可执行 Command Plan projection | 不执行 renderer 生成的 shell 字符串 |
| SSH lane 与机器 Snapshot | 后续 Target/SSH 合同、显式 host trust、Wire protocol | 不把样例 SSH Snapshot 当已交付远端能力 |
| 安静、密集的桌面布局 | feature-local renderer、固定上下文、可见状态、窄屏重排 | 不照搬 prototype CSS 或开发用 variant switcher |

生产工作区从以下边界重新开始：

```text
apps/desktop/                  Electron 主进程、preload 与两个 renderer
packages/skills-runtime/      固定 CLI 方言、Inventory/Mutation/Wire schema
packages/remote-bootstrap/    后续 SSH 使用的固定远端入口
```

它们都是私有 workspace，由同一 commit、lockfile 和应用版本构建。`prototype/` 不在生产 workspace 中，也不被 production import。

## 视觉系统留下的影响

[`prototype/DESIGN.md`](../../prototype/DESIGN.md) 把界面定义为“安静的工作间”：左侧 Target context、中间 Skill evidence、右侧可检查计划。颜色只表达 selection、healthy、drift 和 warning，并配合文本或图标；表格在窄屏重排；焦点、40px target、reduced motion 和语义状态从原型阶段就被列为约束。

生产并没有把这些 CSS token 或组件逐字复制，而是把可验证的交互原则带入新的 feature 结构。后续 ADR 0023 又把双语、系统外观、高对比度、缩放、键盘完整性和 native focus restoration 提升为发行 gate，不再只是设计建议。

## 为什么原型继续留在仓库

保留原型有三个实际用途：

1. 解释 Inventory、Comparison 与 Collections 为什么采用当前信息架构；
2. 复现最早的只读 CLI 边界与 variant 取舍；
3. 防止未来维护者把样例数据、command preview 或单体 UI 误认成 production source of truth。

它不应承担新的产品能力。需要修改当前行为时，应从[桌面应用](../apps/desktop/index.md)、[系统架构](../overview/architecture.md)和[架构决策](architecture-decisions.md)进入；需要查看时间线时，见[代码库沿革](../lore.md)。

## 关键来源

| 路径 | 说明 |
| --- | --- |
| `README.md` | 导入来源与当前 Local-only 状态 |
| `prototype/README.md` | 原型运行方式和样例边界 |
| `prototype/VERDICT.md` | A/B/C 取舍与生产实现边界 |
| `prototype/DESIGN.md` | 视觉、布局、响应式和无障碍依据 |
| `docs/adr/0010-center-production-on-desktop-capabilities.md` | 生产工作区、深模块和“不复制原型单体”的决定 |
| `docs/adr/0023-ship-a-native-bilingual-accessible-shell.md` | 生产 renderer、双语和无障碍壳的后续合同 |
