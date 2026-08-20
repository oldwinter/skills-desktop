import { createIcons, icons } from "lucide";
import "./styles.css";

const prototypeVariants = [
  { key: "A", name: "清单工作台" },
  { key: "B", name: "对比工作台" },
  { key: "C", name: "设备编排" },
];

const views = [
  { key: "inventory", label: "本机 Skills", icon: "list-filter" },
  { key: "compare", label: "差异对比", icon: "columns-3" },
  { key: "collections", label: "精选套装", icon: "library-big" },
];

const fallbackSkills = [
  skill("prototype", "project", ["Codex", "Pi"], "mattpocock/skills", "4e2d8b1"),
  skill("tdd", "global", ["Codex", "Pi", "Claude Code"], "mattpocock/skills", "834ca92"),
  skill("code-review", "global", ["Codex", "Claude Code"], "mattpocock/skills", "b1207ce"),
  skill("diagnosing-bugs", "global", ["Codex", "Pi"], "mattpocock/skills", "18ff042"),
  skill("agent-browser", "global", ["Codex", "Pi"], "vercel-labs/agent-browser", "901ada8"),
  skill("find-skills", "global", ["Codex", "Pi"], "vercel-labs/skills", "ccd20a4"),
  skill("frontend", "global", ["Codex"], "sisyphuslabs/omo", "aa712e8"),
  skill("git-master", "global", ["Codex"], "sisyphuslabs/omo", "cb90e73"),
  skill("visual-qa", "global", ["Codex"], "sisyphuslabs/omo", "ec994b2"),
  skill("domain-modeling", "project", ["Codex", "Pi"], "mattpocock/skills", "70f3b0e"),
  skill("workspace-routing", "project", ["Codex"], null, null),
  skill("loop-engineering", "project", ["Codex"], null, null),
];

const remoteSkills = [
  { name: "prototype", revision: "4e2d8b1", agents: ["Pi"] },
  { name: "tdd", revision: "7fd91d0", agents: ["Pi"] },
  { name: "code-review", revision: "b1207ce", agents: ["Pi"] },
  { name: "diagnosing-bugs", revision: "18ff042", agents: ["Pi"] },
  { name: "agent-browser", revision: "8a1102c", agents: ["Pi"] },
  { name: "find-skills", revision: "ccd20a4", agents: ["Pi"] },
  { name: "grilling", revision: "303f12a", agents: ["Pi"] },
  { name: "handoff", revision: "9b2d771", agents: ["Pi"] },
];

const compareTargets = [
  { agent: "Codex", device: "local-dev", host: null, icon: "laptop", id: "local-codex", label: "本机 / Codex" },
  { agent: "Pi", device: "local-dev", host: null, icon: "laptop", id: "local-pi", label: "本机 / Pi" },
  { agent: "Pi", device: "build-box", host: "build-box", icon: "server", id: "build-pi", label: "build-box / Pi" },
  { agent: "Claude Code", device: "design-mac", host: "design-mac", icon: "server", id: "design-claude", label: "design-mac / Claude Code" },
];

const installTargets = [
  { agent: "Codex", cliAgent: "codex", device: "local-dev", host: null, id: "local-dev:codex" },
  { agent: "Pi", cliAgent: "pi", device: "local-dev", host: null, id: "local-dev:pi" },
  { agent: "Claude Code", cliAgent: "claude-code", device: "local-dev", host: null, id: "local-dev:claude-code" },
  { agent: "Pi", cliAgent: "pi", device: "build-box", host: "build-box", id: "build-box:pi" },
  { agent: "Claude Code", cliAgent: "claude-code", device: "design-mac", host: "design-mac", id: "design-mac:claude-code" },
];

const collections = [
  {
    id: "mattpocock",
    source: "mattpocock/skills",
    title: "Engineering Skills",
    count: 35,
    description: "从需求澄清到交付的工程工作流，为三类 Harness ",
    descriptionTail: "提供精选能力。",
    skills: ["prototype", "tdd", "code-review", "diagnosing-bugs", "domain-modeling", "grilling"],
    updateSkills: [
      "ask-matt",
      "code-review",
      "codebase-design",
      "diagnosing-bugs",
      "domain-modeling",
      "grill-with-docs",
      "implement",
      "improve-codebase-architecture",
      "prototype",
      "research",
      "resolving-merge-conflicts",
      "setup-matt-pocock-skills",
      "tdd",
      "to-spec",
      "to-tickets",
      "triage",
      "wayfinder",
      "wizard",
      "grill-me",
      "grilling",
      "handoff",
      "teach",
      "to-questionnaire",
      "wait-what",
      "writing-for-agents",
      "claude-handoff",
      "loop-me",
      "setup-ts-deep-modules",
      "writing-beats",
      "writing-fragments",
      "writing-shape",
      "git-guardrails-claude-code",
      "migrate-to-shoehorn",
      "scaffold-exercises",
      "setup-pre-commit",
    ],
  },
  {
    id: "vercel",
    source: "vercel-labs/agent-skills",
    title: "Vercel Agent Skills",
    count: 7,
    description: "面向 React、Web 与部署工作流的官方技能集。",
    skills: ["web-design-guidelines", "vercel-react-best-practices", "vercel-deploy"],
  },
  {
    id: "browser",
    source: "vercel-labs/agent-browser",
    title: "Agent Browser",
    count: 1,
    description: "让本机 harness 具备可复用的浏览器操作能力。",
    skills: ["agent-browser"],
  },
];

