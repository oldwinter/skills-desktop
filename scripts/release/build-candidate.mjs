import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertUnsignedCandidateEnvironment,
  collectBuildOutputEvidence,
  createCandidateManifest,
  parseCandidateArguments,
  serializeCandidateManifest,
  stageCandidateArtifacts,
} from "./candidate-contract.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.environment ?? process.env,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    const stdout = [];
    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        stdout.push(chunk);
      });
    }
    child.once("error", rejectRun);
    child.once("close", (exitCode, signal) => {
      if (exitCode === 0) {
        const bytes = Buffer.concat(stdout);
        resolveRun(
          options.capture === "buffer"
            ? bytes
            : bytes.toString("utf8").trim(),
        );
        return;
      }
      rejectRun(
        new Error(
          `${command} failed with ${signal === null ? `exit ${exitCode}` : `signal ${signal}`}.`,
        ),
      );
    });
  });
}

async function runNpm(args, environment) {
  const npmExecutable = process.env.npm_execpath;
  if (npmExecutable === undefined || npmExecutable === "") {
    throw new Error("Candidate generation must run through npm.");
  }
  await run(process.execPath, [npmExecutable, ...args], { environment });
}

async function main() {
  const options = parseCandidateArguments(process.argv.slice(2));
  assertUnsignedCandidateEnvironment(process.env);
  if (process.platform !== options.platform) {
    throw new Error(
      "Release candidates must be generated on their native platform.",
    );
  }

  const [rootPackage, desktopPackage, bootstrapPackage, runtimePackage] =
    await Promise.all([
      readJson(join(repositoryRoot, "package.json")),
      readJson(join(repositoryRoot, "apps/desktop/package.json")),
      readJson(join(repositoryRoot, "packages/remote-bootstrap/package.json")),
      readJson(join(repositoryRoot, "packages/skills-runtime/package.json")),
    ]);
  const versions = new Set([
    rootPackage.version,
    desktopPackage.version,
    bootstrapPackage.version,
    runtimePackage.version,
  ]);
  if (versions.size !== 1 || typeof rootPackage.version !== "string") {
    throw new Error("Release workspaces must share one immutable version.");
  }
  const checkedOutCommit = await run("git", ["rev-parse", "HEAD"], {
    capture: true,
  });
  if (checkedOutCommit !== options.sourceCommit) {
    throw new Error(
      "Candidate source commit does not match the checked-out commit.",
    );
  }
  const trackedChanges = await run(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { capture: true },
  );
  if (trackedChanges !== "") {
    throw new Error("Release candidates require a clean tracked source tree.");
  }
  const packageLockBytes = await run(
    "git",
    ["cat-file", "blob", `${options.sourceCommit}:package-lock.json`],
    { capture: "buffer" },
  );
  const packageLockDigest = createHash("sha256")
    .update(packageLockBytes)
    .digest("hex");

  const candidateEnvironment = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  };
  const desktopDistDirectory = join(repositoryRoot, "apps/desktop/dist");
  await rm(desktopDistDirectory, { force: true, recursive: true });
  await runNpm(
    ["run", "build", "--workspace", "@skills-desktop/skills-runtime"],
    candidateEnvironment,
  );
  await runNpm(
    ["run", "build", "--workspace", "@skills-desktop/remote-bootstrap"],
    candidateEnvironment,
  );
  await runNpm(
    ["run", "build", "--workspace", "@skills-desktop/desktop"],
    candidateEnvironment,
  );

  const bootstrapBundlePath = join(
    repositoryRoot,
    "packages/remote-bootstrap/dist/release/index.js",
  );
  const bootstrap = await import(pathToFileURL(bootstrapBundlePath).href);
  const bootstrapDescription = bootstrap.describeRemoteBootstrap();
  const calculatedBootstrapDigest = createHash("sha256")
    .update(bootstrap.REMOTE_BOOTSTRAP_PROGRAM)
    .digest("hex");
  if (calculatedBootstrapDigest !== bootstrapDescription.digest) {
    throw new Error("Remote Bootstrap build digest does not bind its program.");
  }

  const buildOutputs = await collectBuildOutputEvidence({
    desktopDistDirectory,
    remoteBootstrapProgram: bootstrap.REMOTE_BOOTSTRAP_PROGRAM,
  });
  const packagedBootstrapReceipt = {
    digest: bootstrapDescription.digest,
    protocolVersion: bootstrapDescription.protocolVersion,
    schemaVersion: 1,
  };
  await writeFile(
    join(desktopDistDirectory, "main", "remote-bootstrap.json"),
    `${JSON.stringify(packagedBootstrapReceipt, null, 2)}\n`,
    { flag: "wx" },
  );

  const forgeOutDirectory = join(repositoryRoot, "apps/desktop/out");
  await rm(forgeOutDirectory, { force: true, recursive: true });
  await runNpm(
    [
      "exec",
      "--workspace",
      "@skills-desktop/desktop",
      "electron-forge",
      "make",
      "--",
      `--platform=${options.platform}`,
      `--arch=${options.architecture}`,
    ],
    candidateEnvironment,
  );

  const outputRoot = resolve(repositoryRoot, options.outputDirectory);
  const candidateDirectory = join(
    outputRoot,
    `skills-desktop-${rootPackage.version}-${options.platform}-${options.architecture}`,
  );
  const artifacts = await stageCandidateArtifacts({
    architecture: options.architecture,
    candidateDirectory,
    makeDirectory: join(forgeOutDirectory, "make"),
    platform: options.platform,
    version: rootPackage.version,
  });
  const manifest = createCandidateManifest({
    architecture: options.architecture,
    artifacts,
    buildInputs: {
      electronVersion: desktopPackage.devDependencies.electron,
      forgeVersion: desktopPackage.devDependencies["@electron-forge/cli"],
      lockfileSha256: packageLockDigest,
      nodeVersion: process.versions.node,
      remoteBootstrapDigest: bootstrapDescription.digest,
      remoteBootstrapProtocolVersion: bootstrapDescription.protocolVersion,
    },
    buildOutputs,
    platform: options.platform,
    source: {
      commit: options.sourceCommit,
      repository: options.repository,
    },
    version: rootPackage.version,
    workflow: {
      event: options.workflowEvent,
      name: "Unsigned Release Candidates",
      runAttempt: options.workflowRunAttempt,
      runId: options.workflowRunId,
    },
  });
  const manifestName = "candidate-manifest-v1.json";
  const manifestBytes = serializeCandidateManifest(manifest);
  await writeFile(join(candidateDirectory, manifestName), manifestBytes, {
    flag: "wx",
  });
  const manifestDigest = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  await writeFile(
    join(candidateDirectory, "candidate-manifest-v1.sha256"),
    `${manifestDigest}  ${manifestName}\n`,
    { flag: "wx" },
  );

  process.stdout.write(
    `${JSON.stringify({ candidateDirectory, manifestDigest })}\n`,
  );
}

await main();
