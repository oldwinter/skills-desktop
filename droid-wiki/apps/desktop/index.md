# 桌面应用
活跃贡献者：oldwinter、chendongdong

## 目的

桌面应用是 Skills Desktop 的生产运行壳：它启动 Electron，组装主进程能力，通过两个受限 preload 向两个不同角色的 React renderer 提供窄接口，并把 Vite 产物交给 Electron Forge 打包。业务状态与执行授权留在主进程；UI 只展示投影并发出结构化请求。

当前公开承诺是 **Local-only V1**。`createCompositionRoot`（`apps/desktop/src/main/composition-root.ts`）虽然保留了 SSH 相关适配器装配，但创建能力对象时明确传入 `v1LocalOnlyTargets: true`。因此 SSH Target、远端 bootstrap 和跨机器协调不能按已交付功能理解；当前技能操作都经本地适配器委托给固定的 `skills@1.5.23`。

## 运行入口

`@skills-desktop/desktop` 的 `main` 字段指向 `apps/desktop/dist/main/index.js`，其源码入口是 `apps/desktop/src/main/index.ts`。模块加载时先注册 `skills-desktop:` 特权 scheme，并申请单实例锁；Electron ready 后按以下顺序启动：

1. 调用 `createCompositionRoot`，初始化 `DesktopCapabilities`（`apps/desktop/src/main/application/desktop-capabilities.ts`）及更新协调器。
2. 注册只服务已构建静态资源的 `skills-desktop:` 协议和 IPC handler。
3. 创建普通 workspace 窗口并加载 `skills-desktop://workspace/index.html`。
4. 当主进程收到审阅请求时，创建独立 review 窗口并加载 `skills-desktop://review/index.html`；同一时刻只保留一个 review 窗口。
5. 窗口关闭、正常退出或更新器接管退出时，解除 IPC attachment、停止更新订阅，并调用主能力的 shutdown。

该 workspace 没有单独的 `start` 或 `dev` 脚本。受支持的仓库工作流以构建、测试和打包为主：

```bash
npm run build --workspace @skills-desktop/desktop
npm run typecheck --workspace @skills-desktop/desktop
npm run package --workspace @skills-desktop/desktop
```

第三条命令消费已有 `dist/`，因此应先构建。仓库级完整门禁使用 `npm run verify`；Linux 的构建加打包路径也可使用根脚本 `npm run package:linux`。

## 窗口角色

窗口定义集中在 `apps/desktop/src/main/adapters/electron-security.ts`。两类窗口都启用 sandbox、context isolation 和 web security，关闭 Node integration、webview、权限请求、任意导航和新窗口；生产包还关闭 DevTools。资源由自定义协议提供，而不是直接暴露文件系统。

| 角色 | URL 与 preload | React 入口 | 能力边界 |
| --- | --- | --- | --- |
| Workspace | `skills-desktop://workspace/index.html`；`apps/desktop/dist/preload/workspace.cjs` | `apps/desktop/src/renderer/main.tsx` | 读取 `WorkspaceSnapshot`（`apps/desktop/src/contracts/workspace.ts`），订阅有序事件，准备 Inventory、Comparison、Collection、Target 和 Mutation 请求；不持有确认权 |
| Review | `skills-desktop://review/index.html`；`apps/desktop/dist/preload/review.cjs` | `apps/desktop/src/review-renderer/main.tsx` | 通过 `ReviewBridge`（`apps/desktop/src/contracts/review.ts`）读取一个已绑定的 Trusted Review，并且只能 approve 或 reject |

`InventoryApp`（`apps/desktop/src/renderer/features/inventory/InventoryApp.tsx`）是 workspace renderer 的顶层组件。它首次获取 Snapshot 后订阅事件；若发现 session 或 sequence 不连续，会重新拉取 Snapshot。搜索条件、当前视图、选中条目、表单和焦点恢复属于 React 本地状态，不会成为权威业务状态。

