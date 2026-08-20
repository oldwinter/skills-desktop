# Skills Desktop Prototype Design System

## 0. Research Log

- Prototype question: three desktop information architectures for local inventory, cross-target diff, and curated skill bundles, switchable with `?variant=A|B|C`.
- Embedded refs: shortlisted Vercel, Warp, and Linear; picked `taste-skill` + Vercel because the tool needs developer-grade precision and quiet depth rather than decorative chrome.
- Lazyweb: 3 queries, 5 screens viewed (Atom Mobility, ChargePoint, DeepSource, Brave, monday.com); retained fixed scope navigation, dense central inventory, visible comparison context, and searchable collection catalogs.
- Imagen drafts: `research/concept-a-inventory.png`, `research/concept-b-diff.png`, and `research/concept-c-fleet.png`; concept A is the material and hierarchy contract, while B and C supply task-specific layout grammar.
- Product research: `npx skills` 1.5.23 exposes `list --json`, agent filtering, `add --list`, `add`, `remove`, `update`, and lockfile restore. Installed skills do not have a package-style semantic version; the UI therefore uses presence, source, update timestamp, and content revision/hash language rather than inventing a version.

## 1. Atmosphere & Identity

A quiet workshop for people who already live in terminals. The surface is dense, exact, and calm: a user should always know which machine, harness, scope, and command will be affected. The signature is a three-part reading line - target context on the left, skills evidence in the center, and an inspectable command plan on the right.

Personas:

- A solo developer with Codex and Pi installed locally who needs to understand duplication without learning every skill directory convention.
- A platform engineer comparing a laptop with SSH build machines, often under time pressure and with long paths or partial connectivity.
- A keyboard and screen-reader user who needs predictable focus order, explicit status text, and no color-only diff meaning.

## 2. Color

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Canvas | `--surface-canvas` | `#f5f6f7` | App background |
| Surface | `--surface-primary` | `#ffffff` | Fixed regions and panels |
| Surface muted | `--surface-muted` | `#f0f2f4` | Toolbars and selected rows |
| Surface inverse | `--surface-inverse` | `#202124` | Primary command buttons |
| Text primary | `--text-primary` | `#202124` | Main copy |
| Text secondary | `--text-secondary` | `#5f6368` | Supporting copy |
| Text tertiary | `--text-tertiary` | `#686d73` | Metadata; at least 4.65:1 on used surfaces |
| Hairline | `--line-default` | `rgba(32, 33, 36, 0.11)` | Shadow-as-border rings |
| Focus | `--focus` | `#0a72ef` | Selection and keyboard focus only |
| Healthy | `--healthy` | `#176b4b` | Connected and matched states only |
| Drift | `--drift` | `#b93832` | Missing and revision drift only |
| Warning | `--warning` | `#805000` | Partial or unknown states only |

Rules: color is functional, never decorative. Every status combines an icon or label with color. No gradients, purple, status-dot confetti, or theme changes between regions.

## 3. Typography

- UI: Geist-compatible system stack, `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Technical values: `"SFMono-Regular", Consolas, "Liberation Mono", monospace` with tabular numbers.
- Scale: 12px metadata, 13px compact rows, 14px default UI, 16px panel headings, 20px page headings.
- CSS tokens: `--font-size-micro`, `--font-size-meta`, `--font-size-row`, `--font-size-ui`, `--font-size-panel`, and `--font-size-page` keep the scale shared across primitives.
- Weights: 400 for reading, 500 for controls, 600 for headings.
- Letter spacing is always `0`, including headings. This intentionally departs from the Vercel reference to satisfy the workspace typography constraint and improve dense Chinese/English mixing.

## 4. Spacing & Layout

- Base grid: 4px; primary rhythm: 8px, 12px, 16px, 24px, 32px.
- CSS tokens: `--space-1/2/3/4/6/8`, `--control-compact/min/chrome`, and `--radius-control/panel` define shared spacing and component geometry.
- Desktop shell: `100dvh`; shell body owns scrolling, header/sidebar/inspector remain fixed.
- Variant A: fixed sidenav + scrollable inventory + fixed inspector.
- Variant B: fixed target command bar + scrollable comparison matrix + fixed summary rail.
- Variant C: fleet tree + scrollable machine lanes + fixed collection rail.
- At widths below 820px, all variants reflow to one column. Tables become labeled row blocks and no primary task requires horizontal scrolling.
- Build-time custom media tokens `--viewport-compact`, `--viewport-mobile`, and `--viewport-phone` keep the 1120px, 820px, and 480px breakpoints centralized while producing standard media queries in the shipped CSS.
- Long paths and unbroken hashes use `overflow-wrap: anywhere`; all grid/flex scroll children set `min-block-size: 0` and `min-inline-size: 0`.

## 5. Primitives

- `AppHeader`: 44px fixed chrome with app identity, workspace target, and read-only prototype badge.
- `ScopeTree`: machine and harness hierarchy; default, hover, selected, connected, offline states.
- `SegmentedControl`: view or scope selection; default, hover, selected, focus, disabled states.
- `SkillRow`: name, scope, agents, source/revision, and status; default, hover, selected, loading, error states.
- `Inspector`: selected skill facts and generated command plan; empty, populated, and command-preview states.
- `TargetPicker`: local or SSH snapshot selector; default, focus, disconnected states.
- `DiffRow`: matched, only-left, only-right, and revision-drift states with textual labels.
- `CollectionItem`: curated repository summary; default, selected, installed, update-available states.
- `CommandPreview`: monospace, copyable, never auto-executed in this prototype.
- `PrototypeSwitcher`: development-only variant control with previous/next buttons and keyboard support; floating on desktop and placed after content on mobile.

All controls use Lucide icons, a 6px control radius, an 8px panel radius, and a 40px minimum touch target. Panels use Vercel-inspired shadow borders instead of nested decorative cards.

## 6. Motion

`MOTION_INTENSITY=2`. Motion is limited to `opacity` and `transform` feedback for drawers and to immediate hover/press state changes. Variant and view changes are instant. `prefers-reduced-motion` removes the remaining transitions.

## 7. Depth

- Level 0: flat canvas.
- Level 1: `0 0 0 1px var(--line-default)` for region separation.
- Level 2: Level 1 plus `0 2px 8px rgba(32, 33, 36, 0.06)` for the inspector and prototype switcher.
- No floating page-section cards, glow, glass, or heavy shadows.

## 8. Accessibility Constraints & Accepted Debt

Constraints: WCAG AA contrast; visible `:focus-visible` ring; 40px targets; semantic buttons, tables, headings, and status text; arrow-key variant switching never captures keys inside form fields; no color-only information; narrow-width reflow; reduced motion honored.

Accepted prototype debt:

- SSH discovery, mutations, authentication, persistence, auto-update, and packaging are represented by sample snapshots and command previews only.
- Browser mode uses sample local data; Electron mode invokes the real read-only `npx skills list --json` command.
- Curated collection metadata is a prototype snapshot, not a live registry contract.
- Screen-reader QA is limited to semantic inspection and keyboard exercise; real assistive-technology testing belongs to production implementation.
