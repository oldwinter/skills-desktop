import { readFile, writeFile } from "node:fs/promises";

export const FACTORY_STATES = [
  "queued",
  "claimed",
  "implementing",
  "reviewing",
  "verifying",
  "verified",
  "delivered",
  "failed",
  "abandoned",
];

export const TERMINAL_STATES = ["delivered", "abandoned"];

// Ordered pipeline transitions. `verify` is allowed from `verifying` so an
// interrupted verification can be resumed, and from `failed`/`verified` so a
// retry or a re-check is explicit rather than implicit.
const TRANSITIONS = {
  claim: { from: ["queued"], to: "claimed" },
  implement: { from: ["claimed"], to: "implementing" },
  review: { from: ["claimed", "implementing"], to: "reviewing" },
  verify: {
    from: ["reviewing", "verifying", "failed", "verified"],
    to: "verified",
  },
  deliver: { from: ["verified"], to: "delivered" },
  abandon: {
    from: ["claimed", "implementing", "reviewing", "verifying", "failed"],
    to: "abandoned",
  },
  requeue: { from: ["failed", "abandoned"], to: "queued" },
};

export const TRANSITION_EVENTS = Object.keys(TRANSITIONS);

const ITEM_ID_PATTERN = /^SDF-\d{3,}$/;
const ITEM_KINDS = ["code-change", "verification"];

function problemsForGateCommands(gateCommands) {
  const problems = [];
  if (gateCommands === null || typeof gateCommands !== "object") {
    return ["backlog.gateCommands must be an object keyed by gate name."];
  }
  for (const [name, gate] of Object.entries(gateCommands)) {
    if (!/^[a-z][a-z0-9:_-]*$/.test(name)) {
      problems.push(`gate name "${name}" must be lowercase and start with a letter.`);
    }
    if (gate === null || typeof gate !== "object" || !Array.isArray(gate.argv)) {
      problems.push(`gate "${name}" must define an argv array.`);
      continue;
    }
    if (gate.argv.length === 0 || gate.argv.some((part) => typeof part !== "string" || part === "")) {
      problems.push(`gate "${name}" argv entries must be non-empty strings.`);
    }
    if (gate.timeoutMs !== undefined && (!Number.isInteger(gate.timeoutMs) || gate.timeoutMs <= 0)) {
      problems.push(`gate "${name}" timeoutMs must be a positive integer.`);
    }
  }
  return problems;
}

function problemsForItem(item, index, gateCommands, seenIds) {
  const problems = [];
  const where = `items[${index}]${typeof item?.id === "string" ? ` (${item.id})` : ""}`;
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return [`${where} must be an object.`];
  }
  if (typeof item.id !== "string" || !ITEM_ID_PATTERN.test(item.id)) {
    problems.push(`${where} id must match ${ITEM_ID_PATTERN}.`);
  } else if (seenIds.has(item.id)) {
    problems.push(`${where} duplicates id "${item.id}".`);
  } else {
    seenIds.add(item.id);
  }
  if (typeof item.title !== "string" || item.title.trim() === "") {
    problems.push(`${where} title is required.`);
  }
  if (!ITEM_KINDS.includes(item.kind)) {
    problems.push(`${where} kind must be one of ${ITEM_KINDS.join(", ")}.`);
  }
  if (!FACTORY_STATES.includes(item.state)) {
    problems.push(`${where} state must be one of ${FACTORY_STATES.join(", ")}.`);
  }
  if (!Number.isInteger(item.order) || item.order <= 0) {
    problems.push(`${where} order must be a positive integer.`);
  }
  if (!Array.isArray(item.acceptance) || item.acceptance.length === 0) {
    problems.push(`${where} acceptance must be a non-empty array of strings.`);
  } else if (item.acceptance.some((line) => typeof line !== "string" || line.trim() === "")) {
    problems.push(`${where} acceptance entries must be non-empty strings.`);
  }
  const gates = item.gates ?? undefined;
  if (gates !== undefined) {
    if (!Array.isArray(gates) || gates.length === 0) {
      problems.push(`${where} gates must be a non-empty array when present.`);
    } else {
      for (const name of gates) {
        if (!(name in gateCommands)) {
          problems.push(`${where} references unknown gate "${name}".`);
        }
      }
    }
  }
  if (item.source !== undefined) {
    const source = item.source;
    if (source === null || typeof source !== "object") {
      problems.push(`${where} source must be an object.`);
    } else if (source.type === "github-issue") {
      if (!Number.isInteger(source.number) || source.number <= 0) {
        problems.push(`${where} github-issue source needs a positive integer number.`);
      }
    } else if (source.type !== "local") {
      problems.push(`${where} source.type must be "local" or "github-issue".`);
    }
  }
  return problems;
}

export function validateBacklog(data) {
  const problems = [];
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return ["backlog must be a JSON object."];
  }
  if (data.schemaVersion !== 1) {
    problems.push("backlog.schemaVersion must be 1.");
  }
  const gateCommands = data.gateCommands ?? {};
  problems.push(...problemsForGateCommands(gateCommands));
  const defaults = data.defaults ?? {};
  if (defaults.gates !== undefined) {
    if (!Array.isArray(defaults.gates) || defaults.gates.length === 0) {
      problems.push("backlog.defaults.gates must be a non-empty array when present.");
    } else {
      for (const name of defaults.gates) {
        if (!(name in gateCommands)) {
          problems.push(`backlog.defaults.gates references unknown gate "${name}".`);
        }
      }
    }
  }
  if (!Array.isArray(data.items)) {
    problems.push("backlog.items must be an array.");
  } else {
    const seenIds = new Set();
    data.items.forEach((item, index) => {
      problems.push(...problemsForItem(item, index, gateCommands, seenIds));
    });
  }
  return problems;
}

export function parseBacklog(source, origin = "backlog") {
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    throw new Error(`${origin} is not valid JSON: ${error.message}`);
  }
  const problems = validateBacklog(data);
  if (problems.length > 0) {
    throw new Error(`${origin} is invalid:\n${problems.join("\n")}`);
  }
  return data;
}

export async function readBacklog(path) {
  return parseBacklog(await readFile(path, "utf8"), path);
}

export async function writeBacklog(path, backlog) {
  const problems = validateBacklog(backlog);
  if (problems.length > 0) {
    throw new Error(`refusing to write invalid backlog:\n${problems.join("\n")}`);
  }
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(backlog, null, 2)}\n`, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temporary, path);
}

export function findItem(backlog, id) {
  const item = backlog.items.find((candidate) => candidate.id === id);
  if (item === undefined) {
    throw new Error(`backlog has no item "${id}".`);
  }
  return item;
}

export function nextQueuedItem(backlog) {
  return backlog.items
    .filter((item) => item.state === "queued")
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0];
}

export function transitionItem(item, event) {
  const transition = TRANSITIONS[event];
  if (transition === undefined) {
    throw new Error(
      `unknown factory event "${event}"; expected one of ${TRANSITION_EVENTS.join(", ")}.`,
    );
  }
  if (!transition.from.includes(item.state)) {
    throw new Error(
      `cannot ${event} ${item.id} while it is "${item.state}" (requires ${transition.from.join(" or ")}).`,
    );
  }
  return transition.to;
}

// Returns the ordered gate plan for an item: names resolved through the
// item's own list or the backlog defaults.
export function gatePlanFor(item, backlog) {
  const names = item.gates ?? backlog.defaults?.gates ?? Object.keys(backlog.gateCommands);
  return names.map((name) => ({ name, ...backlog.gateCommands[name] }));
}