const searchParams = new URLSearchParams(window.location.search);
const initialVariant = prototypeVariants.some(({ key }) => key === searchParams.get("variant"))
  ? searchParams.get("variant")
  : "A";
const initialView = views.some(({ key }) => key === searchParams.get("view"))
  ? searchParams.get("view")
  : "inventory";

const state = {
  cliVersion: "1.5.23",
  commandPlan: "",
  compareLeftTarget: "local-codex",
  compareRightTarget: "build-pi",
  collectionId: "mattpocock",
  collectionTargets: new Set(["local-dev:codex", "local-dev:pi"]),
  error: "",
  loading: true,
  mode: window.skillsDesktop ? "Electron / npx skills" : "浏览器样本",
  query: "",
  scannedAt: "",
  scope: "all",
  selectedSkillId: "",
  showOnlyDiffs: false,
  skills: [],
  toast: "",
  variant: initialVariant,
  view: initialView,
  workspaceRoot: "agent-monorepo",
};

const app = document.querySelector("#app");

function skill(name, scope, agents, source, revision) {
  return {
    agents,
    name,
    path: `${scope === "global" ? "~/.agents" : ".agents"}/skills/${name}`,
    revision,
    scope,
    source,
    sourceType: source ? "github" : null,
    sourceUrl: source ? `https://github.com/${source}` : null,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name, size = 16) {
  return `<i data-lucide="${name}" width="${size}" height="${size}" aria-hidden="true"></i>`;
}

function skillId(item) {
  return `${item.scope}:${item.name}:${item.path}`;
}

function selectedSkill() {
  return state.skills.find((item) => skillId(item) === state.selectedSkillId) || state.skills[0];
}

function selectedCollection() {
  return collections.find((item) => item.id === state.collectionId) || collections[0];
}

function compareTarget(id) {
  return compareTargets.find((target) => target.id === id) || compareTargets[0];
}

function compareTargetSkills(target) {
  if (target.id === "build-pi") return remoteSkills;
  if (target.id === "design-claude") return fallbackSkills.filter((item) => item.agents.includes("Claude Code"));
  return state.skills.filter((item) => item.agents?.includes(target.agent));
}

function filteredSkills() {
  const query = state.query.trim().toLowerCase();
  return state.skills.filter((item) => {
    const inScope = state.scope === "all" || item.scope === state.scope;
    const haystack = [item.name, item.source, item.path, ...(item.agents || [])].join(" ").toLowerCase();
    return inScope && (!query || haystack.includes(query));
  });
}

function compareRows() {
  const leftGroups = Map.groupBy(compareTargetSkills(compareTarget(state.compareLeftTarget)), (item) => item.name);
  const rightGroups = Map.groupBy(compareTargetSkills(compareTarget(state.compareRightTarget)), (item) => item.name);
  const names = [...new Set([...leftGroups.keys(), ...rightGroups.keys()])].sort();

  return names
    .map((name) => {
      const left = leftGroups.get(name)?.[0];
      const right = rightGroups.get(name)?.[0];
      let status = "matched";
      if (!left) status = "only-remote";
      else if (!right) status = "only-local";
      else if (!left.revision || !right.revision) status = "unknown";
      else if (left.revision !== right.revision) status = "drift";
      return { left, name, right, status };
    })
    .filter((row) => !state.showOnlyDiffs || row.status !== "matched");
}

function statusMeta(status) {
  return {
    drift: ["git-compare-arrows", "修订不同", "drift"],
    matched: ["circle-check", "相同", "healthy"],
    "only-local": ["circle-minus", "仅左侧", "drift"],
    "only-remote": ["circle-plus", "仅右侧", "drift"],
    unknown: ["circle-help", "无法判定修订", "warning"],
  }[status];
}

function statusBadge(status) {
  const [iconName, label, tone] = statusMeta(status);
  return `<span class="status status--${tone}">${icon(iconName, 14)}${label}</span>`;
}

function setUrl() {
  const params = new URLSearchParams(window.location.search);
  params.set("variant", state.variant);
  params.set("view", state.view);
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function appHeader() {
  return `
    <header class="app-header">
      <div class="brand-lockup">
        <span class="brand-mark">${icon("blocks", 17)}</span>
        <span>Skills Desktop</span>
        <span class="prototype-label">PROTOTYPE</span>
      </div>
      <div class="header-context" title="${escapeHtml(state.workspaceRoot)}">
        ${icon("folder-git-2", 15)}
        <span>${escapeHtml(shortPath(state.workspaceRoot))}</span>
      </div>
      <div class="header-meta">
        <span>${state.mode}</span>
        <button class="icon-button" type="button" aria-label="设置">${icon("settings", 16)}</button>
      </div>
    </header>`;
}

function viewTabs(compact = false) {
  return `<nav class="view-tabs ${compact ? "view-tabs--compact" : ""}" aria-label="工作区">
    ${views
      .map(
        (view) => `<button class="view-tab ${state.view === view.key ? "is-active" : ""}" type="button" data-view="${view.key}">
          ${icon(view.icon, 15)}<span>${view.label}</span>
        </button>`,
      )
      .join("")}
  </nav>`;
}

function scopeTree() {
  return `<aside class="scope-tree">
    <div class="scope-section">
      <div class="scope-heading"><span>设备</span><button class="icon-button" type="button" aria-label="添加 SSH 设备">${icon("plus", 15)}</button></div>
      <button class="scope-item is-active" type="button">${icon("laptop", 15)}<span>本机</span><span class="count">${state.skills.length}</span></button>
      <button class="scope-item" type="button">${icon("server", 15)}<span>build-box</span><span class="scope-state">SSH</span></button>
      <button class="scope-item" type="button">${icon("server-off", 15)}<span>gpu-lab</span><span class="scope-state">离线</span></button>
    </div>
    <div class="scope-section">
      <div class="scope-heading"><span>Harness</span></div>
      <button class="scope-item" type="button">${icon("square-terminal", 15)}<span>Codex</span><span class="count">${countForAgent("Codex")}</span></button>
      <button class="scope-item" type="button">${icon("square-terminal", 15)}<span>Pi</span><span class="count">${countForAgent("Pi")}</span></button>
      <button class="scope-item" type="button">${icon("square-terminal", 15)}<span>Claude Code</span><span class="count">${countForAgent("Claude Code")}</span></button>
    </div>
    <div class="scope-section scope-section--views">${viewTabs(true)}</div>
    <div class="scope-footer">
      <span>${icon("terminal", 14)} npx skills ${escapeHtml(state.cliVersion)}</span>
      <span>${state.scannedAt ? formatTime(state.scannedAt) : "等待扫描"}</span>
    </div>
  </aside>`;
}

function countForAgent(agent) {
  return state.skills.filter((item) => item.agents?.includes(agent)).length;
}

function inventoryToolbar() {
  return `<div class="toolbar">
    <label class="search-field">${icon("search", 16)}<span class="sr-only">搜索 skills</span><input type="search" value="${escapeHtml(state.query)}" placeholder="搜索名称、来源或 Harness" data-search /></label>
    <div class="segmented" aria-label="安装范围">
      ${["all", "project", "global"]
        .map(
          (scope) => `<button type="button" data-scope="${scope}" class="${state.scope === scope ? "is-active" : ""}">${
            { all: "全部", project: "项目", global: "全局" }[scope]
          }</button>`,
        )
        .join("")}
    </div>
    <button class="button button--secondary" type="button" data-refresh>${icon("refresh-cw", 15)}刷新</button>
  </div>`;
}

function summaryStrip(items) {
  return `<div class="summary-strip">${items
    .map(({ label, tone = "", value }) => `<span class="summary-item ${tone ? `summary-item--${tone}` : ""}"><strong>${value}</strong>${label}</span>`)
    .join("")}</div>`;
}

function inventoryTable(limit = Infinity) {
  if (state.loading) return loadingState("正在通过 npx skills 读取本机清单");
  if (state.error) return errorState(state.error);
  const rows = filteredSkills().slice(0, limit);
  if (!rows.length) return emptyState("没有匹配的 skill", "调整搜索词或安装范围。");

  return `<div class="table-wrap"><table class="data-table skills-table">
    <thead><tr><th>Skill</th><th>范围</th><th>Harness</th><th>来源</th><th>修订</th></tr></thead>
    <tbody>${rows
      .map((item) => {
        const id = skillId(item);
        return `<tr class="${state.selectedSkillId === id ? "is-selected" : ""}">
          <td data-label="Skill"><button class="skill-name" type="button" data-skill="${escapeHtml(id)}">${icon("file-terminal", 15)}<span>${escapeHtml(item.name)}</span></button></td>
          <td data-label="范围"><span class="scope-label">${item.scope === "global" ? "全局" : "项目"}</span></td>
          <td data-label="Harness"><span class="agents-cell">${escapeHtml((item.agents || []).join(", ") || "未关联")}</span></td>
          <td data-label="来源"><span class="source-cell">${escapeHtml(item.source || "本地目录")}</span></td>
          <td data-label="修订"><code>${escapeHtml(item.revision || "npx 未暴露")}</code></td>
        </tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

function inventoryMain() {
  const visible = filteredSkills();
  return `<section class="workspace-body">
    <div class="page-heading">
      <div><h1>本机 Skills</h1><p>清单由 <code>npx skills list --json</code> 提供，不扫描私有目录。</p></div>
      ${summaryStrip([
        { label: "已安装", value: state.skills.length },
        { label: "项目", value: state.skills.filter((item) => item.scope === "project").length },
        { label: "全局", value: state.skills.filter((item) => item.scope === "global").length },
      ])}
    </div>
    ${inventoryToolbar()}
    <div class="section-caption"><span>显示 ${visible.length} 项</span><span>修订列只显示 npx 可验证的数据</span></div>
    ${inventoryTable()}
  </section>`;
}

function diffTable() {
  const rows = compareRows();
  const leftTarget = compareTarget(state.compareLeftTarget);
  const rightTarget = compareTarget(state.compareRightTarget);
  if (!rows.length) return emptyState("没有差异", "两个目标在当前样本中一致。");
  return `<div class="table-wrap"><table class="data-table diff-table">
    <thead><tr><th>Skill</th><th>${escapeHtml(leftTarget.label)}</th><th>${escapeHtml(rightTarget.label)}</th><th>差异</th></tr></thead>
    <tbody>${rows
      .map(
        (row) => `<tr class="diff-row diff-row--${row.status}">
          <td data-label="Skill"><span class="skill-name-static">${icon("file-terminal", 15)}${escapeHtml(row.name)}</span></td>
          <td data-label="左侧"><code>${escapeHtml(row.left?.revision || (row.left ? "修订未知" : "未安装"))}</code></td>
          <td data-label="右侧"><code>${escapeHtml(row.right?.revision || (row.right ? "修订未知" : "未安装"))}</code></td>
          <td data-label="差异">${statusBadge(row.status)}</td>
        </tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function compareTargetPicker(side) {
  const selectedId = side === "left" ? state.compareLeftTarget : state.compareRightTarget;
  const selected = compareTarget(selectedId);
  return `<label class="target-picker">
    ${icon(selected.icon, 17)}
    <span><small>${side === "left" ? "左侧" : "右侧"}</small><select aria-label="${side === "left" ? "左侧比较目标" : "右侧比较目标"}" data-compare-target="${side}">${compareTargets
      .map((target) => `<option value="${target.id}" ${target.id === selectedId ? "selected" : ""}>${escapeHtml(target.label)}</option>`)
      .join("")}</select></span>
    ${icon("chevron-down", 15)}
  </label>`;
}

function compareMain() {
  const allRows = compareRows();
  const counts = Object.groupBy(allRows, (row) => row.status);
  return `<section class="workspace-body">
    <div class="page-heading">
      <div><h1>差异对比</h1><p>比较数量、存在性与修订指纹，不把更新时间伪装成版本。</p></div>
      <button class="button button--primary" type="button" data-command="reconcile">${icon("list-checks", 15)}生成同步计划</button>
    </div>
    <div class="target-pair">
      ${compareTargetPicker("left")}
      <button class="swap-button" type="button" aria-label="交换左右目标" data-swap-targets>${icon("arrow-left-right", 17)}</button>
      ${compareTargetPicker("right")}
      <label class="check-control"><input type="checkbox" ${state.showOnlyDiffs ? "checked" : ""} data-diffs-only /> 只看差异</label>
    </div>
    ${summaryStrip([
      { label: "相同", tone: "healthy", value: counts.matched?.length || 0 },
      { label: "修订不同", tone: "drift", value: counts.drift?.length || 0 },
      { label: "仅一侧", tone: "drift", value: (counts["only-local"]?.length || 0) + (counts["only-remote"]?.length || 0) },
      { label: "修订未知", tone: "warning", value: counts.unknown?.length || 0 },
    ])}
    ${diffTable()}
  </section>`;
}

function collectionList() {
  return `<div class="collection-list">${collections
    .map(
      (item) => `<button class="collection-row ${item.id === state.collectionId ? "is-selected" : ""}" type="button" data-collection="${item.id}">
        <span class="collection-icon">${icon("package-open", 17)}</span>
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)}</small></span>
        <span class="collection-count">${item.count}</span>
      </button>`,
    )
    .join("")}</div>`;
}

function collectionDetail() {
  const item = selectedCollection();
  return `<div class="collection-detail">
    <div class="collection-title"><span class="collection-icon collection-icon--large">${icon("library-big", 20)}</span><div><h2>${escapeHtml(item.source)}</h2><p>${escapeHtml(item.description)}${item.descriptionTail ? `<span class="nowrap">${escapeHtml(item.descriptionTail)}</span>` : ""}</p></div></div>
    <dl class="facts facts--inline"><div><dt>包含</dt><dd>${item.count} skills</dd></div><div><dt>安装器</dt><dd>npx skills</dd></div><div><dt>状态</dt><dd>可预览</dd></div></dl>
    <div class="included-skills"><h3>代表性 Skills</h3><div class="tag-cluster">${item.skills.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div></div>
    <div class="target-checks"><h3>选择本机 Harness</h3>${installTargets
      .filter((target) => target.device === "local-dev")
      .map((target) => `<label class="check-control"><input type="checkbox" data-collection-target="${target.id}" ${state.collectionTargets.has(target.id) ? "checked" : ""} /> ${target.agent}</label>`)
      .join("")}</div>
    <div class="collection-actions">
      <button class="button button--primary" type="button" data-command="install-collection">${icon("package-plus", 15)}预览安装命令</button>
      ${item.updateSkills ? `<button class="button button--secondary" type="button" data-command="update-collection">${icon("refresh-cw", 15)}预览套装更新</button>` : ""}
    </div>
  </div>`;
}

function collectionsMain() {
  return `<section class="workspace-body">
    <div class="page-heading"><div><h1>精选套装</h1><p>套装只是经过审阅的 npx skills 来源与选择参数，不引入第二套安装协议。</p></div><button class="button button--secondary" type="button" data-command="list-collection">${icon("scan-search", 15)}重新读取仓库</button></div>
    <div class="collections-layout">${collectionList()}${collectionDetail()}</div>
  </section>`;
}

function currentMain() {
  if (state.view === "compare") return compareMain();
  if (state.view === "collections") return collectionsMain();
  return inventoryMain();
}

function inspector() {
  if (state.view === "compare") return diffInspector();
  if (state.view === "collections") return commandInspector(collectionCommand());
  const item = selectedSkill();
  if (!item) return `<aside class="inspector">${emptyState("未选择 Skill", "从清单中选择一项查看详情。")}</aside>`;
  const command = state.commandPlan || updateCommand(item);
  return `<aside class="inspector">
    <div class="inspector-header"><div><span class="inspector-icon">${icon("file-terminal", 17)}</span><h2>${escapeHtml(item.name)}</h2></div><button class="icon-button" type="button" aria-label="更多操作">${icon("ellipsis", 16)}</button></div>
    <dl class="facts">
      <div><dt>范围</dt><dd>${item.scope === "global" ? "全局" : "项目"}</dd></div>
      <div><dt>Harness</dt><dd>${escapeHtml(item.agents?.join(", ") || "未关联")}</dd></div>
      <div><dt>来源</dt><dd>${escapeHtml(item.source || "npx 未提供")}</dd></div>
      <div><dt>修订</dt><dd><code>${escapeHtml(item.revision || "npx 未提供")}</code></dd></div>
      <div><dt>路径</dt><dd class="break-anywhere"><code>${escapeHtml(item.path)}</code></dd></div>
    </dl>
    <div class="inspector-actions"><button class="button button--secondary" type="button" data-command="update">${icon("refresh-cw", 14)}更新</button><button class="button button--danger" type="button" data-command="remove">${icon("trash-2", 14)}移除</button></div>
    ${commandPreview(command)}
  </aside>`;
}

function diffInspector() {
  const rows = compareRows();
  const diffs = rows.filter((row) => row.status !== "matched");
  return `<aside class="inspector">
    <div class="inspector-header"><div><span class="inspector-icon">${icon("columns-3", 17)}</span><h2>差异摘要</h2></div></div>
    <div class="diff-summary-list">${["drift", "only-local", "only-remote", "unknown"]
      .map((status) => `<div>${statusBadge(status)}<strong>${rows.filter((row) => row.status === status).length}</strong></div>`)
      .join("")}</div>
    <div class="inspector-note">${icon("shield-check", 16)}<span>同步前先生成命令计划。原型不会连接 SSH 或<span class="nowrap">修改技能。</span></span></div>
    ${commandPreview(state.commandPlan || reconcileCommand(diffs))}
  </aside>`;
}

function commandInspector(command) {
  return `<aside class="inspector">
    <div class="inspector-header"><div><span class="inspector-icon">${icon("square-terminal", 17)}</span><h2>命令计划</h2></div></div>
    <div class="inspector-note">${icon("info", 16)}<span>所有安装和更新动作都委托给 npx skills；当前只生成<span class="nowrap">预览。</span></span></div>
    ${commandPreview(state.commandPlan || command)}
  </aside>`;
}

function commandPreview(command) {
  return `<section class="command-preview"><div class="command-heading"><h3>命令预览</h3><button class="icon-button" type="button" aria-label="复制命令" data-copy-command>${icon("copy", 14)}</button></div><pre><code>${escapeHtml(command)}</code></pre><p>未执行。生产实现需要再次确认目标、范围与 SSH 主机。</p></section>`;
}

function updateCommand(item) {
  const scopeFlag = item.scope === "global" ? "--global" : "--project";
  return `npx skills update ${item.name} ${scopeFlag} --yes`;
}

function removeCommand(item) {
  const scopeFlag = item.scope === "global" ? "--global" : "";
  return `npx skills remove ${item.name} ${scopeFlag} --yes`.replace("  ", " ");
}

function collectionCommand() {
  const item = selectedCollection();
  const selected = installTargets.filter((target) => state.collectionTargets.has(target.id));
  if (!selected.length) return "<请选择至少一个安装目标>";
  return [...Map.groupBy(selected, (target) => target.device).values()]
    .map((targets) => {
      const base = `npx skills add ${item.source} --skill '*' --agent ${targets.map((target) => target.cliAgent).join(" ")} --global --yes`;
      return targets[0].host ? `ssh ${targets[0].host} "${base}"` : base;
    })
    .join("\n");
}

function collectionUpdateCommand() {
  const item = selectedCollection();
  if (!item.updateSkills) return `npx skills add ${item.source} --list`;
  const selectedDevices = [...new Map(
    installTargets
      .filter((target) => state.collectionTargets.has(target.id))
      .map((target) => [target.device, target]),
  ).values()];
  if (!selectedDevices.length) return "<请选择至少一个更新目标>";
  const command = `npx skills update ${item.updateSkills.join(" ")} --global --yes`;
  return selectedDevices.map((target) => (target.host ? `ssh ${target.host} "${command}"` : command)).join("\n");
}

function reconcileCommand(rows = compareRows().filter((row) => row.status !== "matched")) {
  const names = rows.slice(0, 4).map((row) => row.name).join(" ") || "<selected-skills>";
  const destination = compareTarget(state.compareRightTarget);
  const command = `npx skills update ${names} --global --yes`;
  return destination.host ? `ssh ${destination.host} "cd ~/workspace && ${command}"` : command;
}

function mobileViewNav() {
  return `<div class="mobile-view-nav">${viewTabs()}</div>`;
}

function variantA() {
  return `<div class="prototype-shell variant-a">${appHeader()}${mobileViewNav()}<div class="variant-a__body">${scopeTree()}<main class="main-region">${currentMain()}</main>${inspector()}</div></div>`;
}

function variantB() {
  return `<div class="prototype-shell variant-b">${appHeader()}<div class="command-nav"><div>${viewTabs()}</div><div class="command-search">${icon("search", 16)}<span>${state.view === "compare" ? "选择两个目标开始比较" : "搜索或输入 npx skills 命令"}</span><kbd>⌘K</kbd></div><button class="button button--secondary" type="button" data-refresh>${icon("refresh-cw", 15)}扫描</button></div>${variantBBody()}</div>`;
}

function variantBBody() {
  if (state.view === "compare") {
    return `<main class="variant-b__body"><section class="compare-stage">${compareMain()}</section><aside class="summary-rail">${diffInspector()}</aside></main>`;
  }
  if (state.view === "collections") {
    return `<main class="variant-b__body"><aside class="filter-rail"><h2>来源目录</h2>${collectionList()}</aside><section class="focus-stage"><div class="page-heading page-heading--compact"><div><h1>精选套装</h1><p>选择来源，确认内容，再生成 npx skills 安装计划。</p></div></div>${collectionDetail()}</section><aside class="summary-rail">${commandInspector(collectionCommand())}</aside></main>`;
  }
  const scopeFilters = [
    ["all", "全部", state.skills.length],
    ["project", "项目", state.skills.filter((item) => item.scope === "project").length],
    ["global", "全局", state.skills.filter((item) => item.scope === "global").length],
  ]
    .map(([scope, label, count]) => `<button class="filter-row ${state.scope === scope ? "is-active" : ""}" type="button" data-scope="${scope}">${label} <span>${count}</span></button>`)
    .join("");
  return `<main class="variant-b__body"><aside class="filter-rail"><h2>安装范围</h2><div class="filter-stack">${scopeFilters}</div><h2>Harness</h2><div class="tag-cluster tag-cluster--vertical"><span>Codex</span><span>Pi</span><span>Claude Code</span></div></aside><section class="focus-stage"><div class="page-heading page-heading--compact"><div><h1>本机 Skills</h1><p>${state.skills.length} 项来自 npx skills</p></div>${inventoryToolbar()}</div>${inventoryTable()}</section><aside class="summary-rail">${inspector()}</aside></main>`;
}

function variantC() {
  return `<div class="prototype-shell variant-c">${appHeader()}${mobileViewNav()}<div class="variant-c__body"><aside class="fleet-tree"><div class="fleet-tree__header"><h2>设备编排</h2><button class="icon-button" type="button" aria-label="添加设备">${icon("plus", 15)}</button></div>${viewTabs(true)}<div class="fleet-group"><h3>本机</h3><button class="fleet-item is-active" type="button">${icon("laptop", 15)}<span>local-dev</span><small>已连接</small></button></div><div class="fleet-group"><h3>远程 SSH</h3><button class="fleet-item" type="button">${icon("server", 15)}<span>build-box</span><small>已连接</small></button><button class="fleet-item" type="button">${icon("server-off", 15)}<span>gpu-lab</span><small>离线</small></button></div></aside><main class="lane-stage">${fleetLanes()}</main><aside class="collection-rail">${fleetRightRail()}</aside></div></div>`;
}

function fleetLanes() {
  if (state.view === "collections") return collectionTargetLanes();
  const lanes = state.view === "compare"
    ? [
        { icon: "laptop", name: "local-dev", skills: state.skills, subtitle: "本机" },
        { icon: "server", name: "build-box", skills: remoteSkills, subtitle: "SSH" },
        { icon: "server", name: "design-mac", skills: fallbackSkills.slice(2, 9), subtitle: "SSH" },
      ]
    : [
        { icon: "square-terminal", name: "Codex", skills: skillsForAgent("Codex"), subtitle: "Harness" },
        { icon: "square-terminal", name: "Pi", skills: skillsForAgent("Pi"), subtitle: "Harness" },
        { icon: "square-terminal", name: "Claude Code", skills: skillsForAgent("Claude Code"), subtitle: "Harness" },
      ];
  return `<div class="lane-header"><div><h1>${state.view === "compare" ? "设备差异" : "Harness 分布"}</h1><p>${state.view === "compare" ? "同名 skill 在各设备上的存在性与修订" : "本机同一份 skill 在不同 harness 的可见性"}</p></div><button class="button button--secondary" type="button" data-refresh>${icon("refresh-cw", 15)}扫描</button></div><div class="machine-lanes">${lanes.map(machineLane).join("")}</div>`;
}

function machineLane(lane, index) {
  const rows = lane.skills.slice(0, 9);
  return `<section class="machine-lane"><div class="machine-lane__header"><span class="machine-icon">${icon(lane.icon, 17)}</span><div><h2>${escapeHtml(lane.name)}</h2><small>${lane.subtitle}</small></div><span class="lane-count">${lane.skills.length}</span></div><div class="lane-skills">${rows
    .map((item) => {
      const compare = remoteSkills.find((remote) => remote.name === item.name);
      const drift = state.view === "compare" && index > 0 && compare && item.revision && item.revision !== compare.revision;
      return `<div class="lane-skill ${drift ? "has-drift" : ""}"><span>${icon("file-terminal", 14)}${escapeHtml(item.name)}</span><code>${escapeHtml(item.revision || "未知")}</code></div>`;
    })
    .join("")}${lane.skills.length > rows.length ? `<div class="lane-more">另有 ${lane.skills.length - rows.length} 项</div>` : ""}</div></section>`;
}

function collectionTargetLanes() {
  const item = selectedCollection();
  return `<div class="lane-header"><div><h1>选择安装目标</h1><p>${escapeHtml(item.source)} 将通过 npx skills 安装。</p></div></div><div class="target-lanes">${installTargets
    .map(
      (target) => {
        const checked = state.collectionTargets.has(target.id);
        return `<label class="target-lane"><input type="checkbox" data-collection-target="${target.id}" ${checked ? "checked" : ""} /><span class="machine-icon">${icon(target.host ? "server" : "laptop", 17)}</span><span><strong>${target.device}</strong><small>${target.agent}</small></span><span class="target-status">${checked ? "已选择" : "未选择"}</span></label>`;
      },
    )
    .join("")}</div>`;
}

function fleetRightRail() {
  if (state.view === "collections") return `${collectionList()}${collectionDetail()}${commandPreview(state.commandPlan || collectionCommand())}`;
  if (state.view === "compare") return `${diffInspector()}`;
  const item = selectedSkill();
  return `<div class="rail-heading"><h2>当前选择</h2><span>local-dev</span></div>${item ? `<div class="rail-skill"><span class="collection-icon">${icon("file-terminal", 17)}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.source || "本地目录")}</p></div>${commandPreview(updateCommand(item))}` : emptyState("无 Skill", "等待本机扫描完成。")}`;
}

