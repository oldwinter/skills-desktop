# Targets

操作者管理 Target Definition：本机的 canonical workspace、harness 集合、显示标签，以及 Local/SSH 种类。当前产品 Local-only，SSH 选项可见但禁用。

## Sub-features

- Target 列表：`This device`、canonical workspace 路径、`Fresh` 状态、Kind、Harness、Connection、`Advanced`
- `New Target` / `New Definition` 表单：Target kind（Local）、Display label、Canonical workspace、Harness、`Save Target`
- `Target Definition editor`（`aria-label`）
- SSH 未开放标记（`aria-label="SSH 未开放"`），在导航与 Targets 视图都出现

## How to get to it (user POV)

1. 主导航点 `Targets`。
2. 页面标题 `1 Target Definitions · V1 is Local-only`，列表里是 `This device` + fixture 的 workspace 绝对路径 + `Fresh` + `Kind=Local` + `Harness=codex` + `Connection=This device`。
3. 点 `New Target` 打开 `New Definition` 表单；`Target kind` 只有 Local，SSH 项标 `SSH 未开放`。
4. 填 Display label / Canonical workspace / Harness 后 `Save Target` 才新增第二个 Definition（Comparison 需要它）。

## Driving it with the CDP harness

```bash
node .claude/skills/verify/scripts/drive.mjs --feature views
```

`views` 会进入 `Targets`，断言 `1 Target Definitions`、`Target Definition editor` 存在、SSH 标记为禁用，然后继续 About/Inventory。手工：

```js
page.evaluate(`document.querySelector('button[aria-label="Targets"]').click()`);
page.waitFor(`document.querySelector('button[aria-label="Targets"]').getAttribute("aria-current") === "page"`, "targets");
```

证明结束态：`h1`/`h2` 为 `Targets`、`1 Target Definitions`、`Target Definition editor` 存在、SSH 入口禁用、列表里能看到 fixture workspace 路径。

## Gotchas

- 保存新 Target 会写 fixture 的本地 state，不碰开发者自己的 Target；可以在同一 run 里建第二个来解锁 Comparison，但建完记得这只是 fixture。
- `Canonical workspace` 必须是真实存在的绝对路径；填相对路径会被拒。
- `Harness` 是固定枚举（当前 fixture 只有 `codex`），没有“全部”选项。
- SSH 相关按钮是**有意禁用**的真实状态，不要为了截图去绕过 `aria-disabled`。
