import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function runtimePaths(root) {
  return {
    root,
    deliveries: join(root, "deliveries"),
    progress: join(root, "progress.jsonl"),
    runs: join(root, "runs"),
    session: join(root, "session.json"),
    status: join(root, "status.md"),
  };
}

function ledgerPath(root, itemId) {
  return join(runtimePaths(root).runs, itemId, "ledger.json");
}

export async function readLedger(root, itemId) {
  try {
    return JSON.parse(await readFile(ledgerPath(root, itemId), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`run ledger for ${itemId} is unreadable: ${error.message}`);
  }
}

export async function writeLedger(root, itemId, ledger) {
  const path = ledgerPath(root, itemId);
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return path;
}

export function newLedger(itemId, at) {
  return {
    attempts: [],
    createdAt: at,
    deliveries: [],
    history: [],
    itemId,
    reviews: [],
    schemaVersion: 1,
    updatedAt: at,
  };
}

export async function loadOrCreateLedger(root, itemId, at) {
  return (await readLedger(root, itemId)) ?? newLedger(itemId, at);
}

export async function recordTransition(root, itemId, event, from, to, at, detail) {
  const ledger = await loadOrCreateLedger(root, itemId, at);
  ledger.history.push({ at, detail, event, from, to });
  ledger.updatedAt = at;
  await writeLedger(root, itemId, ledger);
  return ledger;
}

// progress.jsonl is append-only timestamped evidence; each line is one event.
export async function appendProgress(root, entry) {
  const paths = runtimePaths(root);
  await mkdir(paths.root, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  await appendFile(paths.progress, `${line}\n`, "utf8");
  return line;
}

export async function attemptDirectory(root, itemId, attempt) {
  const directory = join(runtimePaths(root).runs, itemId, `attempt-${attempt}`);
  await mkdir(directory, { recursive: true });
  return directory;
}
