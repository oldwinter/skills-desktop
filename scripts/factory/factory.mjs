import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findItem,
  gatePlanFor,
  nextQueuedItem,
  readBacklog,
  transitionItem,
  writeBacklog,
} from "./backlog.mjs";
import { runGatePlan } from "./gates.mjs";
import {
  appendProgress,
  attemptDirectory,
  loadOrCreateLedger,
  readLedger,
  recordTransition,
  runtimePaths,
  writeLedger,
} from "./run-store.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const DEFAULT_BACKLOG_PATH = join(repositoryRoot, "docs/factory/backlog.json");
const DEFAULT_RUNTIME_ROOT = join(repositoryRoot, ".codex/runtime/devin-factory");

const USAGE = `Usage: node scripts/factory/factory.mjs <command> [options]

Commands:
  list                     Show every backlog item and its factory state.
  next                     Print the next queued item (lowest order).
  show <id>                Print an item's acceptance criteria and gate plan.
  claim <id>               queued -> claimed. Assigns the item to this run.
  implement <id>           claimed -> implementing. Marks work-in-progress.
  review <id>              claimed|implementing -> reviewing. Captures the
                           working-tree diff and HEAD as review evidence.
  verify <id> [--gates a,b]  reviewing|verifying|failed|verified -> verifying
                           -> verified|failed. Runs the gate plan fail-fast
                           and records per-gate logs under the run directory.
                           Exits non-zero on any gate failure; success is never
                           recorded for a failed attempt.
  deliver <id>             verified -> delivered. Writes a reviewable
                           delivery report under deliveries/. Refuses when the
                           verified HEAD is stale.
  abandon <id> --reason t  Move an open item to abandoned.
  requeue <id>             failed|abandoned -> queued.
  status                   Rewrite status.md and print a summary.
  run [<id>] [--dry-run]   Local path: claim -> implement -> review -> verify
                           -> deliver. --dry-run prints the plan and exits
                           without writing state or running gates.

Options:
  --backlog <path>   Backlog file (default docs/factory/backlog.json;
                     env SKILLS_DESKTOP_FACTORY_BACKLOG).
  --root <path>      Runtime evidence root (default
                     .codex/runtime/devin-factory;
                     env SKILLS_DESKTOP_FACTORY_ROOT).
  --note <text>      Free-form note recorded with a transition.
`;

function parseArgs(argv) {
  const options = { command: argv[0], gates: undefined, positional: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--backlog") options.backlog = argv[++index];
    else if (arg === "--root") options.root = argv[++index];
    else if (arg === "--note") options.note = argv[++index];
    else if (arg === "--reason") options.reason = argv[++index];
    else if (arg === "--gates") options.gates = argv[++index]?.split(",").filter(Boolean);
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}

function git(root, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      ["-C", root, ...args],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) rejectPromise(new Error(`git ${args[0]} failed: ${stderr.trim() || error.message}`));
        else resolvePromise(stdout);
      },
    );
  });
}

async function headSha(cwd) {
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

async function context(env, options) {
  const backlogPath = resolve(
    options.backlog ?? env.SKILLS_DESKTOP_FACTORY_BACKLOG ?? DEFAULT_BACKLOG_PATH,
  );
  const root = resolve(options.root ?? env.SKILLS_DESKTOP_FACTORY_ROOT ?? DEFAULT_RUNTIME_ROOT);
  const backlog = await readBacklog(backlogPath);
  const cwd = resolve(env.SKILLS_DESKTOP_FACTORY_CWD ?? repositoryRoot);
  return { backlog, backlogPath, cwd, paths: runtimePaths(root), root };
}

async function persistTransition(ctx, item, event, detail) {
  const to = transitionItem(item, event);
  const from = item.state;
  item.state = to;
  await writeBacklog(ctx.backlogPath, ctx.backlog);
  const at = new Date().toISOString();
  await recordTransition(ctx.root, item.id, event, from, to, at, detail);
  const head = await headSha(ctx.cwd).catch(() => "unknown");
  await appendProgress(ctx.root, {
    detail,
    event,
    from,
    head,
    item: item.id,
    state: to,
  });
  return { from, to };
}

async function loadItem(ctx, id) {
  return findItem(ctx.backlog, id);
}

function pad(value, length) {
  return String(value).padEnd(length, " ");
}

async function cmdList(ctx, out) {
  const rows = ctx.backlog.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => `${pad(item.id, 9)} ${pad(item.state, 13)} ${pad(item.order, 5)} ${item.title}`);
  out(rows.join("\n") || "backlog is empty");
  return 0;
}

async function cmdNext(ctx, out) {
  const item = nextQueuedItem(ctx.backlog);
  if (item === undefined) {
    out("no queued items");
    return 1;
  }
  out(`${item.id} ${item.title}`);
  return 0;
}