`ReviewSurface`（`apps/desktop/src/review-renderer/ReviewSurface.tsx`）渲染主进程给出的审阅投影，覆盖 Mutation、取消、Collection，以及仍属后续范围的 host trust 投影。投影类型存在不等于对应远端产品能力已在 V1 开放。角色隔离和 IPC 校验的完整说明见[IPC 与渲染器隔离](../../systems/ipc-and-renderer-isolation.md)。

## 目录布局

```text
apps/desktop/assets/                                        平台图标
apps/desktop/src/contracts/                                 Zod schema、Snapshot、请求结果与 bridge 类型
apps/desktop/src/main/adapters/                             Electron、CLI 进程与平台适配器
apps/desktop/src/main/application/                          主编排、对比、合集和更新应用逻辑
apps/desktop/src/main/persistence/                          恢复与更新记录
apps/desktop/src/main/targets/                              Target 接口与本地生产实现
apps/desktop/src/main/ssh/                                  后续/实验范围，不是 V1 交付声明
apps/desktop/src/main/composition-root.ts                   生产依赖组装
apps/desktop/src/main/index.ts                              Electron 入口
apps/desktop/src/preload/workspace.ts                       暴露普通工作区 bridge
apps/desktop/src/preload/review.ts                          暴露审阅窗口 bridge
apps/desktop/src/renderer/features/                         五个 workspace 视图
apps/desktop/src/renderer/main.tsx                          workspace React 入口
apps/desktop/src/renderer/styles.css                        workspace 样式
apps/desktop/src/review-renderer/ReviewSurface.tsx          Trusted Review 页面
apps/desktop/src/review-renderer/main.tsx                   review React 入口
apps/desktop/src/review-renderer/styles.css                 review 样式
apps/desktop/forge.config.ts
apps/desktop/vite.main.config.ts
apps/desktop/vite.preload.config.ts
apps/desktop/vite.review-preload.config.ts
apps/desktop/vite.renderer.config.ts
apps/desktop/vite.review-renderer.config.ts
apps/desktop/package.json
```

测试与实现共置，通常命名为 `*.test.ts` 或 `*.test.tsx`。`apps/desktop/dist/` 和 `apps/desktop/out/` 是可再生结果，不应直接编辑。

## 关键抽象

### 组合根与主进程

`createCompositionRoot` 选择 canonical workspace 和 Electron userData 路径，创建进程 runner、恢复记录、本地 Target/SkillsProcess、更新协调器，最后初始化主进程能力。主编排的内部工作流另见[Desktop Capabilities](../../systems/desktop-capabilities/index.md)；本页只关注桌面壳如何装配它。

`WORKSPACE_URL` 与 `REVIEW_URL`（均定义于 `apps/desktop/src/main/adapters/electron-security.ts`）是允许加载和授权的固定文档身份。窗口在 `dom-ready` 后才附着到 IPC，会在主框架导航或关闭时解除附着。

### 公共契约与 preload

`WorkspaceBridge`（`apps/desktop/src/contracts/workspace.ts`）描述普通窗口的请求面，`DesktopBridge`（`apps/desktop/src/contracts/desktop.ts`）在其上增加 About 和 review-window-closed 订阅。workspace preload 把这些方法冻结后暴露为 `window.skillsDesktop`，并对 IPC 返回值再次执行 Zod parse。

review preload 暴露更小的 `window.skillsReview`：`getReview()`、`approve()` 和 `reject()`。两个 preload 都先等待主进程发送 attachment epoch，随后每次 invoke 都携带该 epoch。

### Renderer 入口

普通 renderer 的 `apps/desktop/src/renderer/main.tsx` 只挂载 `InventoryApp`。该组件根据本地 `view` 状态切换：

- `ComparisonView`（`apps/desktop/src/renderer/features/comparison/ComparisonView.tsx`）
- `CollectionsView`（`apps/desktop/src/renderer/features/collections/CollectionsView.tsx`）
- `TargetsView`（`apps/desktop/src/renderer/features/targets/TargetsView.tsx`）
- `AboutView`（`apps/desktop/src/renderer/features/about/AboutView.tsx`）

