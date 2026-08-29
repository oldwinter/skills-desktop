# 配置
活跃贡献者：oldwinter、chendongdong

## 配置边界

Skills Desktop 是 npm workspaces 仓库。生产包共享一个根 lockfile 和版本，根
`package.json` 要求 Node `>=22.20.0`，GitHub Actions 使用 Node 24。配置事实来自
仓库文件；本页不记录本机环境变量值、令牌或签名材料。直接依赖版本见
[依赖](dependencies.md)。

## npm scripts

根 manifest `package.json` 是日常入口：

| 类别 | script | 实际命令/作用 |
| --- | --- | --- |
| 构建 | `build` | `npm run build --workspaces --if-present` |
| 类型 | `typecheck` | `tsc -b --pretty false` |
| lint | `lint` | `eslint . --max-warnings 0` |
| lint | `lint:biome` | 固定运行 `@biomejs/biome@1.9.4 check apps/desktop/src` |
| 导入边界 | `check:imports` | 运行 `scripts/check-imports.mjs` |
| 测试 | `test` / `test:watch` | Vitest 单次运行 / watch |
| 覆盖率 | `test:coverage` | Vitest V8 coverage |
| 总门禁 | `verify` | typecheck → ESLint → import check → coverage → build |
| CLI smoke | `smoke:cli` | 使用 `vitest.smoke.config.ts`，120 秒 timeout |
| SSH smoke | `smoke:ssh` | 使用 `vitest.ssh-smoke.config.ts`；这是实验门禁，不扩大 Local-only V1 |
| Linux package | `package:linux` | 先 build，再用 Electron Forge package Linux x64 |
| packaged smoke | `smoke:packaged` | Linux package 后以 Xvfb 运行 Electron smoke |
| packaged QA | `qa:packaged-ui` | 对已有 packaged executable 运行隔离 UI QA |
| Linux QA | `qa:packaged-ui:linux` | package Linux 后以 Xvfb 运行 UI QA |
| candidate | `candidate:build` | 运行 `scripts/release/build-candidate.mjs` |

各 workspace 的构建入口：

| Manifest | scripts |
| --- | --- |
| `apps/desktop/package.json` | `build` 依次构建 main、两个 preload、两个 renderer；另有 `typecheck`、`package` |
| `packages/skills-runtime/package.json` | `build: tsc -b`、`typecheck` |
| `packages/remote-bootstrap/package.json` | `tsc -b` 后用 release Vite config 生成固定 bundle；另有 `typecheck` |

## 环境变量

### 产品与本地运行

| 名称 | 读取位置 | 语义 |
| --- | --- | --- |
| `SKILLS_DESKTOP_WORKSPACE` | `apps/desktop/src/main/composition-root.ts` | 非空时作为启动 workspace 候选，经 `resolve()` 与 `realpath()` 规范化；必须指向已存在路径。未设置或为空时，组合根按启动 cwd 与 home 的既定规则选择。它只选择本地 workspace，不是 TargetId、命令或远端配置。 |

生产源码没有读取 `SKILLS_DESKTOP_QA_*`。这些变量只属于 packaged QA harness：

| 名称 | 用途 |
| --- | --- |
| `SKILLS_DESKTOP_PACKAGED_EXECUTABLE` | 覆盖待测 packaged binary；未设置时从 `apps/desktop/out/Skills Desktop-<platform>-<arch>/` 推导。 |
| `SKILLS_DESKTOP_QA_ARCH` | 可选的运行时架构断言，只接受 `x64` 或 `arm64`；CI 从 matrix 注入。 |
| `SKILLS_DESKTOP_QA_ARTIFACTS` | QA 失败时写入 allowlisted `failure.json` 的目录；不是产品日志目录。 |

QA 自行创建一次性 `HOME`、`USERPROFILE`、`XDG_*`、`NPM_CONFIG_CACHE`、临时目录、
`PATH` 和 `SKILLS_DESKTOP_WORKSPACE`，以避免读取开发者 Skill 状态。完整约束在
`tests/packaged-ui-qa/fixture.mjs` 与
`tests/packaged-ui-qa/launch.mjs`。
`SKILLS_DESKTOP_QA_DISABLE_CHROMIUM_SANDBOX` 不是受支持开关，workflow contract
明确禁止它和 `--no-sandbox`。

