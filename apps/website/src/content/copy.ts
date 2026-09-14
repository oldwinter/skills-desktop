import type { Locale } from "./locale.js";

export interface Bullet {
  readonly title: string;
  readonly body: string;
}

export interface FeatureCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly bullets: readonly Bullet[];
  readonly screenshotAlt: string;
}

export interface Copy {
  readonly meta: {
    readonly title: string;
    readonly description: string;
  };
  readonly nav: {
    readonly harnesses: string;
    readonly inventory: string;
    readonly compare: string;
    readonly collections: string;
    readonly cli: string;
    readonly github: string;
    readonly download: string;
    readonly switchLocale: string;
    readonly switchLocaleLabel: string;
  };
  readonly hero: {
    readonly eyebrow: string;
    readonly titleLines: readonly [string, string];
    readonly lead: string;
    readonly definition: string;
    readonly download: string;
    readonly viewSource: string;
    readonly meta: string;
    readonly stats: {
      readonly harnesses: string;
      readonly cli: string;
      readonly platforms: string;
      readonly telemetry: string;
    };
    readonly figure: {
      readonly label: string;
      readonly inventory: string;
      readonly inventoryPath: string;
      readonly targets: string;
      readonly targetsHint: string;
      readonly harnesses: string;
      readonly harnessesPath: string;
      readonly scopeProject: string;
      readonly scopeGlobal: string;
      readonly summary: (skills: number, harnesses: number) => string;
      readonly freshness: string;
      readonly caption: string;
    };
  };
  readonly harnesses: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly showAll: (total: number) => string;
    readonly showFewer: string;
    readonly count: (total: number) => string;
    readonly footnote: string;
    readonly projectOnly: string;
  };
  readonly inventory: FeatureCopy;
  readonly mutation: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly screenshotAlt: string;
  };
  readonly compare: FeatureCopy;
  readonly collections: FeatureCopy;
  readonly safety: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly bullets: readonly Bullet[];
  };
  readonly cli: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly tabs: Readonly<Record<"verify" | "list" | "add" | "remove" | "update", string>>;
    readonly comments: Readonly<Record<"verify" | "list" | "add" | "remove" | "update", string>>;
    readonly argumentArray: string;
    readonly preview: string;
    readonly copy: string;
    readonly copied: string;
    readonly footnote: string;
  };
  readonly download: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly latest: (version: string) => string;
    readonly allReleases: string;
    readonly recommended: string;
    readonly platforms: Readonly<Record<"macos" | "windows" | "linux", { readonly title: string; readonly requirement: string }>>;
    readonly assets: Readonly<Record<string, string>>;
    readonly verifyTitle: string;
    readonly verifyBody: string;
    readonly guide: string;
  };
  readonly footer: {
    readonly tagline: string;
    readonly links: {
      readonly releases: string;
      readonly issues: string;
      readonly changelog: string;
      readonly userGuide: string;
      readonly context: string;
      readonly adrs: string;
      readonly preview: string;
      readonly contributing: string;
    };
    readonly license: string;
    readonly builtBy: string;
  };
}

