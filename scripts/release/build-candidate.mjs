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

export function runCandidateCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = (options.spawn ?? spawn)(command, args, {
      cwd: options.cwd ?? repositoryRoot,
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

export async function runCandidateNpm(
  args,
  environment,
  {
    npmExecutable = process.env.npm_execpath,
    root = repositoryRoot,
    runCommand = runCandidateCommand,
  } = {},
) {
  if (npmExecutable === undefined || npmExecutable === "") {
    throw new Error("Candidate generation must run through npm.");
  }
  await runCommand(process.execPath, [npmExecutable, ...args], {
    cwd: root,
    environment,
  });
}

export async function buildCandidate({
  argv = process.argv.slice(2),
  environment = process.env,
  nativePlatform = process.platform,
  nodeVersion = process.versions.node,
  root = repositoryRoot,
  services = {},
} = {}) {
  const readJsonFile = services.readJson ?? readJson;
  const remove = services.remove ?? rm;
  const runCommand = services.runCommand ?? runCandidateCommand;
  const runNpm =
    services.runNpm ??
    ((args, candidateEnvironment) =>
      runCandidateNpm(args, candidateEnvironment, { root, runCommand }));
  const loadBootstrap =
    services.loadBootstrap ??
    ((path) => import(pathToFileURL(path).href));
  const collectBuildOutputs =
    services.collectBuildOutputs ?? collectBuildOutputEvidence;
  const stageArtifacts = services.stageArtifacts ?? stageCandidateArtifacts;
  const write = services.writeFile ?? writeFile;
  const writeOutput =
    services.writeOutput ?? ((value) => process.stdout.write(value));
  const options = parseCandidateArguments(argv);
  assertUnsignedCandidateEnvironment(environment);
  if (nativePlatform !== options.platform) {
    throw new Error(
      "Release candidates must be generated on their native platform.",
    );
  }

  const [rootPackage, desktopPackage, bootstrapPackage, runtimePackage] =
    await Promise.all([
      readJsonFile(join(root, "package.json")),
      readJsonFile(join(root, "apps/desktop/package.json")),
      readJsonFile(join(root, "packages/remote-bootstrap/package.json")),
      readJsonFile(join(root, "packages/skills-runtime/package.json")),
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
  const checkedOutCommit = await runCommand("git", ["rev-parse", "HEAD"], {
    capture: true,
    cwd: root,
    environment,
  });
  if (checkedOutCommit !== options.sourceCommit) {
    throw new Error(
      "Candidate source commit does not match the checked-out commit.",
    );
  }
  const trackedChanges = await runCommand(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { capture: true, cwd: root, environment },
  );
  if (trackedChanges !== "") {
    throw new Error("Release candidates require a clean tracked source tree.");
  }
  const packageLockBytes = await runCommand(
    "git",
    ["cat-file", "blob", `${options.sourceCommit}:package-lock.json`],
    { capture: "buffer", cwd: root, environment },
  );
  const packageLockDigest = createHash("sha256")
    .update(packageLockBytes)
    .digest("hex");

  const candidateEnvironment = {
    ...environment,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  };
  const desktopDistDirectory = join(root, "apps/desktop/dist");
  await remove(desktopDistDirectory, { force: true, recursive: true });
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
    root,
    "packages/remote-bootstrap/dist/release/index.js",
  );
  const bootstrap = await loadBootstrap(bootstrapBundlePath);
  const bootstrapDescription = bootstrap.describeRemoteBootstrap();
  const calculatedBootstrapDigest = createHash("sha256")
    .update(bootstrap.REMOTE_BOOTSTRAP_PROGRAM)
    .digest("hex");
  if (calculatedBootstrapDigest !== bootstrapDescription.digest) {
    throw new Error("Remote Bootstrap build digest does not bind its program.");
  }

  const buildOutputs = await collectBuildOutputs({
    desktopDistDirectory,
    remoteBootstrapProgram: bootstrap.REMOTE_BOOTSTRAP_PROGRAM,
  });
  const packagedBootstrapReceipt = {
    digest: bootstrapDescription.digest,
    protocolVersion: bootstrapDescription.protocolVersion,
    schemaVersion: 1,
  };
  await write(
    join(desktopDistDirectory, "main", "remote-bootstrap.json"),
    `${JSON.stringify(packagedBootstrapReceipt, null, 2)}\n`,
    { flag: "wx" },
  );

  const forgeOutDirectory = join(root, "apps/desktop/out");
  await remove(forgeOutDirectory, { force: true, recursive: true });
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

  const outputRoot = resolve(root, options.outputDirectory);
  const candidateDirectory = join(
    outputRoot,
    `skills-desktop-${rootPackage.version}-${options.platform}-${options.architecture}`,
  );
  const artifacts = await stageArtifacts({
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
      nodeVersion,
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
  await write(join(candidateDirectory, manifestName), manifestBytes, {
    flag: "wx",
  });
  const manifestDigest = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  await write(
    join(candidateDirectory, "candidate-manifest-v1.sha256"),
    `${manifestDigest}  ${manifestName}\n`,
    { flag: "wx" },
  );

  const result = { candidateDirectory, manifestDigest };
  writeOutput(`${JSON.stringify(result)}\n`);
  return result;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildCandidate();
}