async function cmdShow(ctx, out, options) {
  const item = await loadItem(ctx, options.positional[0]);
  const gates = gatePlanFor(item, ctx.backlog)
    .map((gate) => `${gate.name} (${gate.argv.join(" ")})`)
    .join(", ");
  out(
    [
      `${item.id} ${item.title}`,
      `state: ${item.state}  kind: ${item.kind}  order: ${item.order}`,
      `gates: ${gates}`,
      "acceptance:",
      ...item.acceptance.map((line) => `  - ${line}`),
    ].join("\n"),
  );
  return 0;
}

async function simpleTransition(ctx, out, options, event) {
  const item = await loadItem(ctx, options.positional[0]);
  const { from, to } = await persistTransition(ctx, item, event, options.note ?? options.reason);
  out(`${item.id}: ${from} -> ${to}`);
  return 0;
}

async function cmdReview(ctx, out, options) {
  const item = await loadItem(ctx, options.positional[0]);
  const ledger = await loadOrCreateLedger(ctx.root, item.id, new Date().toISOString());
  const reviewIndex = ledger.reviews.length + 1;
  const { from, to } = await persistTransition(
    ctx,
    item,
    "review",
    options.note ?? `review ${reviewIndex}`,
  );
  const directory = join(ctx.paths.runs, item.id);
  await mkdir(directory, { recursive: true });
  const [statusText, statText, diffText, untrackedText, head] = await Promise.all([
    git(ctx.cwd, ["status", "--porcelain=v1"]),
    git(ctx.cwd, ["diff", "HEAD", "--stat"]),
    git(ctx.cwd, ["diff", "HEAD"]),
    git(ctx.cwd, ["ls-files", "--others", "--exclude-standard"]),
    headSha(ctx.cwd),
  ]);
  const review = { at: new Date().toISOString(), head, n: reviewIndex };
  await Promise.all([
    writeFile(join(directory, `review-${reviewIndex}.status`), statusText, "utf8"),
    writeFile(join(directory, `review-${reviewIndex}.diffstat`), statText, "utf8"),
    writeFile(join(directory, `review-${reviewIndex}.diff`), diffText, "utf8"),
    writeFile(join(directory, `review-${reviewIndex}.untracked`), untrackedText, "utf8"),
  ]);
  ledger.reviews.push(review);
  ledger.updatedAt = review.at;
  await writeLedger(ctx.root, item.id, ledger);
  await appendProgress(ctx.root, {
    event: "review-evidence",
    head,
    item: item.id,
    review: reviewIndex,
    state: to,
  });
  out(
    `${item.id}: ${from} -> ${to} (review ${reviewIndex} at ${head.slice(0, 12)}; ` +
      `${statText.trim() === "" ? "no working-tree diff" : statText.trim().split("\n").at(-1)})`,
  );
  return 0;
}

async function cmdVerify(ctx, out, options) {
  const item = await loadItem(ctx, options.positional[0]);
  transitionItem(item, "verify");
  const ledger = await loadOrCreateLedger(ctx.root, item.id, new Date().toISOString());
  const attempt = ledger.attempts.length + 1;
  const from = item.state;
  item.state = "verifying";
  await writeBacklog(ctx.backlogPath, ctx.backlog);
  await recordTransition(ctx.root, item.id, "verify", from, "verifying", new Date().toISOString(), `attempt ${attempt}`);

  const plan = gatePlanFor(item, ctx.backlog);
  const selected = options.gates === undefined ? plan : plan.filter((gate) => options.gates.includes(gate.name));
  if (selected.length === 0) {
    item.state = from;
    await writeBacklog(ctx.backlogPath, ctx.backlog);
    throw new Error(`no gates selected for ${item.id}.`);
  }
  const head = await headSha(ctx.cwd).catch(() => "unknown");
  const attemptDir = await attemptDirectory(ctx.root, item.id, attempt);
  await appendProgress(ctx.root, {
    attempt,
    event: "verify-start",
    gates: selected.map((gate) => gate.name),
    head,
    item: item.id,
    state: "verifying",
  });
  out(`${item.id}: verifying attempt ${attempt} (${selected.map((gate) => gate.name).join(", ")})`);
  const startedAt = Date.now();
  const outcome = await runGatePlan(selected, { attemptDir, cwd: ctx.cwd });
  const to = outcome.ok ? "verified" : "failed";
  item.state = to;
  await writeBacklog(ctx.backlogPath, ctx.backlog);
  const finishedAt = new Date().toISOString();
  ledger.attempts.push({
    at: finishedAt,
    durationMs: Date.now() - startedAt,
    head,
    n: attempt,
    ok: outcome.ok,
    results: outcome.results,
  });
  ledger.updatedAt = finishedAt;
  await writeLedger(ctx.root, item.id, ledger);
  await recordTransition(ctx.root, item.id, "verify", "verifying", to, finishedAt, `attempt ${attempt}`);
  await appendProgress(ctx.root, {
    attempt,
    durationMs: Date.now() - startedAt,
    event: "verify-end",
    gates: outcome.results.map(({ durationMs, name, ok }) => ({ durationMs, name, ok })),
    head,
    item: item.id,
    state: to,
  });
  for (const result of outcome.results) {
    out(
      `  ${result.ok ? "pass" : "FAIL"} ${result.name} ` +
        `${result.durationMs}ms exit=${result.exitCode ?? "spawn"}${result.timedOut ? " timed-out" : ""} log=${result.logPath}`,
    );
  }
  out(`${item.id}: verifying -> ${to}`);
  return outcome.ok ? 0 : 1;
}

