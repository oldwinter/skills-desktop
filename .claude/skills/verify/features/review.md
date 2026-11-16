# Trusted Review

独立复核窗口：workspace 里 `Prepare update` / `Prepare removal` / `Prepare plan` 之后，操作者在**另一个窗口**看计划摘要，只有 `Approve mutation` 才真的执行，`Reject` 只关闭。默认焦点落在 `Reject`，避免回车误批。

## Sub-features

- 复核入口：workspace 里的 `Open Trusted Review`
- 复核窗口：独立 target `skills-desktop://review/index.html`，标题 `Skills Desktop Trusted Review`
- 只暴露两个能力：`Reject` / `Approve mutation`
- 初始焦点在 `Reject`，Tab / Shift+Tab 焦点被限制在 `main.review-surface`
- `reject` 后复核窗口关闭，不执行 mutation

## How to get to it (user POV)

1. Inventory 选中 `qa-project-skill`，点证据面板的 `Prepare removal`。
2. workspace 出现 `Open Trusted Review`；点它（或聚焦后按 Enter）打开复核窗口。
3. 复核窗口显示计划摘要，焦点在 `Reject`；`Approve mutation` 在右侧。
4. 点 `Reject`（或 Esc，如果版本支持）→ 窗口关闭，技能仍在。

## Driving it with the CDP harness

```bash
node .claude/skills/verify/scripts/drive.mjs --feature review
```

步骤：`Prepare removal` → 等 `Open Trusted Review` → 点开 → `CdpPage.connect(port, "skills-desktop://review/index.html", {expectedTitle: "Skills Desktop Trusted Review"})` → 断言焦点 `Reject`、按钮集合 `["Reject","Approve mutation"]` → 截图 → 点 `Reject` → 用 `GET /json/list` 确认 review target 消失。

证明结束态：review 窗口标题、初始焦点、按钮集合三项都对；`Reject` 之后 target 列表里没有 `skills-desktop://review/index.html`；截图 `02-trusted-review.png` 能看出计划摘要和两个按钮。

## Gotchas

- **不要**点 `Approve mutation` 做默认证明：它会真的执行布局在 fixture 上的 `npx skills`，把“读”变成“写”。要验证 approve 路径时另起一次性 fixture，并明确记录副作用。
- 复核是独立窗口（独立 CDP target），不是 workspace 里的 modal；在 workspace 的 DOM 里等它是等不到的。
- 初始焦点依赖 workspace 窗口是 active：`drive.mjs` 直接点按钮，不依赖 `document.hasFocus()`；仓库 QA 会用 `Page.bringToFront` 再验焦点。无头/失焦环境下焦点断言可能给出 `workspace-unfocused`，那不是产品回归。
- `Reject` 之后 target 关闭有短暂延迟；用 `GET /json/list` 轮询，不要用固定 `sleep` 代替断言。
- mutation 计划只对当前 Target 有效；切 Target 会让旧计划失效，需要重新 prepare。
