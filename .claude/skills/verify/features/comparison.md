# Comparison

操作者把两个 Local Target 的 inventory 按 skill 对齐，读左右差异并只看差异项。当前产品是 Local-only，所以只有存在第二个 Target Definition 时才有意义。

## Sub-features

- 左右 Target 选择（`Paired Targets`）与 `Swap comparison Targets`
- `Compare` 生成对齐表
- 差异过滤 `Differences only`
- 选中差异的 `Selected comparison evidence`
- 空态：只有一个 Target 时显示 `Needs a second Local Target` 与 `No comparison selected`

## How to get to it (user POV)

1. 主导航点 `Comparison`（`aria-current="page"`）。
2. 只有 `This device` 一个 Target 时，页面标题下是 `Needs a second Local Target`，左右两侧都显示 `This device / workspace`，下面两张空态卡：`No comparison selected` / `No difference selected`。
3. 顶栏的 `Targets` 面板（`This device / workspace`、Harness、Project/Global 计数）始终可见，是同一 Target 的投影。
4. 先在 `Targets` 里 `New Target` 建第二个 Local Target，再回来才有可比的左右两侧；`Compare` 只在两侧不同时才可用。

## Driving it with the CDP harness

```bash
node .claude/skills/verify/scripts/drive.mjs --feature views
```

`views` 会点 `Comparison`，断言 `aria-current="page"`、`Needs a second Local Target`、`Paired Targets` 存在，然后继续其它视图。手工复核：

```js
// 伪代码：由 drive.mjs 或 CDP REPL 执行
page.evaluate(`document.querySelector('button[aria-label="Comparison"]').click()`);
page.waitFor(`document.querySelector('button[aria-label="Comparison"]').getAttribute("aria-current") === "page"`, "comparison");
```

证明结束态：`h1`/`h2` 为 `Comparison`、出现 `Needs a second Local Target`（单 Target 时）、`Paired Targets` 两个选择器都在、`Compare` 按钮存在、左右卡片各显示 Target 名与 `Fresh evidence`。

## Gotchas

- **单 Target 是当前真实状态**，不是回归：fixture 只建一个 Local Target，`Compare` 不会产出表格。要证明真正的差异表，先在 `Targets` 建第二个 Definition，别改断言迁就单 Target。
- 不要为了造第二个 Target 去复用开发者自己的 Target 定义；fixture 的 `state` 是隔离的，新建即可。
- `Differences only` 在没有比较结果时是禁用态；点击不会报错也不会有变化。
- 左右两侧的 “Target” 是同一个 `This device` 时，`Compare` 的提示是 `Choose different Left and Right Targets…`，不是错误。
