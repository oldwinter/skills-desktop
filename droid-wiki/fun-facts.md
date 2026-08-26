# 代码库趣闻

以下数字按当前检出的工作树统计；路径均从仓库根目录写起。它们更像几枚可复核的“时间胶囊”，而不是质量评分。

## 1. 最老的代码仍完整住在原型里

按本仓库的 Git 历史，现存最早的源码来自 **2026-08-20 18:16:22 +08:00** 的首个提交 `cbb18b2`。`git blame` 显示，[`prototype/src/main.js`](../prototype/src/main.js) 的 **812 行**和 [`prototype/src/styles.css`](../prototype/src/styles.css) 的 **1,920 行**，目前仍全部追溯到这一个提交。也就是说，原型不只被保留了下来，这两块最大的原型源码至今还保持着初次入库时的样子。

## 2. 仓库的第一步其实是一次“带出处的搬家”

首个提交的标题是 `Initial commit: import Skills Desktop prototype`，共加入 **23 个文件、4,587 行**。更早的来源也没有成为口耳相传的谜：[`README.md`](../README.md) 从首个提交起就注明，原型来自 **SimplexAI Agent-First Control Plane** 的提交 `e4c5cb0f41a1944b369fbe20da72af456f806d2f`。今天的 [`prototype/README.md`](../prototype/README.md) 仍明确把它称为一次性设计证据，而非生产依赖。

## 3. 最长的实现文件，正好对应“深模块”决策

`wc -l` 的当前结果中，最长的生产实现是 [`apps/desktop/src/main/application/desktop-capabilities.ts`](../apps/desktop/src/main/application/desktop-capabilities.ts)，有 **4,011 行**；同目录测试 [`apps/desktop/src/main/application/desktop-capabilities.test.ts`](../apps/desktop/src/main/application/desktop-capabilities.test.ts) 更长，达到 **6,936 行**。二者都在 **2026-08-21** 的本地 Inventory 提交 `7045e90` 中首次出现，当时分别只有 439 行和 587 行。这个体量并非偶然失控的命名：[`docs/adr/0010-center-production-on-desktop-capabilities.md`](../docs/adr/0010-center-production-on-desktop-capabilities.md) 明确选择用一个窄接口后的深主进程模块集中状态、授权、审阅和执行顺序。

## 4. 维护标记是一个干净的零

对 Git 跟踪的 **152 个** `ts`、`tsx`、`js`、`jsx`、`mjs`、`cjs`、`css` 和 `html` 文件做不区分大小写的整词复核后，`TODO`、`FIXME`、`HACK` 合计 **0 处**。这不表示仓库没有待办事项；它只说明待办没有散落成这三类源码注释。显式的后续工作更适合从 [`docs/adr/`](../docs/adr/) 和 [清理机会](cleanup-opportunities.md) 的证据链继续追踪。

## 5. 四个外部运行时入口，展开成 937 个锁定条目

[`apps/desktop/package.json`](../apps/desktop/package.json) 列出 **6 个**运行时直接依赖，其中 **2 个**是仓库内部 workspace；外部入口实际只有 `lucide-react`、`react`、`react-dom` 和 `zod` **4 个**。但包含构建、测试、打包工具及其传递依赖后，[`package-lock.json`](../package-lock.json) 的 npm v3 `packages` 映射里共有 **937 个含 `node_modules/` 的条目**。这是桌面工具链常见的“水面下部分”，也解释了为什么根 [`package.json`](../package.json) 会固定关键版本并覆写少数传递依赖。

## 继续探索

- 想沿提交和决策继续回看，见[仓库沿革](lore.md)。
- 想看更完整的规模统计，见[数字看仓库](by-the-numbers.md)。
- 想把趣闻转成可行动的维护线索，见[清理机会](cleanup-opportunities.md)。
