# 依赖
活跃贡献者：oldwinter、chendongdong

## 口径

本页只统计四个生产 workspace manifest 中直接声明的依赖，不把
`prototype/package.json` 计入生产依赖，也不把 lockfile
中的传递依赖冒充直接依赖。版本来自当前 `package.json`，未联网查询，也不声称它们
是“最新”版本。

可复现安装的完整解析结果见
[`package-lock.json`](../../package-lock.json)；根约束见
[`package.json`](../../package.json)。构建入口见
[配置](configuration.md)。

## 直接依赖数量

| Manifest | `dependencies` 声明 | `devDependencies` 声明 |
| --- | ---: | ---: |
| `package.json` | 0 | 22 |
| `apps/desktop/package.json` | 6 | 10 |
| `packages/skills-runtime/package.json` | 1 | 0 |
| `packages/remote-bootstrap/package.json` | 1 | 0 |
| **合计声明数** | **8** | **32** |
| **去重包名数** | **6** | **32** |

Runtime 的 8 条声明中有重复：Zod 由 desktop 与 skills-runtime 各声明一次；
`@skills-desktop/skills-runtime` 由 desktop 与 remote-bootstrap 各声明一次。
按唯一包名计，runtime 是 4 个外部包加 2 个内部 workspace 包。

## Runtime

| 包 | 固定版本 | 角色 | 声明位置 |
| --- | --- | --- | --- |
| `@skills-desktop/skills-runtime` | `0.1.0` | 环境中立的 CLI/Inventory/Mutation/Registry/Wire 契约 | desktop、remote-bootstrap |
| `@skills-desktop/remote-bootstrap` | `0.1.0` | 固定远端程序；当前是 V1 之外的实验范围 | desktop |
| `react` | `19.2.8` | workspace 与 review renderer | desktop |
| `react-dom` | `19.2.8` | React DOM runtime | desktop |
| `lucide-react` | `1.33.0` | renderer 图标 | desktop |
| `zod` | `4.4.3` | IPC、CLI、persistence 与 Wire 边界 schema | desktop、skills-runtime |

内部包全部 `private: true`，共享应用版本 `0.1.0`，不是独立发布的公共 packages。

## 开发与验证

下表合计 **17** 个直接 dev dependency，服务于 lint、类型、unit/contract test 和
packaged UI QA：

| 用途 | 包与固定版本 |
| --- | --- |
| ESLint/Babel parser | `@babel/core@8.0.1`、`@babel/eslint-parser@8.0.1`、`@babel/parser@8.0.4`、`@eslint/js@9.39.5`、`eslint@9.39.5` |
| React lint | `eslint-plugin-react@7.37.5`、`eslint-plugin-react-hooks@7.1.1`、`globals@17.11.0` |
| 类型 | `@types/node@26.2.0`、`@types/react@19.2.18`、`@types/react-dom@19.2.4` |
| 测试 | `vitest@4.1.11`、`@vitest/coverage-v8@4.1.11`、`jsdom@30.0.1` |
| UI/可访问性测试 | `@testing-library/jest-dom@7.0.1`、`@testing-library/react@16.3.2`、`axe-core@4.13.0` |

Biome 没有写入 manifest；`lint:biome` 通过
`npx --yes @biomejs/biome@1.9.4` 固定按需运行。

## Build 与 package

下表合计 **15** 个直接 dev dependency，参与编译、bundle、候选证据或原生 package：

| 用途 | 包与固定版本 |
| --- | --- |
| TypeScript/Vite | `typescript@7.0.2`、`vite@8.2.2`、`@vitejs/plugin-react@6.1.0` |
| Release metadata | `plist@3.1.1`、`yaml@2.9.0` |
| Electron runtime/package | `electron@43.4.1`、`@electron/fuses@1.8.0` |
| Forge core | `@electron-forge/cli@7.11.2`、`@electron-forge/shared-types@7.11.2`、`@electron-forge/plugin-fuses@7.11.2` |
| Forge makers | `@electron-forge/maker-deb@7.11.2`、`@electron-forge/maker-dmg@7.11.2`、`@electron-forge/maker-rpm@7.11.2`、`@electron-forge/maker-squirrel@7.11.2`、`@electron-forge/maker-zip@7.11.2` |

`electron` 同时是 packaged application runtime 和开发期 Forge 输入；这里按其
manifest 分类放在 build/package，而不是重复计数。

## 根 overrides 与 install controls

根 `package.json` 固定三个传递覆盖：

| 包 | override |
| --- | --- |
| `extract-zip` | `npm:@electron-internal/extract-zip@1.0.5` |
| `tar` | `7.5.22` |
| `tmp` | `0.2.7` |

根 `allowScripts` 只显式允许 `electron-winstaller@5.4.4` 与
`electron@43.4.1` 的 install scripts。`.npmrc` 设置
`allow-git=all`。CI 一律运行 `npm ci`，因此升级直接依赖、override 或 workspace
版本时必须同步审阅并提交根 `package-lock.json`。

依赖自动化配置
`.github/dependabot.yml` 每周检查 npm 与 GitHub
Actions，并把 production/development 更新分组。机器人提议不替代兼容性、
构建、package 与安全门禁。
