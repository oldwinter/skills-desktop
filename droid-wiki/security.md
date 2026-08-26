# 安全边界

Skills Desktop 的当前公开承诺是 **Local-only V1**：支持本机 Inventory、持久化后以 stale 恢复的 Snapshot，以及经过可信审阅的本地变更。SSH Target、`packages/remote-bootstrap` 和跨机器协调仍是树内实验，属于 **out-of-V1**，**不在 V1 支持面内**。源码存在、测试通过或候选包内含有远端 bundle，都不等于远端能力已经交付。

## 信任分区

| 分区 | 可以做什么 | 不能获得什么 |
| --- | --- | --- |
| 普通 workspace renderer | 读取有界 Snapshot；请求刷新、计划、比较、审阅和 About 操作 | Node.js、Electron 对象、文件系统、进程、任意 IPC、确认或执行权 |
| 独立 review renderer | 读取主进程分配的一项不可变审阅；批准或拒绝 | argv、环境、通用 token、renderer 自带的 plan |
| Electron main | 校验 sender 和 schema；拥有状态、持久化、审阅绑定、进程与更新协调 | 不把 renderer 展示文本当作执行输入 |
| `npx skills` | 作为安装状态和变更结果的权威来源 | 应用不会自行扫描 Skill 目录来建立第二份权威清单 |

更完整的组件关系见[系统架构](overview/architecture.md)。

## Renderer sandbox 与资源加载

`apps/desktop/src/main/adapters/electron-security.ts` 对 workspace 和 review 两类窗口使用同一组基础限制：

- `contextIsolation: true`、`sandbox: true`、`webSecurity: true`；
- `nodeIntegration: false`、`webviewTag: false`，打包构建关闭 DevTools；
- 只允许精确的角色 URL：`skills-desktop://workspace/index.html` 和 `skills-desktop://review/index.html`；
- 拒绝新窗口、意外导航、webview、权限请求、下载和远端连接。

`skills-desktop:` 自定义协议只映射到对应 renderer bundle 根。处理器会拒绝未知 hostname、路径逃逸和解码错误，并通过 `realpath`、根目录前缀检查和 `O_NOFOLLOW` 防止符号链接越界；只返回不超过 20 MiB 的普通文件。响应采用 deny-by-default CSP，包括 `default-src 'none'`、`connect-src 'none'`、`object-src 'none'`、`frame-ancestors 'none'`，并设置 `nosniff` 与同源 opener policy。

## 角色、URL 与 epoch 授权

`apps/desktop/src/preload/workspace.ts` 和 `apps/desktop/src/preload/review.ts` 通过 `contextBridge` 分别暴露冻结的 `skillsDesktop` 与 `skillsReview`。它们只提供用途明确的方法，不暴露 `ipcRenderer`、通用 channel、文件或进程 API。

`apps/desktop/src/main/adapters/electron-ipc.ts` 为每个 live `WebContents` 登记：

- 精确 `WebContents.id`；
- `workspace` 或 `review` 角色；
- 角色对应的精确主 frame URL；
- 本次 attachment 的随机 `attachmentEpoch`；
- main-owned `DesktopSession`。

每次调用都必须同时匹配当前 epoch、已登记的 `WebContents`、角色、主 frame 和精确 URL。旧 document、subframe、错误角色或已重新 attach 的调用会得到有界 `unauthorized`，不会进入应用能力层。`apps/desktop/src/contracts/workspace.ts`、`apps/desktop/src/contracts/review.ts`、`apps/desktop/src/contracts/about.ts` 和 `apps/desktop/src/contracts/desktop.ts` 使用严格 Zod schema、封闭 union、协议版本和字段长度上限，在 IPC 两侧解析输入、结果和事件。

事件也不授予权威：Workspace Protocol v2 用 `sessionEpoch`、单调 sequence 和 state revision 标识顺序；发生缺口或缓冲溢出时，renderer 必须重新读取完整 Snapshot。详见 [IPC 与渲染器隔离](systems/ipc-and-renderer-isolation.md)。

## 本地进程边界

`apps/desktop/src/main/adapters/local-skills-process.ts` 只调用固定方言 `skills@1.5.23`：

- 通过 executable 与参数数组调用 `npx --yes skills@1.5.23 ...`，始终 `shell: false`；
- 先检查精确 CLI 版本，再执行 project/global Inventory 或主进程私有的变更 argv；
- renderer 可见的 Command Plan preview 只是说明文本，绝不回流为执行输入；
- 只继承 `APPDATA`、`ComSpec`、`HOME`、`LOCALAPPDATA`、`NPM_CONFIG_CACHE`、`PATH`、`PATHEXT`、`SystemRoot`、`TEMP`、`TMP`、`USERPROFILE` 中适用于当前平台的值；
- 固定 cwd 为 Target workspace，并限制执行时间和输出字节数；
- stdout 经权限受限的临时文件捕获，stderr 只在受控边界内处理；取消、超时和输出超限会终止整个受管进程树。

这实现了 ADR 0002 的核心要求：renderer 只能提交结构化 Mutation Intent；main 生成和保留真正 argv；解释性 shell 文本没有进程权限。