function skillsForAgent(agent) {
  const matches = state.skills.filter((item) => item.agents?.includes(agent));
  return matches.length ? matches : fallbackSkills.filter((item) => item.agents.includes(agent));
}

function loadingState(message) {
  return `<div class="message-state"><div class="skeleton-lines" aria-hidden="true"><span></span><span></span><span></span></div><h2>${escapeHtml(message)}</h2><p>只执行读取命令，不会修改本机 skills。</p></div>`;
}

function errorState(message) {
  return `<div class="message-state message-state--error">${icon("circle-alert", 22)}<h2>读取失败</h2><p>${escapeHtml(message)}</p><button class="button button--secondary" type="button" data-refresh>重试</button></div>`;
}

function emptyState(title, body) {
  return `<div class="message-state">${icon("package-search", 22)}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>`;
}

function shortPath(pathValue) {
  const parts = String(pathValue || "").split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || "本机工作区";
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "刚刚";
  }
}

function prototypeTools() {
  const enabled = import.meta.env.DEV || searchParams.get("prototype") === "1";
  if (!enabled) return "";
  const current = prototypeVariants.find(({ key }) => key === state.variant);
  const index = prototypeVariants.indexOf(current);
  const stateSnapshot = {
    collection: state.collectionId,
    collectionTargets: [...state.collectionTargets],
    compareTargets: [state.compareLeftTarget, state.compareRightTarget],
    mode: state.mode,
    query: state.query,
    scope: state.scope,
    skills: state.skills.length,
    variant: state.variant,
    view: state.view,
  };
  return `<details class="state-readout"><summary>${icon("braces", 14)}State</summary><pre>${escapeHtml(JSON.stringify(stateSnapshot, null, 2))}</pre></details><div class="prototype-switcher" role="group" aria-label="原型方案切换"><button type="button" data-cycle="-1" aria-label="上一个方案">${icon("arrow-left", 16)}</button><span>${current.key} · ${current.name}</span><button type="button" data-cycle="1" aria-label="下一个方案">${icon("arrow-right", 16)}</button><small>${index + 1}/${prototypeVariants.length}</small></div>`;
}

