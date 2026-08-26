# 贡献指南

本仓库的贡献流程以 GitHub Issue 为工作单元，以可复现的验证证据为合并条件。当前 V1 的公开承诺仍是 **Local-only**：仓库中存在 SSH 与远端传输实验，不表示它们已经成为 V1 功能或验收范围。

## 从哪里开始

1. 先按[开发工作流](development-workflow.md)领取 `oldwinter/skills-desktop` 的 GitHub Issue，并确认现象、目标和验收标准。
2. 按[模式与约定](patterns-and-conventions.md)找到正确的模块边界；修改产品行为前阅读 `AGENTS.md`、`README.md`、`CONTEXT.md` 和相关 `docs/adr/*.md`。
3. 在最窄的可验证层完成改动，再按[测试](testing.md)选择单元、契约或 smoke 层次。
4. 遇到失败时从[调试](debugging.md)列出的边界入口排查，不用放宽 schema、执行任意 shell 文本或手工篡改恢复记录来绕过错误。
5. 提交前用[工具链](tooling.md)中的质量门禁检查类型、lint、导入方向、覆盖率与构建。

## 贡献边界

- Skill 发现与变更必须继续委托给固定的 `npx skills` CLI，不能新增目录扫描器作为第二套真相。
- renderer 只能使用公开、版本化、有限长的合约；进程、持久化、确认与执行权留在主进程。
- 命令预览只用于审阅，执行必须使用主进程保存的参数数组。
- Snapshot 恢复后只能是 stale；一次成功、完整的新观察才能把它替换为 fresh。
- 不得提交凭据、签名材料、敏感 SSH/CLI 原始输出或生成的 UI QA 截图与视频。
- 原型只是交互证据，不能把 `prototype/` 中的样例数据、字符串命令或单体 UI 直接提升为生产实现。

## Pull Request 最小信息

PR 正文优先使用中文，并明确列出：

- **现象**：现在有什么问题或缺口；
- **想改成啥**：预期行为与本次范围；
- **验收标准**：审阅者可以重复执行的检查与预期结果。

完整模板、Issue 关联方式和审阅预期见[开发工作流](development-workflow.md)。

## Definition of Done

一项工作只有在以下条件都满足时才算完成：

- 对应 Issue 已领取，改动与其验收标准一致，没有暗中扩大 V1 或发布范围；
- 行为变化在正确边界有测试，失败路径、敏感数据脱敏和跨平台差异得到覆盖；
- 行为变化已通过 `npm run verify`，并按风险补跑真实 CLI、打包 Electron 或 UI QA；SSH smoke 只能作为后续架构证据；
- 相关用户文档、系统文档或 ADR 与实现保持一致；
- diff 不含凭据、原始敏感输出、临时 fixture、coverage、打包产物或视觉 QA 产物；
- PR 正文包含“现象 / 想改成啥 / 验收标准”，并记录实际执行的验证命令和结果；
- CI 通过，审阅意见已处理，审阅者能够从 Issue、代码、测试和文档追溯同一项行为。

开始搭建本地环境可先阅读[开始开发](../overview/getting-started.md)，安全边界见[安全](../security.md)。