## 可信审阅与 Mutation Guard

本地变更遵循：

```text
Mutation Intent → Prepared Mutation → Trusted Review
→ durable Mutation Guard → Confirmed Mutation → postflight Inventory
```

普通 renderer 只能用标识符请求打开审阅。独立 review renderer 的 `ReviewBridge` 只有 `getReview()`、`approve()` 和 `reject()`；批准请求不携带 plan、argv 或确认 token。main 将审阅绑定到一项私有 Prepared Mutation，并在执行前重新验证过期时间、摘要、Target Generation、Fresh Inventory、Target binding 和 Guard 状态。确认是单次使用的，不能重放或挪用于另一项计划。

`apps/desktop/src/main/persistence/recovery-records.ts` 要求 Guard 在进程启动前 durable。Guard 只保存恢复所需的操作标识、阶段、deadline、effects certainty，以及 Target、dialect、registry、Harness set 和 binding digest；不保存 intent、Skill 名、argv、preview 或确认权。进程终止不确定、后置观察失败或应用重启时，Guard 保留并进入 Reconciliation Required，阻止继续变更或删除 Target。

## 持久化 allowlist 与失败关闭

`RecoveryRecords` 不是通用 JSON store。其持久化面由具名 `DurableChange` 和严格 schema 限定：

- 每个 Target 最多一份完整 Inventory Snapshot，且重启恢复后一律是 stale，不能授权变更；
- Target Definition 只保存应用所需的非秘密配置；Host Trust 只保存公开 host key；
- Prepared/Confirmed Mutation、确认 token、审阅 challenge、可执行计划、比较、renderer Snapshot、原始 stdout/stderr、环境和未知 CLI 字段都不落盘；
- 文件通过同目录 `wx`、`0600` 临时文件写入并 flush，再原子 rename；POSIX 上同步父目录，写入在单 writer lock 下串行；
- 新于当前应用的 schema 不会被旧版本覆盖；迁移先校验并保留备份；
- corrupt 或迁移失败的数据被 quarantine。Guard、Target 和 Host Trust 还使用 failure marker，避免损坏状态被误当成空状态。

Inventory store 可重新观察；Target、Host Trust 或已初始化 Guard store 无法安全读取时则 fail closed。详细恢复语义见[恢复与持久化](systems/recovery-and-persistence.md)。

## Electron fuses

`apps/desktop/forge.config.ts` 在打包时应用 Electron Fuse V1：

- 开启 cookie encryption 与 embedded ASAR integrity validation；
- 只允许从 ASAR 加载应用代码；
- 关闭 `RunAsNode`、Node CLI inspect 参数和 `NODE_OPTIONS`；
- 不授予 `file:` 协议额外权限。

这些 fuse 加固运行时逃逸面，但不替代平台签名、notarization 或发布验证；当前公开产物仍是 unsigned preview。

## 数据脱敏与诊断

跨 renderer 和诊断边界只传递稳定错误码、阶段、是否可重试和 effects certainty 等 allowlisted 字段。异常、stack、原始 payload、文件路径、主机细节、argv、环境值、stdout/stderr 和 SSH stream 不直接跨界。`apps/desktop/src/contracts/about.ts` 的 release diagnostics 只允许应用身份、候选身份、固定错误、Guard 原因和更新/重启状态；不包含 Target Definition、host trust、Inventory 内容、Guard payload 或原始日志。

本机 Target label、workspace 和 OpenSSH alias 仍可能是敏感的本地配置；“未进入诊断导出”不表示它们适合公开分享。

## SSH 实验代码的边界

`apps/desktop/src/main/ssh/openssh-target.ts` 和 `packages/remote-bootstrap` 体现的是后续设计，不是 V1 支持声明。该设计把凭据继续交给系统 OpenSSH：Skills Desktop 不保存私钥或密码；连接引用、解析后的配置和 host key review 使用参数数组、固定选项、输出上限和短期 challenge。即使这些防护存在，外部 SSH、远端 Inventory、远端 mutation 与 cross-machine reconciliation 尚未完成 V1 发布门禁，当前故障与漏洞响应范围仍以 Local-only 为准。实验细节见[remote-bootstrap](packages/remote-bootstrap.md)。

## 漏洞报告

请通过 GitHub Security Advisories 私下报告：

<https://github.com/oldwinter/skills-desktop/security/advisories/new>

不要为尚未披露的漏洞创建公开 Issue。项目目标是在 7 天内确认收到；修复时限取决于严重性及其是否影响 Local-only V1。当前 V1 报告范围不包括明确标注为实验的 SSH/远端路径，也不把签名密钥和 release attestation 当作已经承诺的 V1 安全面。

## 相关页面

- [系统架构](overview/architecture.md)
- [IPC 与渲染器隔离](systems/ipc-and-renderer-isolation.md)
- [恢复与持久化](systems/recovery-and-persistence.md)
- [更新协调](systems/updates.md)
- [构建与发布](deployment.md)
- [配置参考](reference/configuration.md)