async function cmdDeliver(ctx, out, options) {
  const item = await loadItem(ctx, options.positional[0]);
  const ledger = await readLedger(ctx.root, item.id);
  const head = await headSha(ctx.cwd);
  const existing = ledger?.deliveries.at(-1);
  if (item.state === "delivered") {
    if (existing !== undefined) {
      out(`${item.id}: already delivered (delivery ${existing.n} at ${existing.report})`);
      return 0;
    }
    throw new Error(`cannot deliver ${item.id}: marked delivered without a delivery record.`);
  }
  if (item.state !== "verified") {
    throw new Error(`cannot deliver ${item.id} while it is "${item.state}" (requires verified).`);
  }
  const lastAttempt = ledger?.attempts.at(-1);
  if (lastAttempt?.ok !== true) {
    throw new Error(`cannot deliver ${item.id}: no passing verify attempt on record.`);
  }
  if (lastAttempt.head !== "unknown" && lastAttempt.head !== head) {
    throw new Error(
      `cannot deliver ${item.id}: verified at ${lastAttempt.head.slice(0, 12)} but HEAD is now ${head.slice(0, 12)}. Re-run verify.`,
    );
  }
  const deliveryIndex = (existing?.n ?? 0) + 1;
  const directory = join(ctx.paths.deliveries, `${item.id}-delivery-${deliveryIndex}`);
  await mkdir(directory, { recursive: true });
  const [statText, recentLog, nameStatus] = await Promise.all([
    git(ctx.cwd, ["diff", "HEAD", "--stat"]),
    git(ctx.cwd, ["log", "-5", "--oneline"]),
    git(ctx.cwd, ["status", "--porcelain=v1"]),
  ]);
  const gateLines = lastAttempt.results
    .map((result) => `  - ${result.ok ? "pass" : "FAIL"} ${result.name} (${result.durationMs}ms, exit ${result.exitCode}) — ${result.logPath}`)
    .join("\n");
  const report = `# Factory delivery ${item.id} (delivery ${deliveryIndex})

- item: ${item.id} ${item.title}
- kind: ${item.kind}  order: ${item.order}
- delivered at: ${new Date().toISOString()}
- head: ${head}
- verify attempt: ${lastAttempt.n} (${lastAttempt.at}, ${lastAttempt.durationMs}ms)

## Acceptance criteria

${item.acceptance.map((line) => `- ${line}`).join("\n")}

## Gate results

${gateLines}

## Change summary

Uncommitted diff vs HEAD:
\`\`\`
${statText.trim() || "(none)"}
\`\`\`

Recent commits:
\`\`\`
${recentLog.trim()}
\`\`\`

Working tree:
\`\`\`
${nameStatus.trim() || "clean at delivery HEAD"}
\`\`\`

## Review

Self-reviewed by the factory operator; evidence under
\`${join(ctx.paths.runs, item.id)}\`. Manual approval is still required for
merge, deployment, or any remote action.
`;
  const reportPath = join(directory, "report.md");
  await writeFile(reportPath, report, "utf8");
  const from = item.state;
  item.state = "delivered";
  await writeBacklog(ctx.backlogPath, ctx.backlog);
  const at = new Date().toISOString();
  ledger.deliveries.push({ at, head, n: deliveryIndex, report: reportPath });
  ledger.updatedAt = at;
  await writeLedger(ctx.root, item.id, ledger);
  await recordTransition(ctx.root, item.id, "deliver", from, "delivered", at, `delivery ${deliveryIndex}`);
  await appendProgress(ctx.root, {
    delivery: deliveryIndex,
    event: "deliver",
    head,
    item: item.id,
    report: reportPath,
    state: "delivered",
  });
  out(`${item.id}: verified -> delivered (${reportPath})`);
  return 0;
}

