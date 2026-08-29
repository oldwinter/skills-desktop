# 开发工作流

本页把一次贡献从领取工作写到可审阅的 Pull Request。架构规则见[模式与约定](patterns-and-conventions.md)，本地命令见[工具链](tooling.md)。

## 1. 领取 GitHub Issue

工作与规格记录在 `oldwinter/skills-desktop` 的 GitHub Issues 中，PR 不是新的需求或分诊入口。

1. 阅读 Issue 正文、评论、labels、assignees 和依赖，确认它是开放、未阻塞且范围清楚的工作。
2. 开工前把自己设为 assignee；不要让多个贡献者在没有协调的情况下同时实现同一 Issue。
3. 如果缺少决策、复现信息或验收标准，先在 Issue 中补齐；不要靠实现自行决定扩大产品范围。
4. 仅使用仓库规定的五个分诊标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。

使用 GitHub CLI 时，可以先检查再领取：

```bash
gh issue view <编号> --repo oldwinter/skills-desktop
gh issue edit <编号> --repo oldwinter/skills-desktop --add-assignee "@me"
gh issue view <编号> --repo oldwinter/skills-desktop
```

若当前工作属于决策地图，按 `docs/agents/issue-tracker.md` 中的依赖与 `wayfinder:*` 规则处理；普通实现不要伪装成决策完成。

## 2. 在修改前固定边界

修改产品行为前依次阅读：

- `AGENTS.md`、`README.md`、`CONTEXT.md`；
- 与改动相关的 `docs/adr/*.md`；
- 目标模块及其相邻测试；
- 对应的 Wiki 系统页，例如[本地 CLI 边界](../systems/local-cli-boundary.md)、[恢复与持久化](../systems/recovery-and-persistence.md)或[IPC 与渲染器隔离](../systems/ipc-and-renderer-isolation.md)。

然后把 Issue 的验收标准翻译为一个可观察结果，并明确不做什么。尤其要检查：

- 当前 V1 是否仍为 Local-only；
- 是否继续复用固定的 `npx skills`；
- 是否保持 process、SSH、persistence 与 renderer 的窄接口；
- 是否需要 ADR，而不是在代码或 PR 中埋入新的产品决定；
- schema 或持久化格式是否涉及向后兼容。

## 3. 形成最小验证循环

建议按以下顺序迭代：

1. 用现有测试、隔离 fixture 或最小输入复现“现象”。
2. 先在承担该语义的边界补充测试；例如 CLI parser、Command Plan、IPC schema、diff 语义、恢复迁移或 mutation confirmation。
3. 修改最少的生产模块，不把 renderer 变成进程或持久化的所有者。
4. 先运行聚焦测试，再运行同层契约测试。
5. 完成行为变化后运行 `npm run verify`；涉及外部或打包边界时，再选择对应 smoke。
6. 更新受影响的文档，确认文档没有把实验能力写成已交付能力。

测试如何分层见[测试](testing.md)。不要用真实开发者 Inventory 验证破坏性路径；真实 CLI、打包应用和 UI QA 已有隔离 fixture。

## 4. 自查 diff

发起 PR 前至少检查：

- 改动是否只覆盖 Issue 需要的范围；
- 新导入是否符合 `scripts/check-imports.mjs` 的方向；
- renderer 是否只能看到有界公共数据；
- 命令执行是否仍是参数数组与 `shell: false`；
- 恢复状态是否通过具名、版本化 transition 更新；
- 是否意外加入 secrets、raw SSH/CLI output、`coverage/`、`apps/desktop/out/`、`release-candidates/` 或 UI QA 产物；
- 新的状态或错误是否仍保留 freshness、process disposition、effects 等独立维度。

## 5. 编写中文 PR 正文

PR 正文优先使用中文，并采用以下结构：

```markdown
## 现象

<!-- 说明当前错误、缺口或不可验证之处，并链接 Issue。 -->

## 想改成啥

<!-- 说明预期行为、本次实现边界，以及明确不包含的范围。 -->

## 验收标准

- [ ] <!-- 可重复的检查与预期结果 -->
- [ ] <!-- 可重复的检查与预期结果 -->

## 验证

- `npm run ...`：通过 / 结果说明

Closes #<编号>
```

“验收标准”应描述审阅者能确认的结果，而不是只写“代码完成”或“测试通过”。如果 smoke 因平台前置条件没有运行，要明确写出未运行的命令、原因和由哪个 CI job 补足证据。

## 6. 审阅预期

审阅不只检查绿灯。贡献者应预期审阅者核对：

- **规格**：Issue 的现象、目标与验收标准是否全部实现；
- **产品范围**：是否误把 SSH Target、remote bootstrap 或跨机器 reconciliation 计入 V1；
- **架构**：接口是否足够窄，权威状态是否仍在主进程，是否执行了 renderer 生成的文本；
- **安全**：输入是否在边界解析，敏感数据是否被脱敏，持久化和 IPC 是否 fail closed；
- **测试**：测试层次是否与风险匹配，是否覆盖失败、取消、过期、迁移与跨平台行为；
- **文档**：公开说明、ADR、配置和实现是否一致。

收到修改请求后，更新代码、测试和 PR 的验证记录；不要仅在评论中解释一个仍然存在的缺口。

## Definition of Done

- Issue 已领取并由 PR 关联或关闭。
- 实现、测试和文档共同满足明确的验收标准。
- 行为变化通过 `npm run verify`，需要的边界 smoke 已运行或由明确的 CI job 覆盖。
- Local-only、安全、IPC、持久化与 CLI 方言约束没有退化。
- PR 没有无关改动或敏感/生成产物。
- 中文 PR 正文包含“现象 / 想改成啥 / 验收标准”和真实验证结果。
- 必需 checks 通过，审阅意见已落实，最终 diff 可由另一位贡献者独立验证。

发布候选相关工作还应阅读[部署](../deployment.md)；任何安全边界变化都应对照[安全](../security.md)。
