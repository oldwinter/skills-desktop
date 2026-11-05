---
name: verify
description: "Drive the packaged Skills Desktop Electron app (Inventory, Comparison, Collections, Targets, Trusted Review) against an isolated HOME/workspace fixture, with screenshots and JSON receipts. Use when a change touches the renderer, main-process bridges, packaging, or the pinned `npx skills` integration and you need live proof instead of unit tests."
---

# Verify Skills Desktop

给下一个从没见过这个仓库的 agent。用户真正碰的是**打包后的 Electron 应用**：`Inventory`（项目/全局技能清单与证据面板）、`Comparison`、`Collections`、`Targets`、`Trusted Review` 复核窗口。三块渲染器（workspace / review）通过 preload bridge 找 main 进程，main 用固定的 `skills@1.5.23` CLI 方言取数——所以 `vitest` 全绿不算证明，必须开打包产物。

feature map 在 `features/`。一次证明至少覆盖 map 里的一个 feature；`scripts/drive.mjs` 自带 inventory、views（Comparison/Collections/Targets/About）与 review 三条可执行证明。

## Launch

打包桌面应用是**短生命周期**模型：先构建+打包一次，之后每次 drive 由 harness 用一次性 fixture 起一个独立实例，drive 结束就关。不要常驻一个实例反复用。

```bash
# 1) 构建所有 workspace，再打当前平台的未签名包（macOS 本机打 darwin-arm64）
npm run build
npm exec --workspace @skills-desktop/desktop electron-forge package -- --platform=<platform> --arch=<arch>

# 2) 已有打包产物时跳过上面，直接指向可执行文件
SKILLS_DESKTOP_PACKAGED_EXECUTABLE="/path/to/Skills Desktop.app/Contents/MacOS/skills-desktop"
```

产物默认在 `apps/desktop/out/Skills Desktop-<platform>-<arch>/`（`.gitignore` 里的 `out/`）。`scripts/doctor.mjs` 会核对它和 `apps/desktop/dist/**`。

fixture 由 `tests/packaged-ui-qa/` 负责：独立 `HOME`/`workspace`/config/cache/tmp、stub `npx`（返回固定 inventory）、独立 loopback CDP 端口、独立 `--user-data-dir`。**不要**用开发者自己的 `~/.agents/skills` 或真实 `npx skills` 状态。

## Doctor

任何东西看起来不对时先跑（只读，不启动应用）：

```bash
node .claude/skills/verify/scripts/doctor.mjs
```

通过条件：Node ≥ 22.20；打包可执行文件存在且可执行；`file` 判定的架构与当前 `process.arch` 一致；`axe-core` 可解析；`apps/desktop/dist/{main,preload,renderer,review-renderer}` 四个产物齐全。`ok:false` 时先 `npm run build` + 重新 package，再重跑 doctor。

## Drive

两条自带证明（每条都会自己建 fixture、起应用、截图、写 `drive.json`、最后清理）：

```bash
node .claude/skills/verify/scripts/drive.mjs --feature inventory
node .claude/skills/verify/scripts/drive.mjs --feature views
node .claude/skills/verify/scripts/drive.mjs --feature review
```

- `inventory`：等 `qa-project-skill` 出现 → 断言标题/`h1=Inventory`/主导航顺序 `Inventory, Comparison, Collections, Targets, About`/表格 ≥2 行 → 截图 → 在 `input[aria-label="Search inventory"]` 输入 `qa-global-skill` 断言 `1 shown` → 点 `Clear inventory search` 回到 `2 shown`。
- `views`：依次点 `Comparison` → `Collections` → `Targets` → `About` → `Inventory`，每个视图断言真实内容（`Needs a second Local Target`、`1 bundled releases` + `find-skills`、`1 Target Definitions` + Target Definition editor + SSH 禁用、About 标题、Inventory 两技能摘要）并各截一张图。
- `review`：点 `Prepare removal` → 等 `Open Trusted Review` → 打开 review 窗口（独立 target `skills-desktop://review/index.html`，标题 `Skills Desktop Trusted Review`）→ 断言初始焦点在 `Reject`、按钮只有 `Reject` / `Approve mutation` → 截图 → 点 `Reject` → 断言 review target 关闭。**不要**点 `Approve mutation`：那会真的跑 `npx skills` 改 fixture。

要覆盖全部八个场景（keyboard/focus/axe/narrow/reduced-motion/empty/error/console）时跑仓库既有 QA：

```bash
npm run qa:packaged-ui        # 有图形会话
xvfb-run -a npm run qa:packaged-ui   # 无会话的 Linux
```

它同样一次性起包、跑完自动清 fixture，失败会写受限 `failure.json`。

## Evidence

默认证据根：`.claude/skills/verify/evidence/<UTC 时间戳>-<feature>/`（已 gitignore）。每次 drive 至少留下：

- `01-*.png` / `02-*.png`：动作前后的真实窗口截图（review 的截图在复核窗口里）。
- `drive.json`：`{feature, executable, fixtureRoot, ok, runId, steps[]}`，`steps` 是每步断言的真实返回值。

证明标准：走操作者路径（点按钮、输搜索框、开复核窗口），不是调内部 setter；截图要能看出窗口内容（技能行、复核按钮），不能只拍空白；副作用（fixture inventory、review 目标关闭）与可见状态一起记。fixture 的 `artifacts` 目录是临时目录，teardown 后消失，长期证据只放证据根。

## Cleanup

`scripts/drive.mjs` 在 `finally` 里 `session.close()`（只结束自己 spawn 的 Electron 子进程）+ `fixture.cleanup()`（只删自己 mkdtemp 的根）。`npm run qa:packaged-ui` 自带同样边界。看不到 `ok:true` 时也照样跑一次清理；**不要**按进程名 `pkill`，也不要动开发者自己的 Skills Desktop 实例或真实 HOME。

## Helpers

| 脚本 | 作用 |
| --- | --- |
| `scripts/doctor.mjs` | 只读环境检查（node / 打包产物 / 架构 / axe / dist） |
| `scripts/drive.mjs --feature inventory\|views\|review` | 真窗口 drive + 截图 + `drive.json` |
| `tests/packaged-ui-qa/run.mjs` | 仓库既有 8 场景 QA（复用其 fixture/launch/CDP 模块） |

## 维护

feature map 与当前 UI 脱节时按 `/maintain-verification-skill` 跑一轮；只改本 skill 目录，产品 bug 只记录不修。