这些组件调用 bridge，不导入 Electron、Node 或主进程模块。具体用户能力由[功能索引](../../features/index.md)说明。

## 工作方式

### Snapshot 与请求

workspace renderer 先调用 `getSnapshot()` 建立视图，再消费 `snapshot.changed` 或 `resync.required`。用户动作只构造契约允许的请求；主进程决定请求是否有效、是否需要 Fresh Inventory、是否可进入 Trusted Review，以及执行后如何更新状态。renderer 展示的 `CommandPlan.preview` 只是说明文本，不能作为 shell 命令执行。

review renderer 不订阅整个 workspace。主进程按 review ID 创建受限会话，窗口关闭后只向仍然匹配原 workspace attachment 的拥有者发送生命周期提示，普通 renderer 再负责恢复焦点。

### 构建产物

桌面 workspace 的 build 脚本以固定顺序执行五个 Vite 配置：

| 配置 | 源入口 | 输出 |
| --- | --- | --- |
| `apps/desktop/vite.main.config.ts` | `apps/desktop/src/main/index.ts` | `apps/desktop/dist/main/index.js` 与 sourcemap |
| `apps/desktop/vite.preload.config.ts` | `apps/desktop/src/preload/workspace.ts` | `apps/desktop/dist/preload/workspace.cjs` 与 sourcemap |
| `apps/desktop/vite.review-preload.config.ts` | `apps/desktop/src/preload/review.ts` | `apps/desktop/dist/preload/review.cjs` 与 sourcemap |
| `apps/desktop/vite.renderer.config.ts` | `apps/desktop/src/renderer/index.html` / `apps/desktop/src/renderer/main.tsx` | `apps/desktop/dist/renderer/` |
| `apps/desktop/vite.review-renderer.config.ts` | `apps/desktop/src/review-renderer/index.html` / `apps/desktop/src/review-renderer/main.tsx` | `apps/desktop/dist/review-renderer/` |

主进程按 Node SSR 目标构建，并将 Electron 保持为 external；`zod`、`@skills-desktop/skills-runtime` 和 `@skills-desktop/remote-bootstrap` 被打入主 bundle。两个 preload 输出 CommonJS 单文件：workspace preload 先清空 `dist/preload`，review preload 使用 `emptyOutDir: false` 追加第二个文件。两个 renderer 使用相对资源基址 `./`，以便由自定义 scheme 加载。

### 打包边界

`apps/desktop/forge.config.ts` 只让 `apps/desktop/package.json` 与以下运行时根进入 packager：

```text
dist/main/
dist/preload/
dist/renderer/
dist/review-renderer/
```

应用使用 ASAR，图标作为额外资源进入包；Electron fuses 禁止 RunAsNode、Node CLI inspect 参数和 `NODE_OPTIONS`，并要求从带完整性校验的 ASAR 加载。Forge makers 覆盖 macOS DMG/ZIP、Windows Squirrel 和 Linux DEB/RPM；具体候选构建、签名状态与发布验证以[部署](../../deployment.md)为准。

## 集成点

| 集成点 | 桌面侧连接方式 |
| --- | --- |
| 主编排 | `apps/desktop/src/main/composition-root.ts` 创建并初始化 `DesktopCapabilities`，`apps/desktop/src/main/adapters/electron-ipc.ts` 把窗口会话连接到它 |
| Skills Runtime | 主进程使用其固定方言、Inventory/Mutation 模型和 Harness Registry；详见[工作区包](../../packages/index.md) |
| 固定 Skills CLI | 本地 SkillsProcess 以结构化参数数组调用 `skills@1.5.23`；renderer 不生成可执行命令 |
| Electron | `app`、`BrowserWindow`、`protocol`、`ipcMain`、`autoUpdater` 和 Forge 构成运行及打包边界 |
| 文件系统 | 主进程在 Electron userData 下保存恢复和更新记录；renderer 没有文件系统能力 |
| 后续远端路径 | SSH 和 remote-bootstrap 代码可参与内部装配或构建，但由 Local-only 门禁阻止成为 V1 产品能力 |