function render() {
  setUrl();
  const renderer = { A: variantA, B: variantB, C: variantC }[state.variant];
  app.innerHTML = `${renderer()}${prototypeTools()}${state.toast ? `<div class="toast" role="status">${icon("check", 15)}${escapeHtml(state.toast)}</div>` : ""}`;
  createIcons({ icons, attrs: { "stroke-width": 1.75 } });
}

async function refreshSkills() {
  state.loading = true;
  state.error = "";
  render();
  try {
    const result = window.skillsDesktop
      ? await window.skillsDesktop.listLocalSkills()
      : await new Promise((resolve) => window.setTimeout(() => resolve({ cliVersion: "1.5.23", scannedAt: new Date().toISOString(), skills: fallbackSkills, workspaceRoot: "agent-monorepo" }), 350));
    state.cliVersion = result.cliVersion;
    state.scannedAt = result.scannedAt;
    state.skills = result.skills;
    state.workspaceRoot = result.workspaceRoot;
    state.selectedSkillId = skillId(result.skills.find((item) => item.name === "prototype") || result.skills[0]);
  } catch (error) {
    state.error = error instanceof Error ? error.message : "npx skills 返回了无法解析的结果。";
    state.skills = [];
  } finally {
    state.loading = false;
    render();
  }
}

