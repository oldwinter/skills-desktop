# skills-runtime
活跃贡献者：oldwinter、chendongdong

## 概览

`packages/skills-runtime` 是私有、ESM、环境中立的 TypeScript 包。它不启动
进程、不读取文件，也不依赖 Electron；唯一运行时依赖是 Zod。包通过
`packages/skills-runtime/src/index.ts` 导出五组共享原语：

1. 固定 `skills@1.5.23` 方言与 Inventory parser；
2. 严格的 Mutation Intent schema；
3. Harness Compatibility Registry v1；
4. 长度前缀 Wire codec；
5. 统一的 `Result` 与公共错误形状。

本地 CLI 适配器、SSH 实验适配器、持久化层和部分公共契约都消费这个包。
renderer 被导入门禁禁止直接依赖它。整体位置见[系统架构](../overview/architecture.md)。

## Inventory parser

`parseCliInventory(output, expectedScope)` 是 `npx skills list --json`
stdout 进入领域模型前的边界。它不会扫描技能目录，也不会从路径推导来源、
revision 或 content fingerprint。

解析流程是 fail-closed 的：

```mermaid
flowchart LR
    Bytes[CLI stdout 字符串] --> Limit[UTF-8 字节上限]
    Limit --> JSON[JSON 数组]
    JSON --> Entry[逐条 Zod 校验]
    Entry --> Scope[匹配预期 scope]
    Scope --> Ext[限制增量字段]
    Ext --> Identity[重复与来源冲突检查]
    Identity --> Normalized[NormalizedSkill 列表]
```

- 方言固定为 `skills@1.5.23`，Inventory schema 版本为 1。
- 整体输出上限为 8 MiB，最多 5,000 条；已知字符串和 agent 数组也各自有界。
- `scope` 必须与本次 project 或 global 调用一致。一个名字出现两次时，
  相同声明来源被视为重复身份，不同声明来源被视为 provenance 冲突；
  两者都会使整次解析失败。
- 上游增加的未知字段会原样放入 `extensions`，但字段数、序列化字节数、
  深度与节点数都有限制。这样可以保留有界的向前兼容证据，而不是无界接受新
  schema。
- 名称和 `(sourceType, source)` 保持大小写和空值原貌。`sourceUrl` 被保留为
  provenance；路径只是证据，不是 Skill Identity。
- 当前 CLI 没有提供权威 revision 或 content fingerprint，因此 parser
  明确把两者设为 `unknown`，不制造应用自定义版本。

`Inventory` 接口在规范化条目外增加 `observedAt`、CLI 版本与 schema 版本；
是否 fresh 或 stale 由上层 Target 会话和持久化逻辑管理。更多生命周期语义见
[Inventory](../features/inventory.md)。

## Mutation schema

`mutationIntentSchema` 是严格的判别联合，只表达命名且有 scope 的意图，
不表达命令文本或任意参数。

| 类型 | 必要信息 | 重要限制 |
| --- | --- | --- |
| `add` | 非空技能名列表、`project`/`global`、GitHub 来源 | 来源为精确 `owner/repo`；可选 revision 必须是 40 位小写十六进制提交 |
| `remove` | 非空技能名列表与 scope | 不接受通配符、flag 或额外字段 |
| `update` | 非空技能名列表与 scope | 只是意图；实际 argv 由受信任适配器规划 |
| `update-all` | scope | 仅存在于本地 Intent schema，不属于当前 Wire mutation |

技能名必须匹配受限标识符语法；列表限制条目数、去重和总字符数。所有对象都使用
strict schema，因此 `command`、`argv`、`flags`、实验操作和选项形状名称会在
spawn 前被拒绝。Intent 仍没有执行权；后续必须绑定 Fresh Inventory、生成计划、
经过可信审阅并执行确认后的参数数组。参见[变更与可信审阅](../features/mutations-and-trusted-review.md)。

## Harness Compatibility Registry

`packages/skills-runtime/src/harness-registry.ts` 把一个受审兼容性表绑定到
`SKILLS_DIALECT_ID = "skills-1.5.23"`。Registry v1 有 77 个精确、区分大小写的
CLI `HarnessId`，并通过固定顺序、规范 JSON 和 SHA-256 摘要参与 Target 与持久化
绑定。

Registry 处理三类不同信息：

- **执行标识**：只有规范 CLI ID 才能进入新执行；展示别名只用于 UI 和精确的
  legacy migration，不会做大小写折叠。
- **scope 能力**：每个 Harness 明确 project/global 支持状态。验证一个集合时，
  不会静默移除不支持项，而是返回整个不支持列表。
- **Inventory 覆盖证据**：把上游 agent token 解释为 `direct`、`shared`、
  `absent` 或 `unknown`。共享 effect group 只表达同一 scope 的已审路径；
  任一未知 token 会使结论保持 `unknown`，而不是猜测。

`normalizeHarnessIds` 去重后按 Registry 顺序输出，因此同一集合有稳定表示。
`packages/skills-runtime/fixtures/skills-1.5.23-harness-registry.v1.tsv` 是与实现分开审阅的证据；
测试同时锁定 TSV 摘要、77 个 ID、规范 JSON 和
`HARNESS_REGISTRY_DIGEST`。新增 Harness 不是运行时发现问题，而是方言与
Registry 的受审升级，具体决策见 ADR 0014。

