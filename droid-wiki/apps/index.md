# 应用
活跃贡献者：oldwinter、chendongdong

## 目的

`apps/` 是仓库中面向最终用户的可运行程序层。目前只有 `@skills-desktop/desktop` 一个应用 workspace；它把 React 界面、Electron 窗口与主进程能力组合成 Skills Desktop。当前公开产品边界是 **Local-only V1**：本地技能清单、对比、变更计划与可信确认属于产品路径，仓库中的 SSH 与 remote-bootstrap 代码仍是后续或实验范围。

应用层负责桌面运行时和交互，不重新实现 Skills CLI。所有技能发现和变更最终委托给固定的 `skills@1.5.23`。整体依赖方向与状态所有权见[系统架构](../overview/architecture.md)。

## 目录布局

```text
apps/desktop/assets/                  应用图标
apps/desktop/src/                     主进程、契约、preload 与两个 renderer
apps/desktop/package.json             应用 workspace 元数据和构建脚本
apps/desktop/forge.config.ts          Electron 打包与 maker 配置
apps/desktop/vite.*.config.ts         五个运行时入口的构建配置
```

`apps/desktop/dist/` 和 `apps/desktop/out/` 是生成目录，分别保存 Vite 运行时产物与 Electron Forge 打包结果，不应作为修改入口。

## 关键抽象

- `createCompositionRoot`（`apps/desktop/src/main/composition-root.ts`）把 Electron 环境、持久化、Target、固定 CLI 进程适配器和更新协调器组装起来。
- `DesktopCapabilities`（`apps/desktop/src/main/application/desktop-capabilities.ts`）是应用状态和授权的所有者；应用 UI 不自行维护权威 Inventory 或 Mutation 状态。
- `DesktopBridge`（`apps/desktop/src/contracts/desktop.ts`）与 `ReviewBridge`（`apps/desktop/src/contracts/review.ts`）分别限定普通工作区窗口和独立审阅窗口能够发出的请求。
- `InventoryApp`（`apps/desktop/src/renderer/features/inventory/InventoryApp.tsx`）是普通工作区的 React 外壳，承载 Inventory、Comparison、Collections、Targets 和 About 五个视图。

## 工作方式

根目录 npm workspace 会把 `apps/desktop` 纳入统一的 build、typecheck、lint 和 test 流程。桌面 workspace 的 `build` 脚本依次构建主进程、两个 preload、普通 renderer 和 review renderer；其 `package` 脚本再由 Electron Forge 消费已生成的 `dist/`。

应用启动后只创建一个普通工作区窗口。需要确认受保护操作时，主进程另开一个 Trusted Review 窗口；普通 renderer 只接收可替换的 Snapshot，review renderer 只读取并决定分配给它的单个审阅。窗口角色、IPC 授权和 attachment epoch 的细节见[IPC 与渲染器隔离](../systems/ipc-and-renderer-isolation.md)。

## 集成点

| 集成点 | 作用 |
| --- | --- |
| [skills-runtime](../packages/skills-runtime.md) | 提供固定 CLI 方言、Inventory/Mutation 类型、Harness Registry 与边界解析 |
| Electron | 提供应用生命周期、窗口、IPC、自定义资源协议、更新器和平台打包 |
| React | 实现普通工作区和 Trusted Review 两个独立 UI 入口 |
| `skills@1.5.23` | 执行本地技能发现与变更；应用不复制其发现或安装逻辑 |
| `packages/remote-bootstrap` | 仅服务后续远端实验，不构成 Local-only V1 的已交付能力 |

用户功能索引见[功能](../features/index.md)，发布产物与候选验证见[部署](../deployment.md)。

## 修改入口

- 修改窗口、应用生命周期或生产依赖组装：从 `apps/desktop/src/main/index.ts` 与 `apps/desktop/src/main/composition-root.ts` 开始。
- 修改普通页面和可丢弃的视图状态：进入 `apps/desktop/src/renderer/`，不要把权威状态移入 React。
- 修改可信确认界面：进入 `apps/desktop/src/review-renderer/`，并保持该角色只能决定一个 Trusted Review。
- 修改跨进程形状：先改 `apps/desktop/src/contracts/` 及契约测试，再同步 preload 与主进程 IPC 适配器。
- 修改构建入口或打包内容：检查对应 `apps/desktop/vite.*.config.ts`、`apps/desktop/forge.config.ts` 和 `apps/desktop/package.json`。

更详细的运行入口、窗口角色和产物说明见[桌面应用](desktop/index.md)。

## Key source files

| 文件 | 作用 |
| --- | --- |
| `apps/desktop/package.json` | workspace 标识、运行时依赖、五段式构建和打包命令 |
| `apps/desktop/src/main/index.ts` | Electron 生产入口与窗口生命周期 |
| `apps/desktop/src/main/composition-root.ts` | 生产适配器组装与 Local-only 开关 |
| `apps/desktop/src/contracts/desktop.ts` | 普通窗口公开桥接接口 |
| `apps/desktop/src/renderer/main.tsx` | 普通 React renderer 入口 |
| `apps/desktop/src/review-renderer/main.tsx` | Trusted Review renderer 入口 |
| `apps/desktop/forge.config.ts` | 打包过滤、平台 makers 和 Electron fuses |