const en: Copy = {
  cli: {
    argumentArray: "Argument array handed to npx",
    body:
      "Skills Desktop does not replace the CLI, wrap it in a shell, or scan skill folders on its own. Every observation and mutation is a closed argument array handed to the pinned skills@1.5.23 package, and the app refuses to proceed when the installed CLI reports any other version.",
    comments: {
      add: "# add exact skill names from one GitHub source to explicit harnesses",
      list: "# observe one scope; the project scope runs the same call without --global",
      remove: "# remove exact names from explicit harnesses in one scope",
      update: "# update exact names in one scope; update-all is a separate intent",
      verify: "# every Target open starts by proving the dialect",
    },
    copied: "copied",
    copy: "copy",
    eyebrow: "Built on npx skills",
    footnote:
      "The main process resolves npx itself, runs with shell: false, caps output size, and never executes the preview strings a renderer displays.",
    preview: "Command Plan preview (explanatory, never executed)",
    tabs: { add: "Add", list: "List", remove: "Remove", update: "Update", verify: "Verify" },
    title: "The CLI stays authoritative. The app makes it reviewable.",
  },
  collections: {
    body:
      "An Official Collection is a reviewed recipe: exact skill names from one existing source, bound to a reviewed Git revision and a review receipt. It can produce mutation intents for your Local Targets. It never owns installed skills, never defines desired state, and never becomes a second installer.",
    bullets: [
      {
        body: "Each release carries author, independent reviewer, review time and policy. Matching metadata never lets a user package borrow that trust.",
        title: "Official review trust root",
      },
      {
        body: "Missing, present-content-unknown, source-conflict, removal-candidate and incompatible stay distinct. Nothing is assumed compatible.",
        title: "Per-Target assessment",
      },
      {
        body: "A Collection Plan aggregates exact per-Target Command Plans. Confirming it authorizes single-use child mutations, not a cross-machine transaction.",
        title: "Plans, not transactions",
      },
      {
        body: "A newer release is a Collection Update. It is not evidence that installed skills drifted, and deprecated or revoked releases never remove anything by themselves.",
        title: "Releases, not upstream drift",
      },
    ],
    eyebrow: "Collections",
    screenshotAlt: "The Collections view listing an Official Collection release with per-Target assessments and Prepare plan",
    title: "Reviewed recipes, not desired state.",
  },
  compare: {
    body:
      "Pick two Local Targets and Skills Desktop aligns their inventories by skill name. Every dimension survives the diff: presence per scope, declared source, per-harness coverage, revision, content fingerprint and freshness. Nothing collapses into a single green or red badge.",
    bullets: [
      {
        body: "Hide exact matches and keep only differences and unknown evidence. Search by name stacks on top; Escape clears it without losing the filter.",
        title: "Differences only",
      },
      {
        body: "Source mismatch, unknown evidence and revision or content drift are separate outcomes. A path is evidence, not identity, and unknown stays unknown.",
        title: "Dimensions preserved",
      },
      {
        body: "Arrow keys, Home and End move through visible rows; Enter or Space selects. Both sides show their evidence side by side.",
        title: "Keyboard first",
      },
    ],
    eyebrow: "Comparison",
    screenshotAlt: "The Comparison view aligning two Local Targets with per-dimension outcomes",
    title: "Two Targets, every dimension.",
  },
  download: {
    allReleases: "All releases, checksums and attestations",
    assets: {
      linuxDeb: "Debian (.deb)",
      linuxRpm: "Fedora (.rpm)",
      macosArm: "Apple silicon (.dmg)",
      macosIntel: "Intel (.dmg)",
      windowsSetup: "Installer (.exe)",
    },
    body:
      "The current public build is an Unsigned Developer Preview: a GitHub prerelease with SHA-256 checksums, an SPDX SBOM and artifact attestations, but no Apple or Windows publisher trust. It is never marked latest and never enters an automatic update feed. Verify the bytes first, then follow the platform-owned override steps.",
    eyebrow: "Get it",
    guide: "Installation and verification guide",
    latest: (version) => `Latest preview v${version}`,
    platforms: {
      linux: { requirement: "64-bit (x86_64) only", title: "Linux" },
      macos: { requirement: "macOS 13 or later, not notarized", title: "macOS" },
      windows: { requirement: "64-bit (x64) only, unsigned", title: "Windows" },
    },
    recommended: "Recommended",
    title: "Download the Unsigned Developer Preview",
    verifyBody: "Download SHA256SUMS next to the asset and compare before installing. Stop if the line does not match.",
    verifyTitle: "Verify before you install",
  },
  footer: {
    builtBy: "Built by",
    license: "MIT licensed",
    links: {
      adrs: "Architecture decisions",
      changelog: "Changelog",
      context: "Domain language (CONTEXT.md)",
      contributing: "Contributing",
      issues: "Issues",
      preview: "Unsigned preview guide",
      releases: "Releases",
      userGuide: "User guide",
    },
    tagline: "A desktop client that makes the pinned npx skills CLI observable, comparable and reviewable.",
  },
  harnesses: {
    body:
      "Skills Desktop never writes into a harness folder itself. Every add, remove and update is an argument array handed to the pinned skills@1.5.23 CLI, addressed by the exact --agent ids below. Display names are presentation only and never become CLI input, so a renamed harness cannot change what runs.",
    count: (total) => `${total} harnesses in the pinned registry`,
    eyebrow: "Supported harnesses",
    footnote:
      "Missing one? The registry is reviewed alongside the CLI dialect. New harnesses arrive with a pinned CLI upgrade, not with a hand-typed path.",
    projectOnly: "project scope only",
    showAll: (total) => `Show all ${total} harnesses`,
    showFewer: "Show fewer",
    title: "It speaks the CLI's own harness names.",
  },
  hero: {
    definition:
      "A skill is a folder with a SKILL.md in it — reusable instructions your agent loads when the task calls for them.",
    download: "Download preview",
    eyebrow: "the skills desktop",
    figure: {
      caption:
        "Pick a Target. Skills Desktop observes it through one npx skills list --json call per scope and shows which harnesses are covered. Nothing is written until you confirm a Command Plan.",
      freshness: "Fresh evidence",
      harnesses: "Harness coverage",
      harnessesPath: "--agent <id>",
      inventory: "Inventory · Local Target",
      inventoryPath: "npx skills list --json",
      label: "one inventory, one Target at a time",
      scopeGlobal: "global",
      scopeProject: "project",
      summary: (skills, harnesses) => `${skills} skills → ${harnesses} harnesses`,
      targets: "Targets",
      targetsHint: "click a Target",
    },
    lead:
      "Observe project and global skills for a Local Target through the pinned npx skills CLI, compare Targets dimension by dimension, and never run a change without a Trusted Review.",
    meta: "v0.1.0 Unsigned Developer Preview · macOS · Windows · Linux · MIT · no account, no telemetry, Local-only in V1",
    stats: {
      cli: "pinned CLI dialect",
      harnesses: "harnesses in the registry",
      platforms: "desktop platforms",
      telemetry: "telemetry endpoints",
    },
    titleLines: ["One inventory.", "Every harness."],
    viewSource: "View source",
  },
  inventory: {
    body:
      "Inventory is one normalized observation of a Local Target through npx skills list --json, covering the project and global scopes at once. It is a snapshot, not a second source of truth, and the app tells you exactly how much to trust it.",
    bullets: [
      {
        body: "Fresh evidence means a complete observation in this session. Stale evidence is kept for reading and comparing after a failed refresh, a Target change or a restart — but it can never authorize a change.",
        title: "Fresh, stale or none",
      },
      {
        body: "Filter by name or source, switch All, Project and Global, and clear everything with one action. The selected row shows scope, harness agents, source type, declared source, revision and fingerprint.",
        title: "Search and filter",
      },
      {
        body: "Revisions and content fingerprints appear only when the CLI reports them. Unknown stays Unknown; it is never turned into an invented semantic version.",
        title: "Evidence, not guesses",
      },
    ],
    eyebrow: "Inventory",
    screenshotAlt: "The Inventory view with Fresh evidence, a project-and-global skill table and skill evidence details",
    title: "One observation, both scopes.",
  },
  meta: {
    description:
      "Skills Desktop inspects, compares and plans agent Skill changes across harnesses through the pinned npx skills CLI. Local-only, open source, no telemetry.",
    title: "Skills Desktop — one inventory for every harness",
  },
  mutation: {
    body:
      "Add takes a GitHub source and exact skill names. Update and removal start from a selected row. Each one produces a Command Plan you read before anything runs, and the plan is only available while the inventory is fresh and no reconciliation is pending.",
    eyebrow: "Mutation",
    screenshotAlt: "The Add Skill form with source, exact skill name, scope and the Prepare add action",
    title: "Prepare, review, then execute.",
  },
  nav: {
    cli: "CLI",
    collections: "Collections",
    compare: "Compare",
    download: "Download",
    github: "GitHub",
    harnesses: "Harnesses",
    inventory: "Inventory",
    switchLocale: "中文",
    switchLocaleLabel: "切换到中文",
  },
  safety: {
    body:
      "Every mutation follows the same path: Prepare → Command Plan → Trusted Review → execute. The ordinary window can ask for a review; only the isolated review surface can approve it, and approval never crosses IPC as execution authority.",
    bullets: [
      {
        body: "A Prepared Mutation is bound to one Target and one fresh Inventory. Stale evidence, an open review or a pending reconciliation disables Prepare.",
        title: "Fresh evidence gate",
      },
      {
        body: "Command Plan strings are explanatory output. The main process runs argument arrays with shell: false; renderer text never becomes a command.",
        title: "Preview strings never run",
      },
      {
        body: "Approval is a single-use decision on one exact projection, taken in a role-bound window with no Node access. Any change to the plan needs a new confirmation.",
        title: "Trusted Review is isolated",
      },
      {
        body: "A durable Mutation Guard is written before a change starts. If the outcome is uncertain or the app restarts mid-flight, the Target enters Reconciliation Required until a fresh Inventory is established.",
        title: "Guards and reconciliation",
      },
    ],
    eyebrow: "Safety",
    title: "Nothing runs without a Trusted Review.",
  },
};

