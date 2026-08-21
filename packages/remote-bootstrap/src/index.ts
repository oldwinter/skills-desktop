import {
  CLI_PACKAGE,
  CLI_VERSION,
  WIRE_FRAME_ENCODER_SOURCE,
  WIRE_OBSERVATION_REQUEST_VALIDATOR_SOURCE,
  WIRE_SINGLE_FRAME_DECODER_SOURCE,
  MAX_WIRE_FRAME_BYTES,
  MAX_WIRE_HARNESS_LENGTH,
  MAX_WIRE_INVENTORY_JSON_BYTES,
  MAX_WIRE_REQUEST_BYTES,
  MAX_WIRE_REQUEST_ID_LENGTH,
  MAX_WIRE_WORKSPACE_LENGTH,
  WIRE_PROTOCOL_VERSION,
} from "@skills-desktop/skills-runtime";

export const REMOTE_BOOTSTRAP_PROTOCOL_VERSION = 1 as const;

export const REMOTE_BOOTSTRAP_PROGRAM = String.raw`
"use strict";
const MAX_WIRE_FRAME_BYTES = ${MAX_WIRE_FRAME_BYTES};
const MAX_WIRE_HARNESS_LENGTH = ${MAX_WIRE_HARNESS_LENGTH};
const MAX_WIRE_REQUEST_ID_LENGTH = ${MAX_WIRE_REQUEST_ID_LENGTH};
const MAX_WIRE_WORKSPACE_LENGTH = ${MAX_WIRE_WORKSPACE_LENGTH};
const WIRE_PROTOCOL_VERSION = ${WIRE_PROTOCOL_VERSION};
const encodeWireFramePayload = ${WIRE_FRAME_ENCODER_SOURCE};
const decodeSingleWireFramePayload = ${WIRE_SINGLE_FRAME_DECODER_SOURCE};
const validateWireObservationRequest = ${WIRE_OBSERVATION_REQUEST_VALIDATOR_SOURCE};
const isWireObservationRequest = (value) => validateWireObservationRequest(
  value,
  WIRE_PROTOCOL_VERSION,
  MAX_WIRE_HARNESS_LENGTH,
  MAX_WIRE_REQUEST_ID_LENGTH,
  MAX_WIRE_WORKSPACE_LENGTH,
);

(async () => {
  const childProcess = process.getBuiltinModule("node:child_process");
  const MAX_OUTPUT_BYTES = ${MAX_WIRE_INVENTORY_JSON_BYTES};
  const MAX_REQUEST_BYTES = ${MAX_WIRE_REQUEST_BYTES};
  const CLI_PACKAGE = ${JSON.stringify(CLI_PACKAGE)};
  const CLI_VERSION = ${JSON.stringify(CLI_VERSION)};
  const children = new Set();

  const writeFrame = (value) => {
    process.stdout.write(Buffer.from(encodeWireFramePayload(value, MAX_WIRE_FRAME_BYTES)));
  };
  const failure = (code, message, requestId = null) => {
    writeFrame({ code, message, protocolVersion: WIRE_PROTOCOL_VERSION, requestId, type: "failure" });
  };
  writeFrame({ bootstrapDigest: BUILD_DIGEST, protocolVersion: WIRE_PROTOCOL_VERSION, type: "hello" });

  const terminateChildren = () => {
    for (const child of children) {
      try { child.kill("SIGTERM"); } catch {}
    }
  };
  process.once("SIGHUP", terminateChildren);
  process.once("SIGINT", terminateChildren);
  process.once("SIGTERM", terminateChildren);

  const inputChunks = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += chunk.length;
    if (inputBytes > MAX_REQUEST_BYTES + 4) {
      failure("remote_protocol_violation", "The Wire request exceeds its byte limit.");
      return;
    }
    inputChunks.push(chunk);
  }
  const input = Buffer.concat(inputChunks);
  const requestPayload = decodeSingleWireFramePayload(input, MAX_REQUEST_BYTES);
  if (requestPayload === undefined) {
    failure("remote_protocol_violation", "The Wire request framing is invalid.");
    return;
  }

  let request;
  try {
    request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(requestPayload));
  } catch {
    failure("remote_protocol_violation", "The Wire request is not valid JSON.");
    return;
  }
  if (!isWireObservationRequest(request)) {
    failure("remote_protocol_violation", "The Wire request is not a supported operation.");
    return;
  }

  const environment = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "NPM_CONFIG_CACHE", "PATH", "TEMP", "TMP"]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  const invoke = (args) => new Promise((resolve, reject) => {
    const child = childProcess.spawn("npx", ["--yes", CLI_PACKAGE, ...args], {
      cwd: request.workspace,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputExceeded = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject({ code: "remote_operation_failed" });
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill("SIGTERM");
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      children.delete(child);
      reject({ code: error && error.code === "ENOENT" ? "remote_runtime_unavailable" : "remote_operation_failed" });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      children.delete(child);
      if (outputExceeded) reject({ code: "output_limit_exceeded" });
      else if (exitCode !== 0) reject({ code: "remote_operation_failed" });
      else resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });

  let version;
  let projectJson;
  let globalJson;
  try {
    version = await invoke(["--version"]);
    if (version.trim() !== CLI_VERSION) {
      failure("remote_runtime_unavailable", "The remote Skills CLI dialect is not supported.", request.requestId);
      return;
    }
    projectJson = await invoke(["list", "--json"]);
    globalJson = await invoke(["list", "--global", "--json"]);
  } catch (error) {
    const code = error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "remote_operation_failed";
    failure(code, code === "output_limit_exceeded"
      ? "Remote Inventory output exceeds its byte limit."
      : code === "remote_runtime_unavailable"
        ? "The remote runtime is unavailable."
        : "Remote Inventory observation failed.", request.requestId);
    return;
  }
  try {
    writeFrame({
      cliVersion: CLI_VERSION,
      globalJson,
      projectJson,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: request.requestId,
      type: "inventory",
    });
  } catch {
    failure(
      "output_limit_exceeded",
      "Remote Inventory output exceeds its Wire frame limit.",
      request.requestId,
    );
  }
})().catch(() => {
  try {
    const payload = encodeWireFramePayload({
      code: "remote_operation_failed",
      message: "Remote Inventory observation failed.",
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: null,
      type: "failure",
    }, MAX_WIRE_FRAME_BYTES);
    process.stdout.write(Buffer.from(payload));
  } catch {}
});
`;

const bootstrapCrypto = process.getBuiltinModule(
  "node:crypto",
) as typeof import("node:crypto");
export const REMOTE_BOOTSTRAP_DIGEST = bootstrapCrypto
  .createHash("sha256")
  .update(REMOTE_BOOTSTRAP_PROGRAM)
  .digest("hex");

const bootstrapWrapper = `const program=${JSON.stringify(REMOTE_BOOTSTRAP_PROGRAM)};const digest=process.getBuiltinModule("node:crypto").createHash("sha256").update(program).digest("hex");Function("BUILD_DIGEST",program)(digest);`;
const quotePosixShell = (value: string) =>
  `'${value.replaceAll("'", `'\\''`)}'`;

export const REMOTE_BOOTSTRAP_COMMAND = `node -e ${quotePosixShell(bootstrapWrapper)}`;

export function describeRemoteBootstrap() {
  return {
    cliPackage: CLI_PACKAGE,
    cliVersion: CLI_VERSION,
    digest: REMOTE_BOOTSTRAP_DIGEST,
    protocolVersion: REMOTE_BOOTSTRAP_PROTOCOL_VERSION,
  } as const;
}