Release scripts 使用 GitHub Actions 的标准上下文变量，并在 unsigned candidate
构建中设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`。候选合约会拒绝注入签名、发布或
云签名凭据的环境；这些变量的值不得写入文档、日志或候选 manifest。变量名与
拒绝逻辑见 `scripts/release/candidate-contract.mjs`。

## TypeScript、Vite 与测试

### TypeScript

`tsconfig.base.json` 统一启用 `strict`、
`noUncheckedIndexedAccess`、`noImplicitOverride`、`isolatedModules`、
`noEmitOnError` 和大小写一致性；target/lib 基线为 ES2023，模块解析为 NodeNext。
根 `tsconfig.json` 以 project references 连接
`skills-runtime → remote-bootstrap → desktop`。Desktop 使用 `react-jsx` 且
`noEmit: true`，实际 bundle 由 Vite 生成；两个 package 使用 `tsc -b` 输出声明和
JavaScript。

### Vite

| 配置文件 | 输出 |
| --- | --- |
| `apps/desktop/vite.main.config.ts` | `apps/desktop/dist/main/index.js`；Node SSR；Electron external，私有 packages 与 Zod bundled；保留 sourcemap，不 minify |
| `apps/desktop/vite.preload.config.ts` | `apps/desktop/dist/preload/workspace.cjs`；单文件 CJS |
| `apps/desktop/vite.review-preload.config.ts` | `apps/desktop/dist/preload/review.cjs`；保留同目录 workspace preload |
| `apps/desktop/vite.renderer.config.ts` | React workspace renderer 到 `apps/desktop/dist/renderer`，相对 base |
| `apps/desktop/vite.review-renderer.config.ts` | 独立 React review renderer 到 `apps/desktop/dist/review-renderer` |
| `packages/remote-bootstrap/vite.release.config.ts` | `packages/remote-bootstrap/dist/release/index.js`；Node SSR；不生成 sourcemap |

### Vitest 与 lint

- `vitest.config.ts` 使用 fork pool，测试
  `**/*.test.ts(x)` 与 packaged QA contract；排除 prototype、build output 和
  real smoke。V8 statements/branches/functions/lines 门槛均为 **80%**。
- `eslint.config.js` 使用 Babel parser 读取 JS/TS/TSX，
  强制 `eqeqeq`、无 debugger、无重复 import、React key 与 Hooks 规则；CI 不允许
  warning。
- `biome.json` 只检查 `apps/desktop/src/**`，不负责格式化
  或 organize imports；当前额外检查以 warning 级别发现 unused 与 debugger。
- `.npmrc` 设置 `allow-git=all`；依赖可复现性仍由根
  lockfile、固定版本和 CI 的 `npm ci` 负责。

## Electron Forge 与打包

`apps/desktop/forge.config.ts` 的关键事实：

- `appBundleId` 为 `dev.skillsdesktop.app`，可执行文件名为 `skills-desktop`，
  package 使用 ASAR。
- packager allowlist 只保留 `package.json`、`dist/main`、`dist/preload`、
  `dist/renderer` 和 `dist/review-renderer`；图标作为 extra resource。
- makers：macOS DMG/ZIP、Windows Squirrel、Linux DEB/RPM。Windows 禁用 delta
  和 MSI。
- Electron fuses 启用 cookie encryption 与 embedded ASAR integrity，只允许从
  ASAR 加载；禁用 RunAsNode、Node CLI inspect、`NODE_OPTIONS`、额外 file protocol
  权限。
- 这些配置能生成 unsigned candidate，不等于 Apple notarization、Windows
  publisher identity 或 Stable Release。

候选生成器要求四个 workspace 版本完全一致、源码树干净、source commit 精确匹配，
并把 lockfile、Electron、Forge、Remote Bootstrap 与六类 build output 摘要绑定到
Candidate Manifest v1。输出平台为 macOS arm64/x64、Windows x64、Linux x64；实际
artifact 组合由 `scripts/release/candidate-contract.mjs`
封闭定义。

## Workflows

| Workflow | 真实门禁 |
| --- | --- |
| `.github/workflows/verify.yml` | PR、main push、可复用调用。Ubuntu 24.04 运行 `npm run verify`、package 与 packaged smoke；main push 另跑 real CLI smoke。macOS 15 与 Windows 2025 运行 typecheck、import check、unit tests。 |
| `.github/workflows/packaged-ui-qa.yml` | main、手动和复用调用；Linux x64、macOS arm64/x64、Windows x64。使用隔离 Local-only fixture；Linux 通过临时 AppArmor userns profile 保留 Chromium sandbox。失败只上传 `failure.json`。 |
| `.github/workflows/release-candidates.yml` | PR、main、版本 tag 与手动入口生成 native unsigned candidate。tag 或 main 上的手动运行才进入完整 quality/QA、摘要、SPDX SBOM、attestation、字节复验和 draft 流程；手动显式选择或 tag 才发布 prerelease，且始终 `prerelease`、`latest=false`。 |

三个 workflow 的第三方 Actions 都按完整 commit SHA 固定。Dependabot 配置
`.github/dependabot.yml` 每周一检查 npm 与 GitHub
Actions，并分别分组；它不会自动改变本页记录的兼容性结论。

## 更新配置

`apps/desktop/src/main/composition-root.ts` 当前固定注入
`releaseChannel: "unsigned-preview"`。因此实际 packaged V1 走手动更新页面，不会
启用 automatic feed。`apps/desktop/src/main/application/update-platform-policy.ts`
虽定义 Stable packaged macOS arm64/x64 与 Windows x64 的 automatic policy，
但这是 Stable 路径，Linux保持手动；不能把存在的代码等同于当前 candidate 已启用。

若未来进入 automatic policy，默认启动延迟为 30 秒，检查间隔为 24 小时，常量在
`apps/desktop/src/main/application/update-check-contracts.ts`。
检查时间写入 Electron userData 下 `updates/check-record-v1.json`；已下载候选写入
`updates/deferred-restart-v1.json`，并受 mutation、review、reconciliation 与
recovery guards 阻塞。更完整状态机见[更新协调](../systems/updates.md)。
