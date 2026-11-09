# Inventory

操作者在主窗口看一个原子快照：项目 + 全局两个 scope 的技能、来源、harness、证据（修订/指纹），并按搜索和 scope 过滤。右侧证据面板给单条技能的完整字段和下一步动作。

## Sub-features

- 快照摘要行：`2 skills across project and global scopes`、`N shown`、`Fresh evidence`
- 搜索框 `Search inventory`（按 skill 名/来源实时过滤）
- scope 过滤：`All scopes` / `Project scope` / `Global scope`
- `Update scope`（重新取数）、`Refresh inventory`
- 技能表：列 `Skill` / `Scope` / `Harness` / `Declared source` / `Evidence`
- 选中行的证据面板：Scope、Harness、Source type、Declared source、Revision、Content fingerprint
- 动作：`Prepare update` / `Prepare removal`（进入 Trusted Review）、`Add Skill` 表单（GitHub source + Exact skill name + Project/Global scope + `Prepare add`）
- 空态/错误态：`Retry opening inventory`、`Cancel refresh`

## How to get to it (user POV)

1. 启动应用即落在 Inventory（主导航第一项，`aria-current="page"`）。
2. 顶部摘要应显示 fixture 的两条技能：`qa-project-skill`（Project / codex / `example/skills-desktop-qa`）与 `qa-global-skill`（Global / codex / `Provenance unavailable`），两者的 Revision 都是 `Unknown revision`。
3. 在搜索框输入 `qa-global-skill`：`N shown` 变成 `1 shown`，表格只剩全局那条。
4. 点 `Clear inventory search` 回到两条。

## Driving it with the CDP harness

```bash
node .claude/skills/verify/scripts/drive.mjs --feature inventory
```

稳定 handle（来自 `apps/desktop/src/renderer/features/**`，不要用坐标）：

| 区域 | handle |
| --- | --- |
| 主导航 | `nav[aria-label="Primary"] button`（顺序 Inventory/Comparison/Collections/Targets/About） |
| 搜索 | `input[aria-label="Search inventory"]` |
| 清空搜索 | `button[aria-label="Clear inventory search"]` |
| 刷新 | `button[aria-label="Refresh inventory"]` |
| scope | 文本按钮 `All scopes` / `Project scope` / `Global scope` |
| 表格行 | `tbody tr`；列文本为 skill / scope / harness / source / evidence |
| 证据面板 | `dl.evidence-list[aria-label="Skill evidence details"]`、`[aria-label="Selected skill evidence"]` |
| Target 摘要 | `[aria-label="Target summary"]` |
| 动作 | 文本按钮 `Prepare update` / `Prepare removal` / `Prepare add` |

证明结束态：标题 `Skills Desktop`、`h1` 为 `Inventory`、导航顺序一致、行数 ≥ 2；搜索后 `1 shown` 且只剩 `qa-global-skill`；清空后 `2 shown`。截图 `01-inventory.png` / `02-inventory-search.png`，断言值写进 `drive.json`。

## Gotchas

- 搜索是受控输入：直接改 `input.value` 不触发 React，必须用 `HTMLInputElement.prototype.value` 的 setter + `input` 事件（`drive.mjs` 已这么做）。
- `Unknown revision` / `Unknown` 指纹是 fixture 的真实状态，不是失败；不要为了让页面“更好看”去伪造修订。
- `Prepare update` 对 `Unknown revision` 的技能也可用；它只准备计划，真正执行在 Trusted Review。
- 表格行是 `tbody tr`，不要按 `li` 找（左侧 Target 列表也是按钮不是行）。
- `Update scope` 会重新跑 pinned `npx skills`（fixture 的 stub），比 `Refresh inventory` 重；证明过滤不需要它。