const zh: Copy = {
  cli: {
    argumentArray: "交给 npx 的参数数组",
    body:
      "Skills Desktop 不替代 CLI，不用 shell 包一层，也不自己扫描技能目录。每一次观察与变更都是交给 pinned skills@1.5.23 包的封闭参数数组；只要本机 CLI 报告的不是这个版本，应用就拒绝继续。",
    comments: {
      add: "# 从一个 GitHub 源，把精确技能名加到显式指定的 harness",
      list: "# 观察一个 scope；project scope 用同一调用但不带 --global",
      remove: "# 在一个 scope 内，从显式 harness 移除精确名称",
      update: "# 在一个 scope 内更新精确名称；update-all 是另一种 intent",
      verify: "# 每次打开 Target 都先证明方言版本",
    },
    copied: "已复制",
    copy: "复制",
    eyebrow: "基于 npx skills",
    footnote:
      "主进程自行解析 npx，以 shell: false 运行，限制输出大小，并且永远不会执行渲染层展示的预览字符串。",
    preview: "Command Plan 预览（仅供审阅，不会执行）",
    tabs: { add: "Add", list: "List", remove: "Remove", update: "Update", verify: "Verify" },
    title: "CLI 仍是权威，应用让它可审阅。",
  },
  collections: {
    body:
      "Official Collection 是经审阅的菜谱：从一个已有源中点名若干技能，绑定到已审阅的 Git revision 与 review receipt。它可以为 Local Target 生成变更意图，但从不拥有已安装技能、不定义期望状态、也不会变成第二套安装器。",
    bullets: [
      {
        body: "每个 release 都带作者、独立审阅者、审阅时间与策略。元数据相同并不能让 User Package 借用 Official 信任。",
        title: "Official 审阅信任根",
      },
      {
        body: "missing、present-content-unknown、source-conflict、removal-candidate、incompatible 各自保留，不会被假定兼容。",
        title: "逐 Target 评估",
      },
      {
        body: "Collection Plan 汇总每个 Target 的精确 Command Plan。确认它只授权一次性的子变更，不构成跨机事务。",
        title: "是计划，不是事务",
      },
      {
        body: "更新的 release 是 Collection Update，不是已装技能漂移的证据；deprecated 或 revoked 的 release 也不会自动移除任何东西。",
        title: "Release，而非上游漂移",
      },
    ],
    eyebrow: "Collections",
    screenshotAlt: "Collections 视图：一个 Official Collection release、逐 Target 评估与 Prepare plan",
    title: "经审阅的菜谱，而不是期望状态。",
  },
  compare: {
    body:
      "选两个 Local Target，Skills Desktop 按技能名对齐它们的清单。每个维度都在 diff 中保留：各 scope 是否存在、declared source、逐 harness 覆盖、revision、content fingerprint 与新鲜度，不会压成一个红绿徽标。",
    bullets: [
      {
        body: "隐藏完全匹配项，只留差异与未知证据。按名称搜索可叠加；Escape 清空搜索但保留筛选。",
        title: "只看差异",
      },
      {
        body: "Source mismatch、Unknown evidence、Revision or content drift 是不同结果。路径只是证据不是身份，未知就保持未知。",
        title: "维度不折叠",
      },
      {
        body: "方向键、Home、End 在可见行间移动；Enter 或空格选中。两侧证据并排展示。",
        title: "键盘优先",
      },
    ],
    eyebrow: "Comparison",
    screenshotAlt: "Comparison 视图：两个 Local Target 按维度对齐的结果",
    title: "两个 Target，每个维度。",
  },
  download: {
    allReleases: "全部 release、校验和与 attestation",
    assets: {
      linuxDeb: "Debian (.deb)",
      linuxRpm: "Fedora (.rpm)",
      macosArm: "Apple silicon (.dmg)",
      macosIntel: "Intel (.dmg)",
      windowsSetup: "安装程序 (.exe)",
    },
    body:
      "当前公开构建是 Unsigned Developer Preview：带 SHA-256 校验和、SPDX SBOM 与产物 attestation 的 GitHub prerelease，但没有 Apple 或 Windows 发布者信任。它永远不会标为 latest，也不会进入自动更新源。先校验字节，再按平台自带的覆盖步骤安装。",
    eyebrow: "获取",
    guide: "安装与校验指南",
    latest: (version) => `最新预览 v${version}`,
    platforms: {
      linux: { requirement: "仅 64 位 (x86_64)", title: "Linux" },
      macos: { requirement: "macOS 13 或更高，未公证", title: "macOS" },
      windows: { requirement: "仅 64 位 (x64)，未签名", title: "Windows" },
    },
    recommended: "推荐",
    title: "下载 Unsigned Developer Preview",
    verifyBody: "把 SHA256SUMS 与产物一起下载，安装前先比对。对应行不一致就停止。",
    verifyTitle: "安装前先校验",
  },
  footer: {
    builtBy: "由",
    license: "MIT 许可",
    links: {
      adrs: "架构决策记录",
      changelog: "变更日志",
      context: "领域语言 (CONTEXT.md)",
      contributing: "参与贡献",
      issues: "Issues",
      preview: "Unsigned 预览指南",
      releases: "Releases",
      userGuide: "用户手册",
    },
    tagline: "让 pinned npx skills CLI 可观察、可对比、可审阅的桌面客户端。",
  },
  harnesses: {
    body:
      "Skills Desktop 从不自己往 harness 目录写文件。每次 add、remove、update 都是交给 pinned skills@1.5.23 CLI 的参数数组，用下面这些精确的 --agent id 寻址。显示名只用于展示，永远不会成为 CLI 输入，所以改个名字不可能改变实际运行的内容。",
    count: (total) => `pinned 注册表中共 ${total} 个 harness`,
    eyebrow: "支持的 harness",
    footnote: "少了哪一个？注册表随 CLI 方言一起审阅。新 harness 随 pinned CLI 升级到来，而不是靠手填一条路径。",
    projectOnly: "仅 project scope",
    showAll: (total) => `展开全部 ${total} 个 harness`,
    showFewer: "收起",
    title: "它说的是 CLI 自己的 harness 名字。",
  },
  hero: {
    definition: "Skill 是一个带 SKILL.md 的文件夹——在任务需要时，agent 会加载的可复用指令。",
    download: "下载预览版",
    eyebrow: "the skills desktop",
    figure: {
      caption:
        "选一个 Target。Skills Desktop 对每个 scope 各执行一次 npx skills list --json 来观察它，并显示覆盖了哪些 harness。在你确认 Command Plan 之前，什么都不会被写入。",
      freshness: "Fresh evidence",
      harnesses: "Harness 覆盖",
      harnessesPath: "--agent <id>",
      inventory: "Inventory · Local Target",
      inventoryPath: "npx skills list --json",
      label: "一份清单，一次一个 Target",
      scopeGlobal: "global",
      scopeProject: "project",
      summary: (skills, harnesses) => `${skills} 个技能 → ${harnesses} 个 harness`,
      targets: "Targets",
      targetsHint: "点一个 Target",
    },
    lead: "通过 pinned 的 npx skills CLI 观察 Local Target 的 project 与 global 技能，按维度对比多个 Target，并且没有 Trusted Review 就绝不执行任何变更。",
    meta: "v0.1.0 Unsigned Developer Preview · macOS · Windows · Linux · MIT · 无账号、无遥测，V1 仅支持本机",
    stats: {
      cli: "pinned CLI 方言",
      harnesses: "注册表中的 harness",
      platforms: "桌面平台",
      telemetry: "遥测端点",
    },
    titleLines: ["一份清单。", "每个 harness。"],
    viewSource: "查看源码",
  },
  inventory: {
    body:
      "Inventory 是对 Local Target 一次 npx skills list --json 的归一化观察，同时覆盖 project 与 global 两个 scope。它是快照而不是第二份真相源，应用会明确告诉你能信它多少。",
    bullets: [
      {
        body: "Fresh evidence 表示本会话内完成了一次完整观察。刷新失败、Target 变更或重启后保留的是 Stale evidence——可以查看和对比，但永远不能授权变更。",
        title: "Fresh、Stale 或 None",
      },
      {
        body: "按名称或来源过滤，在 All / Project / Global 之间切换，一键清空。选中行会显示 scope、harness agents、source type、declared source、revision 与 fingerprint。",
        title: "搜索与筛选",
      },
      {
        body: "只有 CLI 报告了 revision 与 content fingerprint 才会显示。Unknown 就是 Unknown，不会被编造成一个语义化版本号。",
        title: "证据，而非猜测",
      },
    ],
    eyebrow: "Inventory",
    screenshotAlt: "Inventory 视图：Fresh evidence、project 与 global 技能表以及技能证据详情",
    title: "一次观察，两个 scope。",
  },
  meta: {
    description: "Skills Desktop 通过 pinned 的 npx skills CLI 检查、对比并规划跨 harness 的 agent Skill 变更。仅本机、开源、无遥测。",
    title: "Skills Desktop — 每个 harness 共用一份清单",
  },
  mutation: {
    body:
      "Add 需要一个 GitHub 源与精确技能名；Update 与 Removal 从选中的行开始。每种操作都会先生成一份你能读完的 Command Plan，而且只有在清单为 fresh、且没有待处理的 reconciliation 时才可用。",
    eyebrow: "变更",
    screenshotAlt: "Add Skill 表单：来源、精确技能名、scope 与 Prepare add 操作",
    title: "先准备，再审阅，然后执行。",
  },
  nav: {
    cli: "CLI",
    collections: "Collections",
    compare: "对比",
    download: "下载",
    github: "GitHub",
    harnesses: "Harness",
    inventory: "清单",
    switchLocale: "English",
    switchLocaleLabel: "Switch to English",
  },
  safety: {
    body:
      "每次变更都走同一条路：Prepare → Command Plan → Trusted Review → 执行。普通窗口只能请求审阅；只有隔离的审阅界面能批准，而批准永远不会作为执行权限穿过 IPC。",
    bullets: [
      {
        body: "Prepared Mutation 绑定一个 Target 与一份 fresh Inventory。Stale 证据、打开中的审阅或待处理的 reconciliation 都会禁用 Prepare。",
        title: "Fresh evidence 门禁",
      },
      {
        body: "Command Plan 字符串只是说明性输出。主进程以 shell: false 运行参数数组；渲染层文本永远不会变成命令。",
        title: "预览字符串从不执行",
      },
      {
        body: "批准是对一个精确投影的一次性决定，在没有 Node 访问权的角色绑定窗口中做出。计划有任何改动都要重新确认。",
        title: "Trusted Review 隔离",
      },
      {
        body: "变更开始前会先写入持久的 Mutation Guard。结果不确定或应用中途重启时，Target 进入 Reconciliation Required，直到建立新的 fresh Inventory。",
        title: "Guard 与 reconciliation",
      },
    ],
    eyebrow: "安全",
    title: "没有 Trusted Review，什么都不会运行。",
  },
};

export const COPY: Readonly<Record<Locale, Copy>> = { en, zh };
