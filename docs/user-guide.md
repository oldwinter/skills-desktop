# Skills Desktop 用户手册（V1）

面向已经装好本机 `npx skills` 环境、想用桌面端查看与管理 Skills 的开发者。

**当前产品仍只开放 Local Target。** 已接受的目标架构是 Local 加 POSIX
Remote SSH，但 ADR 不是已交付证明。SSH Inventory 要等 Milestone 3 的打包
tracer 与 validators 全部通过后才会开放；SSH mutation 要等 Milestone 4
的不确定结果与恢复门禁通过后才会开放。在此之前，界面里即使能看见 SSH
Target，也会标成「SSH · 未在 V1 开放」，不能当作当前可用路径。

实际技能发现与变更仍交给 `npx skills`；本应用不另起一套安装器，也不自行扫描技能目录。

---

## 1. 安装与启动

### 推荐：Unsigned Developer Preview

当前公开分发是 **Unsigned Developer Preview**（GitHub prerelease），不是已签名的 Stable Release。

1. 打开 [Releases](https://github.com/oldwinter/skills-desktop/releases)，下载当前唯一公开的 Unsigned Developer Preview，并一并下载 `SHA256SUMS`。
2. **先校验再安装**：确认产物 SHA-256 与 `SHA256SUMS` 一致。有 GitHub CLI 时，按 [安装指南](unsigned-developer-preview.md) 做 attestation 校验。校验失败请停止。
3. 按平台完成安装（摘要如下；细节以 `docs/unsigned-developer-preview.md` 为准）：
   - **macOS 13 Ventura 或更高版本**：打开 DMG，拷到 `/Applications`，对本地副本做 ad-hoc `codesign`，必要时在「系统设置 → 隐私与安全性」里对该应用选 **仍然打开**。这不是 Developer ID，也不是公证。
   - **Windows**：运行 `skills-desktop-0.1.0-win32-x64-setup.exe`。SmartScreen / 未验证发布者警告时，仅在系统提供按文件覆盖选项且你接受风险时继续；策略禁止覆盖则停止，不要自行削弱组织策略。
   - **Linux**：先对照 `SHA256SUMS` 校验 SHA-256，再用 apt 安装本地 DEB（见下方 Linux 小节）。不要只用 `dpkg -i`。RPM 发行版在同样校验后用发行版常规方式安装。预览包有校验与 provenance，但没有项目运维的 Linux 包签名仓库。

#### Linux（Debian / Ubuntu DEB）

1. 下载 `.deb` 与 `SHA256SUMS`，先确认产物 SHA-256 与 `SHA256SUMS` 中对应行一致。不一致则停止：

   ```bash
   sha256sum -c SHA256SUMS --ignore-missing
   ```

2. 用 apt 安装本地文件（必须带 `./`），以便解析 Depends：

   ```bash
   sudo apt install ./skills-desktop-*.deb
   ```

   也可写成带版本号的文件名，例如：

   ```bash
   sudo apt install ./skills-desktop-0.1.0-linux-x64.deb
   ```

3. 该 DEB 的 trash helper `Depends` 为五选一（任意一个即可）：`kde-cli-tools` | `kde-runtime` | `trash-cli` | `libglib2.0-bin` | `gvfs-bin`。`apt install` 本地 DEB 时会自动选一个（常见为 `libglib2.0-bin`）。

不要在 apt 索引过期时裸跑 `sudo apt-get install -f`：它会把未配置的预览包**卸掉**，而不是补依赖。若已经 `dpkg -i` 失败，先更新索引再装本地 DEB（或先装上述任一 helper 再配置）：

```bash
sudo apt update
sudo apt install ./skills-desktop-*.deb
```

```bash
sudo apt update
sudo apt install libglib2.0-bin
sudo dpkg --configure -a
```

仅在已经 `apt update`、并且理解 Depends 无法满足时仍可能卸载预览包的前提下，才考虑 `apt-get install -f`。

预览构建 **不会** 进入应用的稳定自动更新通道。更新需手动下载、校验、安装下一版预览。资源列表里的 `RELEASES` / `*.nupkg` 是 Forge / Squirrel 打包产物，不是 live 稳定更新源。

### 从源码本地跑（开发 / 自建候选）

需要 **Node.js 22.20+**（以便 pinned `skills` CLI 经 `npx` 运行）：

```bash
npm install
npm run verify
```

本地 candidate 构建见仓库 README；本地候选 **没有** 公开发布权威。

启动应用后，侧栏可见：**Inventory / Comparison / Collections / Targets / About**。

---

## 2. Local Target

**Target** = 应用侧选定的一台机器 + 工作区 + harness（如本机 Codex）。V1 只创建与编辑 **Local** Target。

### 新建 / 编辑

1. 打开 **Targets**。
2. **New Target**，填写显示标签、工作区、harness 等。
3. Kind 保持 **Local**，保存。

列表上 Local 显示为 Local；若仍看到历史残留的 SSH 项，会标 **SSH · 未在 V1 开放**，编辑只读、不能保存。新建 SSH 在 V1 中不可用。

页眉会显示当前 Target 标签与工作区路径。侧栏 **Targets** 区可切换当前观察对象。

### 本机前提

- 本机已安装可用的 Node / `npx`。
- Skills Desktop 通过 pinned `skills@1.5.23` 方言调用 `npx skills`（侧栏底部可见 CLI 版本提示）。
- 每个 Local Target 应对应你真实在用的工作区与 harness。

---

## 3. Inventory（清单）

Inventory 是对当前 Target 一次只读 `npx skills list --json` 的归一化结果：同时覆盖 **project** 与 **global** 范围。它是快照证据，不是第二套真相源。

### 新鲜度

| 状态 | 含义 | 能否变更 |
| --- | --- | --- |
| Fresh evidence | 本会话内完整观察成功 | 可以准备变更 |
| Stale evidence | 上次完整结果被保留（刷新失败、Target 变更、或新会话恢复） | 可查看/对比，**不能**授权变更 |
| No evidence | 尚无完整观察 | 先 Refresh |

点标题旁的刷新按钮重新观察；进行中可取消。空清单时提示：Refresh this Target，或通过 `npx skills` 安装技能。

### 浏览与筛选

- 表格列：Skill、Scope、Harness、Declared source、Evidence（revision）。
- 搜索框可按名称 / 源过滤；范围可切 All / Project / Global。
- 筛选后没有结果时，点 **Clear filters** 可一次清空搜索词并恢复 All scopes。
- 点选一行，右侧 **Skill evidence** 显示 scope、harness agents、source type、declared source、revision、content fingerprint。未知证据会明确标 Unknown，不会被捏造成版本号。

### 变更（必须先计划、再确认）

任何变更都走：**Prepare → Command Plan → Trusted Review → 执行**。界面上的预览字符串只是说明，**不会**当 shell 执行。

常见操作：

1. **Add Skill**：填 GitHub 源（`owner/repository`）、精确技能名、project/global，点 **Prepare add**。
2. 选中技能后 **Prepare update** / **Prepare removal**。
3. 在 Project 或 Global 范围（不能是 All）可 **Update scope**。
4. 出现 Command Plan 后，点 **Open Trusted Review**，在独立确认界面审阅后再执行。

仅当 Inventory 为 **fresh**，且不在 reconciliation / 变更进行中时，Prepare 才可用。

若出现 **Reconciliation required**：先按提示 **Reconcile**，在建立新的完整 Inventory 之前不要继续变更。

---

## 4. Comparison（对比）

对比两个 Target 的 Inventory，按技能名对齐，保留多维结果（是否存在、declared source、harness、revision / content fingerprint、新鲜度），**不会**压成单一「好坏」状态。

### V1 用法

1. 至少准备 **两个 Local Target**（各有可用 Inventory）。
2. 打开 **Comparison**，选左右 Target，可互换。
3. 点 **Compare**。

只有一个 Target 时：副标题为 **Needs a second Local Target**，Compare 禁用，并提示先到 Targets 再添加一个。

两侧证据最好都是 fresh；一侧 stale 时仍可查看，但向该侧准备变更会受限。选中一行可查看左右证据详情，并在条件满足时准备跨 Target 的更新/同步类操作（仍需 Trusted Review）。

常见维度标签：Source mismatch、Unknown evidence、Revision or content drift 等。

---

## 5. Collections（官方合集）

**Official Collections** = 随应用分发、经审阅的菜谱：从已有源中点名若干 skill，可对 **Local** Target 生成变更意图。合集不拥有已安装技能，也不另起安装协议。

### 典型流程

1. 打开 **Collections**，选择一个已打包的 Official Collection release。
2. 勾选要包含的 **Local** Target 与 scope；查看每项 Assessment（如 missing / present-content-unknown / source-conflict / removal-candidate / incompatible）。
3. 生成 **Collection Plan**，审阅后进入 Trusted Review，再执行。

执行不是跨机事务：每个子 Target 的确认变更独立；若某子项进入 reconciliation，按该 Target 单独处理。

### 空态与 SSH

- 若当前构建 **没有** 捆绑任何 reviewed release：会看到空态说明（有合集包之后，才对 Local Target 可用）。
- SSH Target 仍可能出现在列表，但标 **SSH · 未在 V1 开放**，Include 不可用（V1 Local Collections 范围外）。

---

## 6. About 与更新

**About** 显示产品名、版本、平台 / 架构，以及更新策略。

| 构建类型 | 你会看到 | 怎么升级 |
| --- | --- | --- |
| Unsigned Developer Preview | **Manual upgrade**；文案说明未签名/未公证 | 从 [Releases](https://github.com/oldwinter/skills-desktop/releases) 下载新包，按 `docs/unsigned-developer-preview.md` 校验后手动安装 |
| 未来的已签名 Stable（尚未作为当前公开路径） | 才可能走 stable 自动检查 / 下载 | 签名发布仍受 #22 / #27 人闸约束；**不要**把预览当成已签名正式版 |

预览包 **不会** 标为 latest，也 **不会** 进入自动更新源。Windows 预览资源里若出现 `RELEASES` 或 `*.nupkg`，那是 Electron Forge / Squirrel 打包产物，不是线上稳定更新源；请下载安装包与 `SHA256SUMS`。About 里可导出 release diagnostics，便于排障。

若更新/重启被拦住，常见原因：变更进行中、Trusted Review 打开、Reconciliation required 等——先处理完再重启。

---

## 7. 常见问题

**Q：和直接跑 `npx skills` 有什么区别？**  
A：桌面端把 project+global 清单、对比、变更计划和确认做成可审阅流程；真正的 list/add/remove/update 仍委托给 `npx skills`。

**Q：为什么不能改技能？Prepare 是灰的？**  
A：需要 **Fresh evidence**。先 Refresh；若显示 Reconciliation required，先 Reconcile。Stale / No evidence 只能看，不能授权变更。

**Q：Stale evidence 是过期了吗？**  
A：不是按时间自动过期。刷新失败、Target 定义变更、或新会话恢复上次完整快照时，会标 stale。可继续查看和对比，不可拿它做变更依据。

**Q：为什么 Comparison 不能点？**  
A：V1 需要两个 Local Target。先到 Targets 再建一个，再回来 Compare。

**Q：界面上还有 SSH，能用吗？**  
A：**不能当作 V1 主路径。** 列表可能显示 **SSH · 未在 V1 开放**；新建/保存不可用，已有项只读；Collections 也不会把 SSH 纳入 V1 Include。远程相关能力属于下一步（next-scope），不是 V1 承诺范围。

**Q：macOS / Windows 拦安装正常吗？**  
A：对 Unsigned Developer Preview 是预期行为。先校验字节，再按平台自带的「仍要打开 / 按文件覆盖」处理。不要为了安装去关 Gatekeeper 或导入不受信的自签根证书。

**Q：Linux 上 `dpkg -i` 失败，或 `apt-get install -f` 把包卸掉了？**  
A：DEB 依赖 trash helper 五选一（`kde-cli-tools` | `kde-runtime` | `trash-cli` | `libglib2.0-bin` | `gvfs-bin`）。先对照 `SHA256SUMS` 校验，再用 `sudo apt install ./skills-desktop-*.deb`。不要在 apt 索引过期时裸跑 `apt-get install -f`，那会卸掉未配置的预览包。

**Q：应用内提示有更新吗？**  
A：预览构建走手动升级。到 Releases 取新包并校验；不要期待稳定通道的自动更新。

**Q：Command Plan 里的命令能复制到终端跑吗？**  
A：预览字符串仅供审阅，不是可执行输入。请在 Trusted Review 里确认，由应用按参数数组调用 CLI。

---

## 相关文档

- 产品边界与状态：[README](../README.md)
- Unsigned 安装与校验细节：[unsigned-developer-preview.md](unsigned-developer-preview.md)
- 概念定义：[CONTEXT.md](../CONTEXT.md)
- 架构决策：[`docs/adr/`](adr/)

有问题或复现步骤，请到 [oldwinter/skills-desktop](https://github.com/oldwinter/skills-desktop/issues) 开 Issue。