总体依赖方向见[系统架构](../../overview/architecture.md)，实现时还应遵循[模式与约定](../../how-to-contribute/patterns-and-conventions.md)。

## 修改入口

| 要修改的内容 | 首选入口 | 同步检查 |
| --- | --- | --- |
| 应用启动、单实例、窗口创建或退出 | `apps/desktop/src/main/index.ts` | `electron-window-lifecycle`、更新退出路径、打包 smoke |
| 窗口安全选项、自定义协议或资源加载 | `apps/desktop/src/main/adapters/electron-security.ts` | URL 允许列表、CSP、路径穿越与窗口安全测试 |
| 生产依赖、workspace 选择或 V1 能力开关 | `apps/desktop/src/main/composition-root.ts` | 保持 `v1LocalOnlyTargets: true`，不要把 SSH 写成已交付 |
| IPC 方法或角色能力 | 先改 `apps/desktop/src/contracts/` | preload、`apps/desktop/src/main/adapters/electron-ipc.ts`、全局 window 类型与契约测试 |
| 普通工作区导航和 Snapshot 消费 | `apps/desktop/src/renderer/features/inventory/InventoryApp.tsx` | 事件缺口重同步、可访问性、焦点恢复 |
| 单个功能视图 | `apps/desktop/src/renderer/features/<feature>/` | 只保存可丢弃 UI 状态，复用 bridge 与公共错误文案 |
| Trusted Review 展示与决定 | `apps/desktop/src/review-renderer/ReviewSurface.tsx` | 保持单审阅绑定和 approve/reject 的窄能力 |
| 新增或调整构建入口 | 对应 `apps/desktop/vite.*.config.ts` | `apps/desktop/package.json` 的构建顺序与 Forge allowlist |
| 平台安装包或 Electron hardening | `apps/desktop/forge.config.ts` | makers、图标、ASAR、fuses 和[部署](../../deployment.md) |

跨 IPC、状态所有权或角色边界的修改不应只改页面组件；先确认公共契约和主进程授权规则。应用层索引见[应用](../index.md)。

## Key source files

| 文件 | 作用 |
| --- | --- |
| `apps/desktop/package.json` | Electron 入口、依赖、构建顺序与 package 命令 |
| `apps/desktop/src/main/index.ts` | scheme、单实例、窗口、IPC attachment 与退出生命周期 |
| `apps/desktop/src/main/composition-root.ts` | 生产依赖组装、持久化位置和 Local-only 门禁 |
| `apps/desktop/src/main/adapters/electron-security.ts` | 固定 URL、窗口选项、自定义资源协议与导航限制 |
| `apps/desktop/src/main/adapters/electron-ipc.ts` | IPC channel、角色授权、会话附着与事件转发 |
| `apps/desktop/src/preload/workspace.ts` | `window.skillsDesktop` 的受限实现 |
| `apps/desktop/src/preload/review.ts` | `window.skillsReview` 的受限实现 |
| `apps/desktop/src/contracts/workspace.ts` | Workspace Protocol v2、Snapshot、请求与公共错误 |
| `apps/desktop/src/contracts/review.ts` | Review Protocol v2、审阅投影与决定结果 |
| `apps/desktop/src/renderer/features/inventory/InventoryApp.tsx` | 普通工作区外壳、导航、Snapshot 同步与 Inventory 页面 |
| `apps/desktop/src/review-renderer/ReviewSurface.tsx` | 独立 Trusted Review 页面 |
| `apps/desktop/vite.main.config.ts` | 主进程 bundle 配置 |
| `apps/desktop/vite.preload.config.ts` | workspace preload bundle 配置 |
| `apps/desktop/vite.review-preload.config.ts` | review preload bundle 配置 |
| `apps/desktop/vite.renderer.config.ts` | 普通 renderer bundle 配置 |
| `apps/desktop/vite.review-renderer.config.ts` | review renderer bundle 配置 |
| `apps/desktop/forge.config.ts` | 运行时文件 allowlist、平台 makers 和 Electron fuses |
