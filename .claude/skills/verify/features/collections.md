# Collections

操作者浏览随应用打包的 Official Collections（当前是 `Skills Desktop Starter` / release 1），看每个技能的评估（Missing / Add 等），并按 Target + scope 生成安装计划。计划同样走 Trusted Review，不在这一页直接执行。

## Sub-features

- release 列表：`N bundled releases`、release 名与版本
- `Official Collection details`：description、Status、Independent review、Pinned source、Reviewed revision、Manifest digest、Targets selected
- 评估表：`Include` / `Skill` / `Assessment` / `Action`（fixture 里是 `Missing` → `Add`）
- scope 选择 `Project` / `Global` 与 Target 选择
- `Prepare plan`：生成计划并进入复核

## How to get to it (user POV)

1. 主导航点 `Collections`。
2. 页面标题 `Official Collections`，副标题 `1 bundled releases`。
3. 左列是 `Skills Desktop Starter / release 1`，主区是评估表：`find-skills` 的 Assessment 为 `Missing`、Action 为 `Add`，`Include` 是勾选框。
4. 右侧 details 面板显示 `vercel-labs/skills`、reviewed revision、manifest digest、`Targets selected`。
5. 点 `Prepare plan` 生成计划（真正执行在复核窗口）。

## Driving it with the CDP harness

```bash
node .claude/skills/verify/scripts/drive.mjs --feature views
```

`views` 会进入 `Collections` 并断言 `Official Collections`、`1 bundled releases`、评估表里的 `find-skills`，然后继续 Targets/About/Inventory。手工：

```js
page.evaluate(`document.querySelector('button[aria-label="Collections"]').click()`);
page.waitFor(`document.querySelector('button[aria-label="Collections"]').getAttribute("aria-current") === "page"`, "collections");
```

证明结束态：`h1`/`h2` 为 `Official Collections`、`1 bundled releases`、评估表含 `find-skills` / `Missing` / `Add`、details 面板含 pinned source 与 digest。

## Gotchas

- 评估表的 `Include` 默认不勾选任何项；`Prepare plan` 在没有勾选时不会产出可执行计划。要证明计划，先勾 `Include`。
- `Missing` / `Add` 来自 release 的 `assessments`，是 fixture 状态；不要把它当成“安装失败”。
- `Prepare plan` 之后不要点 `Approve mutation`，那会真的跑 `npx skills`；默认证明止于复核窗口。
- 这一页的 Target 选择与 Inventory 的 Target 是同一个 Definition；不要新建 Target 来“让表格更满”。
