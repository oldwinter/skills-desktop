import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type {
  GitInvocation,
  GitOutcome,
  GitToolRunner,
  PublicationWorkspace,
} from "./git-publisher.js";

const MAX_OUTPUT_BYTES = 4 * 1_024 * 1_024;
const ROOT_PREFIX = "skills-desktop-publication-";

/**
 * Spawns system Git with an argument array, no shell, a bounded output
 * buffer, and a hard timeout. Rejects only when Git cannot start (ENOENT).
 */
export function createSpawnGitRunner(options?: {
  readonly gitExecutable?: string;
}): GitToolRunner {
  const executable = options?.gitExecutable ?? "git";
  return {
    run(invocation: GitInvocation): Promise<GitOutcome> {
      return new Promise((resolvePromise, reject) => {
        const child = spawn(executable, [...invocation.args], {
          cwd: invocation.cwd,
          env: { ...invocation.env },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outputBytes = 0;
        let settled = false;
        const settle = (outcome: GitOutcome | Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (outcome instanceof Error) reject(outcome);
          else resolvePromise(outcome);
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          settle({
            exitCode: 124,
            stderr: "Git did not finish within the publication time limit.",
            stdout: "",
          });
        }, invocation.timeoutMs);
        const collect = (sink: Buffer[]) => (chunk: Buffer) => {
          outputBytes += chunk.byteLength;
          if (outputBytes > MAX_OUTPUT_BYTES) {
            child.kill("SIGKILL");
            settle({
              exitCode: 125,
              stderr: "Git produced more output than publication accepts.",
              stdout: "",
            });
            return;
          }
          sink.push(chunk);
        };
        child.stdout.on("data", collect(stdout));
        child.stderr.on("data", collect(stderr));
        child.once("error", (error: NodeJS.ErrnoException) => {
          settle(
            error.code === "ENOENT"
              ? new Error("System Git was not found on PATH.")
              : error,
          );
        });
        child.once("close", (code) => {
          settle({
            exitCode: code ?? 1,
            stderr: Buffer.concat(stderr).toString("utf8"),
            stdout: Buffer.concat(stdout).toString("utf8"),
          });
        });
        if (invocation.stdin !== undefined) {
          child.stdin.end(Buffer.from(invocation.stdin));
        } else {
          child.stdin.end();
        }
      });
    },
  };
}

/**
 * Application-owned 0700 temporary roots. `remove` refuses any path that is
 * not a root this process created, so cleanup can never reach a user tree.
 */
export function createNodePublicationWorkspace(options?: {
  readonly baseDirectory?: string;
}): PublicationWorkspace {
  const owned = new Set<string>();
  const base = options?.baseDirectory ?? tmpdir();
  return {
    async create() {
      const root = await mkdtemp(join(base, ROOT_PREFIX));
      await chmod(root, 0o700);
      const canonical = await realpath(root);
      owned.add(canonical);
      return canonical;
    },
    join(...segments) {
      return join(...segments);
    },
    async makeDirectory(path) {
      assertOwned(owned, path);
      await mkdir(path, { mode: 0o700, recursive: false });
    },
    async remove(root) {
      const canonical = resolve(root);
      if (!owned.has(canonical)) return;
      owned.delete(canonical);
      await rm(canonical, { force: true, recursive: true });
    },
    async writeEmptyFile(path) {
      assertOwned(owned, path);
      await writeFile(path, new Uint8Array(), { flag: "wx", mode: 0o600 });
    },
  };
}

function assertOwned(owned: ReadonlySet<string>, path: string) {
  const canonical = resolve(path);
  for (const root of owned) {
    if (canonical.startsWith(`${root}/`) || canonical.startsWith(`${root}\\`)) {
      return;
    }
  }
  throw new Error("Publication may only write inside its own temporary root.");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
