# Feature map

Skills Desktop 的操作者表面。默认用 `tests/packaged-ui-qa/` 的一次性 fixture（stub `npx` + 两条 fixture skill），不要接真实 HOME 或真实 `npx skills`。

| Feature | 表面 | 文件 | 默认证明 |
| --- | --- | --- | --- |
| Inventory | workspace renderer | [inventory.md](inventory.md) | `scripts/drive.mjs --feature inventory` |
| Comparison | workspace renderer | [comparison.md](comparison.md) | `scripts/drive.mjs --feature views`（单 Target 空态；差异表需第二个 Target） |
| Collections | workspace renderer | [collections.md](collections.md) | `scripts/drive.mjs --feature views` |
| Targets | workspace renderer | [targets.md](targets.md) | `scripts/drive.mjs --feature views` |
| Trusted Review | review renderer | [review.md](review.md) | `scripts/drive.mjs --feature review` |

未入图（需要真实 `npx skills` 或远端，先不要当默认环）：

- SSH Target（Milestone 3/4，UI 仍标 `SSH 未开放`）
- 真实 mutation 执行（`Approve mutation` 会改 fixture，默认只验证到复核窗口）
- 自动更新 / Release 通道