function cycleVariant(direction) {
  const index = prototypeVariants.findIndex(({ key }) => key === state.variant);
  state.variant = prototypeVariants[(index + direction + prototypeVariants.length) % prototypeVariants.length].key;
  state.commandPlan = "";
  render();
}

function setCommand(action) {
  const item = selectedSkill();
  if (action === "update" && item) state.commandPlan = updateCommand(item);
  if (action === "remove" && item) state.commandPlan = removeCommand(item);
  if (action === "reconcile") state.commandPlan = reconcileCommand();
  if (action === "install-collection") state.commandPlan = collectionCommand();
  if (action === "update-collection") state.commandPlan = collectionUpdateCommand();
  if (action === "list-collection") state.commandPlan = `npx skills add ${selectedCollection().source} --list`;
  state.toast = "命令计划已更新，未执行";
  render();
  window.setTimeout(() => {
    state.toast = "";
    render();
  }, 1600);
}

app.addEventListener("click", async (event) => {
  const target = event.target.closest("button, [data-collection]");
  if (!target) return;
  if (target.dataset.view) {
    state.view = target.dataset.view;
    state.commandPlan = "";
    render();
  }
  if (target.dataset.cycle) cycleVariant(Number(target.dataset.cycle));
  if (target.hasAttribute("data-swap-targets")) {
    [state.compareLeftTarget, state.compareRightTarget] = [state.compareRightTarget, state.compareLeftTarget];
    state.commandPlan = "";
    render();
  }
  if (target.dataset.scope) {
    state.scope = target.dataset.scope;
    render();
  }
  if (target.dataset.skill) {
    state.selectedSkillId = target.dataset.skill;
    state.commandPlan = "";
    render();
  }
  if (target.dataset.collection) {
    state.collectionId = target.dataset.collection;
    state.commandPlan = "";
    render();
  }
  if (target.dataset.command) setCommand(target.dataset.command);
  if (target.hasAttribute("data-refresh")) await refreshSkills();
  if (target.hasAttribute("data-copy-command")) {
    const command = target.closest(".command-preview")?.querySelector("code")?.textContent || "";
    await navigator.clipboard?.writeText(command);
    state.toast = "命令已复制";
    render();
    window.setTimeout(() => {
      state.toast = "";
      render();
    }, 1400);
  }
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-search]")) {
    state.query = event.target.value;
    render();
    const input = app.querySelector("[data-search]");
    input?.focus();
    input?.setSelectionRange(state.query.length, state.query.length);
  }
  if (event.target.matches("[data-diffs-only]")) {
    state.showOnlyDiffs = event.target.checked;
    render();
  }
  if (event.target.matches("[data-compare-target]")) {
    const key = event.target.dataset.compareTarget === "left" ? "compareLeftTarget" : "compareRightTarget";
    state[key] = event.target.value;
    state.commandPlan = "";
    render();
  }
  if (event.target.matches("[data-collection-target]")) {
    if (event.target.checked) state.collectionTargets.add(event.target.dataset.collectionTarget);
    else state.collectionTargets.delete(event.target.dataset.collectionTarget);
    state.commandPlan = "";
    render();
  }
});

window.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.target.matches("input, textarea, select, [contenteditable='true']")) return;
  event.preventDefault();
  cycleVariant(event.key === "ArrowRight" ? 1 : -1);
});

render();
void refreshSkills();