## Wire framing 与封闭协议

`packages/skills-runtime/src/wire.ts` 当前实现 **Wire Protocol v2**。每帧由 4 字节网络序
（big-endian）payload 长度和 UTF-8 JSON 组成。encoder 先用严格 schema
校验，decoder 支持连续多帧并拒绝截断帧、超限帧、非法 UTF-8、未知键或未知
frame shape。

```text
+----------------------+----------------------------------+
| 4-byte uint32 length | exact UTF-8 JSON payload         |
+----------------------+----------------------------------+
```

当前闭集包含：

- 请求：`observe`、`mutate`、与 `requestId` 匹配的 `cancel`；
- 响应：绑定 bootstrap digest 的 `hello`、project/global JSON 的
  `inventory`、带 process disposition 与 cleanup 证明的
  `mutation-result`、以及有界 `failure`；
- mutation：GitHub `add`、命名 `remove` 和命名 `update`，没有任意 argv。

请求键必须精确匹配；request ID、Harness、绝对 POSIX workspace 和 mutation
内容都有长度或结构限制。workspace 拒绝 NUL、相对路径、`.`、`..` 和中间空
segment。通用帧上限约为 16 MiB 加 64 KiB；请求 payload 上限为 64 KiB，
单个 project/global Inventory JSON 字符串上限为 8 MiB。

模块还导出 validator、encoder 和单帧 decoder 的函数源码字符串。
`remote-bootstrap` 将这些经过同一测试的纯函数嵌入固定模板，避免远端再维护一套
近似实现。

> **协议状态说明：** ADR 0016 接受的产品目标是带 Target Generation、
> 方言、Registry 和 bootstrap 完整绑定的 Wire v3，并增加 source inspection。
> 当前源码常量仍是 v2，不能把现有 codec 或远端包描述为 Wire v3 已交付。
> 公开 V1 仍是 Local-only；后续 SSH 提升必须先完成 ADR 指定的破坏性协议升级
> 与打包门禁。参见[实验性远端传输](../systems/remote-transport-experimental.md)。

## Result 与公共错误

`Result<Value, ErrorValue>` 是以 `ok` 判别的成功/失败联合。默认
`PublicError` 包含：

- 稳定的机器可读 `code`；
- `phase` 与是否 `retryable`；
- 面向调用方的有界 `message`；
- `effects: "none" | "possible" | "confirmed"`，把副作用确定性与进程退出
  分开。

Inventory、Harness 和 Wire 边界使用这一形状返回可公开错误，不把原始进程、
文件系统或 SSH 异常当作 API。Zod schema 的 `parse` 入口仍可能抛出校验异常；
需要非抛出控制流的调用者使用 `safeParse` 或包内返回 `Result` 的函数。

## 扩展与验证

修改此包时应保持运行时中立，并同步检查所有消费者。尤其不要：

- 导入 `node:`、Electron 或应用主进程模块；
- 根据展示文本、路径或上游私有实现发现 Harness；
- 放宽 Intent/Wire 为通用 command、argv 或 URL；
- 把未知 revision、fingerprint 或 Harness token 转成肯定结论；
- 只改 Registry 常量而不更新 fixture、规范摘要和迁移绑定。

代表性测试与实现同目录：

- `packages/skills-runtime/src/inventory.test.ts` 覆盖空来源、增量字段、重复/冲突和字节/深度上限；
- `packages/skills-runtime/src/mutation.test.ts` 覆盖合法闭集以及 wildcard、flag、命令文本等拒绝路径；
- `packages/skills-runtime/src/harness-registry.test.ts` 锁定受审 fixture、摘要、顺序和覆盖语义；
- `packages/skills-runtime/src/wire.test.ts` 覆盖多字节 JSON、多帧、精确请求、污染、截断和超限。

可运行 `npm run typecheck --workspace @skills-desktop/skills-runtime`，
或从仓库根目录运行 `npm run verify` 同时执行导入、测试覆盖率与构建门禁。

## Key source files

- `packages/skills-runtime/src/index.ts`：公共 barrel exports。
- `packages/skills-runtime/src/inventory.ts`：固定 CLI 常量、Inventory 模型与 parser。
- `packages/skills-runtime/src/mutation.ts`：Mutation Intent 严格 schema。
- `packages/skills-runtime/src/harness-registry.ts`：规范 Harness 集、覆盖解释与 Registry 摘要。
- `packages/skills-runtime/src/wire.ts`：Wire v2 frame schema、validator 与 codec。
- `packages/skills-runtime/src/result.ts`：`Result`、`PublicError` 与副作用确定性。
- `packages/skills-runtime/fixtures/skills-1.5.23-harness-registry.v1.tsv`：独立受审 Registry fixture。
- `packages/skills-runtime/package.json`：包入口、Zod 依赖和构建脚本。
- `scripts/check-imports.mjs`：环境中立与跨包导入门禁。

## 相关页面

- [工作区包](index.md)
- [本地 CLI 边界](../systems/local-cli-boundary.md)
- [Inventory](../features/inventory.md)
- [变更与可信审阅](../features/mutations-and-trusted-review.md)
- [数据模型](../reference/data-models.md)