async function renderStatus(ctx) {
  const head = await headSha(ctx.cwd).catch(() => "unknown");
  const next = nextQueuedItem(ctx.backlog);
  const lines = [
    "# Devin factory status",
    "",
    `- generated: ${new Date().toISOString()}`,
    `- head: ${head}`,
    `- next queued: ${next === undefined ? "none" : `${next.id} ${next.title}`}`,
    "",
    "| item | state | order | title |",
    "| --- | --- | --- | --- |",
    ...ctx.backlog.items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => `| ${item.id} | ${item.state} | ${item.order} | ${item.title} |`),
    "",
  ];
  for (const item of ctx.backlog.items) {
    const ledger = await readLedger(ctx.root, item.id).catch(() => undefined);
    const lastAttempt = ledger?.attempts.at(-1);
    if (lastAttempt !== undefined) {
      lines.push(
        `- ${item.id}: last verify attempt ${lastAttempt.n} ${lastAttempt.ok ? "passed" : "FAILED"} at ${lastAttempt.at} (head ${String(lastAttempt.head).slice(0, 12)})`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function cmdStatus(ctx, out) {
  const text = await renderStatus(ctx);
  await mkdir(ctx.paths.root, { recursive: true });
  await writeFile(ctx.paths.status, text, "utf8");
  out(text);
  return 0;
}

async function cmdRun(ctx, out, options) {
  const item =
    options.positional[0] === undefined
      ? nextQueuedItem(ctx.backlog)
      : await loadItem(ctx, options.positional[0]);
  if (item === undefined) {
    out("no queued items");
    return 1;
  }
  const plan = gatePlanFor(item, ctx.backlog);
  const steps = [
    `claim ${item.id} (queued -> claimed)`,
    `implement ${item.id} (claimed -> implementing)`,
    `review ${item.id} (implementing -> reviewing; captures diff evidence)`,
    `verify ${item.id} (reviewing -> verified|failed; gates: ${plan.map((gate) => gate.name).join(", ")})`,
    `deliver ${item.id} (verified -> delivered; writes deliveries/ report)`,
  ];
  if (options.dryRun) {
    out(
      [
        `dry run for ${item.id} ${item.title}`,
        `state: ${item.state}  kind: ${item.kind}`,
        "acceptance:",
        ...item.acceptance.map((line) => `  - ${line}`),
        "planned steps:",
        ...steps.map((line) => `  - ${line}`),
        "no state was written and no gates were executed.",
      ].join("\n"),
    );
    return 0;
  }
  if (!["queued", "claimed", "implementing", "reviewing", "failed"].includes(item.state)) {
    throw new Error(`cannot run ${item.id} while it is "${item.state}".`);
  }
  const fresh = () => findItem(ctx.backlog, item.id);
  for (const event of ["claim", "implement", "review"]) {
    const allowed =
      event === "claim" ? ["queued"] : event === "implement" ? ["claimed"] : ["implementing"];
    if (!allowed.includes(fresh().state)) continue;
    if (event === "review") {
      await cmdReview(ctx, out, { positional: [item.id] });
    } else {
      const { from, to } = await persistTransition(ctx, fresh(), event, `run ${event}`);
      out(`${item.id}: ${from} -> ${to}`);
    }
  }
  const verifyCode = await cmdVerify(ctx, out, { positional: [item.id] });
  if (verifyCode !== 0) return verifyCode;
  return cmdDeliver(ctx, out, { positional: [item.id] });
}

export async function runFactory(argv, env = process.env) {
  const options = parseArgs(argv);
  const lines = [];
  const out = (line) => lines.push(line);
  let code;
  try {
    if (options.command === undefined || options.command === "help" || options.command === "--help") {
      out(USAGE);
      return { code: 0, lines };
    }
    const ctx = await context(env, options);
    switch (options.command) {
      case "list": code = await cmdList(ctx, out); break;
      case "next": code = await cmdNext(ctx, out); break;
      case "show": code = await cmdShow(ctx, out, options); break;
      case "claim": code = await simpleTransition(ctx, out, options, "claim"); break;
      case "implement": code = await simpleTransition(ctx, out, options, "implement"); break;
      case "review": code = await cmdReview(ctx, out, options); break;
      case "verify": code = await cmdVerify(ctx, out, options); break;
      case "deliver": code = await cmdDeliver(ctx, out, options); break;
      case "abandon": {
        if (options.reason === undefined) throw new Error("abandon requires --reason <text>");
        code = await simpleTransition(ctx, out, options, "abandon");
        break;
      }
      case "requeue": code = await simpleTransition(ctx, out, options, "requeue"); break;
      case "status": code = await cmdStatus(ctx, out); break;
      case "run": code = await cmdRun(ctx, out, options); break;
      default:
        out(`unknown command "${options.command}"\n\n${USAGE}`);
        return { code: 2, lines };
    }
  } catch (error) {
    out(`factory: ${error.message}`);
    return { code: 2, lines };
  }
  return { code, lines };
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const { code, lines } = await runFactory(process.argv.slice(2));
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(code);
}
