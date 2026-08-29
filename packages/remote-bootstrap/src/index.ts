import {
  CLI_PACKAGE,
  CLI_VERSION,
  HARNESS_SCOPE_SUPPORT_BY_ID,
  WIRE_FRAME_ENCODER_SOURCE,
  WIRE_REQUEST_VALIDATOR_SOURCE,
  WIRE_SINGLE_FRAME_DECODER_SOURCE,
  MAX_WIRE_FRAME_BYTES,
  MAX_WIRE_HARNESS_LENGTH,
  MAX_WIRE_INVENTORY_JSON_BYTES,
  MAX_WIRE_REQUEST_BYTES,
  MAX_WIRE_REQUEST_ID_LENGTH,
  MAX_WIRE_WORKSPACE_LENGTH,
  WIRE_PROTOCOL_VERSION,
} from "@skills-desktop/skills-runtime";

export const REMOTE_BOOTSTRAP_PROTOCOL_VERSION = WIRE_PROTOCOL_VERSION;

export const REMOTE_BOOTSTRAP_PROGRAM = String.raw`
"use strict";
const MAX_WIRE_FRAME_BYTES = ${MAX_WIRE_FRAME_BYTES};
const MAX_WIRE_HARNESS_LENGTH = ${MAX_WIRE_HARNESS_LENGTH};
const MAX_WIRE_REQUEST_ID_LENGTH = ${MAX_WIRE_REQUEST_ID_LENGTH};
const MAX_WIRE_WORKSPACE_LENGTH = ${MAX_WIRE_WORKSPACE_LENGTH};
const WIRE_PROTOCOL_VERSION = ${WIRE_PROTOCOL_VERSION};
const encodeWireFramePayload = ${WIRE_FRAME_ENCODER_SOURCE};
const decodeSingleWireFramePayload = ${WIRE_SINGLE_FRAME_DECODER_SOURCE};
const validateWireRequest = ${WIRE_REQUEST_VALIDATOR_SOURCE};
const isWireRequest = (value) => validateWireRequest(
  value,
  WIRE_PROTOCOL_VERSION,
  MAX_WIRE_HARNESS_LENGTH,
  MAX_WIRE_REQUEST_ID_LENGTH,
  MAX_WIRE_WORKSPACE_LENGTH,
);

(async () => {
  const childProcess = process.getBuiltinModule("node:child_process");
  const fileSystem = process.getBuiltinModule("node:fs");
  const operatingSystem = process.getBuiltinModule("node:os");
  const pathModule = process.getBuiltinModule("node:path");
  const MAX_OUTPUT_BYTES = ${MAX_WIRE_INVENTORY_JSON_BYTES};
  const MAX_REQUEST_BYTES = ${MAX_WIRE_REQUEST_BYTES};
  const CLI_PACKAGE = ${JSON.stringify(CLI_PACKAGE)};
  const CLI_VERSION = ${JSON.stringify(CLI_VERSION)};
  const HARNESS_SCOPE_SUPPORT_BY_ID = ${JSON.stringify(HARNESS_SCOPE_SUPPORT_BY_ID)};
  const children = new Set();
  const mutationGroups = new Set();
  let requestMutationCleanup;
  let requestObservationCleanup;
  let observationInterruption;
  let transportLost = false;

  const interruptObservation = (code) => {
    if (
      observationInterruption === undefined ||
      code === "remote_protocol_violation"
    ) {
      observationInterruption = {
        code,
        phase: code === "remote_protocol_violation" ? "wire" : "observe",
      };
    }
    if (requestObservationCleanup !== undefined) {
      requestObservationCleanup(observationInterruption.code);
    }
  };

  const writeFrame = (value) => {
    process.stdout.write(Buffer.from(encodeWireFramePayload(value, MAX_WIRE_FRAME_BYTES)));
  };
  const failure = (code, message, phase, requestId = null) => {
    writeFrame({ code, message, phase, protocolVersion: WIRE_PROTOCOL_VERSION, requestId, type: "failure" });
  };
  writeFrame({ bootstrapDigest: BUILD_DIGEST, protocolVersion: WIRE_PROTOCOL_VERSION, type: "hello" });

  const terminateChildren = () => {
    transportLost = true;
    if (requestMutationCleanup !== undefined) requestMutationCleanup();
    for (const pid of mutationGroups) {
      try { process.kill(-pid, "SIGTERM"); } catch {}
    }
    for (const child of children) {
      try { child.kill("SIGTERM"); } catch {}
    }
  };
  process.once("SIGHUP", terminateChildren);
  process.once("SIGINT", terminateChildren);
  process.once("SIGTERM", terminateChildren);

  const requestQueue = [];
  let bufferedInput = Buffer.alloc(0);
  let inputEnded = false;
  let inputFailure;
  let frameCount = 0;
  let request;
  let requestWaiter;
  const settleRequestWaiter = () => {
    if (requestWaiter === undefined) return;
    if (inputFailure !== undefined) {
      const waiter = requestWaiter;
      requestWaiter = undefined;
      waiter.reject(inputFailure);
      return;
    }
    if (requestQueue.length > 0) {
      const waiter = requestWaiter;
      requestWaiter = undefined;
      waiter.resolve(requestQueue.shift());
      return;
    }
    if (inputEnded) {
      const waiter = requestWaiter;
      requestWaiter = undefined;
      waiter.resolve(undefined);
    }
  };
  const failInput = () => {
    inputFailure = { code: "remote_protocol_violation" };
    if (request?.operation === "observe") {
      interruptObservation("remote_protocol_violation");
    }
    settleRequestWaiter();
  };
  const parseInput = () => {
    while (bufferedInput.length >= 4) {
      const length = bufferedInput.readUInt32BE(0);
      if (length > MAX_REQUEST_BYTES) {
        failInput();
        return;
      }
      if (bufferedInput.length < length + 4) return;
      const framed = bufferedInput.subarray(0, length + 4);
      bufferedInput = bufferedInput.subarray(length + 4);
      const payload = decodeSingleWireFramePayload(framed, MAX_REQUEST_BYTES);
      let parsed;
      try {
        parsed = payload === undefined
          ? undefined
          : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
      } catch {
        parsed = undefined;
      }
      frameCount += 1;
      if (parsed === undefined || !isWireRequest(parsed) || frameCount > 2) {
        failInput();
        return;
      }
      requestQueue.push(parsed);
      settleRequestWaiter();
    }
  };
  process.stdin.on("data", (chunk) => {
    if (inputFailure !== undefined) return;
    bufferedInput = Buffer.concat([bufferedInput, chunk]);
    if (bufferedInput.length > 2 * (MAX_REQUEST_BYTES + 4)) {
      failInput();
      return;
    }
    parseInput();
  });
  process.stdin.once("end", () => {
    inputEnded = true;
    if (bufferedInput.length !== 0) failInput();
    else settleRequestWaiter();
  });
  process.stdin.once("error", failInput);
  const nextRequest = () => new Promise((resolve, reject) => {
    requestWaiter = { reject, resolve };
    settleRequestWaiter();
  });
  const settleObservationInput = () => new Promise((resolve) => {
    if (requestQueue.length > 0 || inputEnded || inputFailure !== undefined) {
      resolve();
      return;
    }
    let timer;
    const inspect = () => {
      if (requestQueue.length > 0 || inputEnded || inputFailure !== undefined) {
        if (timer !== undefined) clearTimeout(timer);
        process.stdin.removeListener("data", inspect);
        process.stdin.removeListener("end", inspect);
        process.stdin.removeListener("error", inspect);
        resolve();
      }
    };
    process.stdin.on("data", inspect);
    process.stdin.on("end", inspect);
    process.stdin.on("error", inspect);
    timer = setTimeout(() => {
      process.stdin.removeListener("data", inspect);
      process.stdin.removeListener("end", inspect);
      process.stdin.removeListener("error", inspect);
      resolve();
    }, 25);
  });
  const stopReading = () => {
    process.stdin.pause();
    process.stdin.removeAllListeners();
    if (typeof process.stdin.unref === "function") process.stdin.unref();
  };

  try {
    request = await nextRequest();
  } catch {
    failure("remote_protocol_violation", "The Wire request framing is invalid.", "wire");
    stopReading();
    return;
  }
  if (!isWireRequest(request) || request.operation === "cancel") {
    failure("remote_protocol_violation", "The Wire request is not a supported operation.", "wire");
    stopReading();
    return;
  }
  const harnessId = Object.prototype.hasOwnProperty.call(HARNESS_SCOPE_SUPPORT_BY_ID, request.harness)
    ? request.harness
    : undefined;
  if (harnessId === undefined) {
    failure("remote_protocol_violation", "The Wire harness is not supported by the pinned Skills dialect.", "wire", request.requestId);
    stopReading();
    return;
  }
  if (request.operation === "observe") {
    await settleObservationInput();
    if (requestQueue.length > 0 || inputEnded) {
      let extraRequest;
      try {
        extraRequest = await nextRequest();
      } catch {
        interruptObservation("remote_protocol_violation");
      }
      if (extraRequest !== undefined) {
        interruptObservation(
          extraRequest.operation === "cancel" &&
          extraRequest.requestId === request.requestId
            ? "remote_operation_failed"
            : "remote_protocol_violation",
        );
      }
    } else {
      void nextRequest().then(
        (extraRequest) => {
          if (extraRequest === undefined) return;
          if (
            extraRequest.operation === "cancel" &&
            extraRequest.requestId === request.requestId
          ) {
            interruptObservation("remote_operation_failed");
            return;
          }
          interruptObservation("remote_protocol_violation");
        },
        () => {
          interruptObservation("remote_protocol_violation");
        },
      );
    }
  }

  const environment = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "NPM_CONFIG_CACHE", "PATH", "TEMP", "TMP"]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  const invoke = (args, timeoutMs = 60_000) => new Promise((resolve, reject) => {
    if (
      transportLost ||
      (request.operation === "observe" && observationInterruption !== undefined)
    ) {
      reject({
        code: observationInterruption === undefined
          ? "remote_operation_failed"
          : observationInterruption.code,
      });
      return;
    }
    let captureDirectory;
    let stdoutFile;
    try {
      captureDirectory = fileSystem.mkdtempSync(
        pathModule.join(operatingSystem.tmpdir(), "skills-desktop-remote-output-"),
      );
      const stdoutPath = pathModule.join(captureDirectory, "stdout");
      stdoutFile = fileSystem.openSync(stdoutPath, "wx+", 0o600);
      if (process.platform !== "win32") fileSystem.unlinkSync(stdoutPath);
    } catch {
      if (stdoutFile !== undefined) {
        try { fileSystem.closeSync(stdoutFile); } catch {}
      }
      if (captureDirectory !== undefined) {
        try { fileSystem.rmSync(captureDirectory, { force: true, recursive: true }); } catch {}
      }
      reject({ code: "remote_operation_failed" });
      return;
    }

    let child;
    let closeTimer;
    let forceTimer;
    let outputTimer;
    let settled = false;
    let stderrBytes = 0;
    let outputExceeded = false;
    let processFailure;
    let timeout;
    let observationCleanup;

    const cleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      if (outputTimer !== undefined) clearInterval(outputTimer);
      if (child !== undefined) children.delete(child);
      if (
        observationCleanup !== undefined &&
        requestObservationCleanup === observationCleanup
      ) {
        requestObservationCleanup = undefined;
      }
      let failed = false;
      try { fileSystem.closeSync(stdoutFile); } catch { failed = true; }
      try {
        fileSystem.rmSync(captureDirectory, { force: true, recursive: true });
      } catch {
        failed = true;
      }
      return !failed;
    };
    const rejectOnce = (code) => {
      if (settled) return;
      settled = true;
      reject({ code: cleanup() ? code : "remote_operation_failed" });
    };
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      if (!cleanup()) {
        reject({ code: "remote_operation_failed" });
        return;
      }
      resolve(value);
    };

    try {
      child = childProcess.spawn("npx", ["--yes", CLI_PACKAGE, ...args], {
        cwd: request.workspace,
        env: environment,
        shell: false,
        stdio: ["ignore", stdoutFile, "pipe"],
      });
    } catch {
      rejectOnce("remote_operation_failed");
      return;
    }
    children.add(child);

    let terminationRequested = false;
    const requestTermination = (code) => {
      processFailure = code;
      if (terminationRequested) return;
      terminationRequested = true;
      try { child.kill("SIGTERM"); } catch {}
      forceTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 1_000);
      closeTimer = setTimeout(() => rejectOnce(code), 2_000);
    };
    if (request.operation === "observe") {
      observationCleanup = requestTermination;
      requestObservationCleanup = requestTermination;
      if (observationInterruption !== undefined) {
        requestTermination(observationInterruption.code);
      }
    }
    timeout = setTimeout(() => {
      requestTermination("remote_operation_failed");
    }, timeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();
    const inspectOutput = () => {
      try {
        if (fileSystem.fstatSync(stdoutFile).size > MAX_OUTPUT_BYTES) {
          outputExceeded = true;
          requestTermination("output_limit_exceeded");
        }
      } catch {
        requestTermination("remote_operation_failed");
      }
    };
    outputTimer = setInterval(inspectOutput, 10);
    if (typeof outputTimer.unref === "function") outputTimer.unref();
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        requestTermination("output_limit_exceeded");
      }
    });
    child.once("error", (error) => {
      processFailure = error && error.code === "ENOENT"
        ? "remote_runtime_unavailable"
        : "remote_operation_failed";
    });
    child.once("close", (exitCode) => {
      let stdoutSize;
      try {
        stdoutSize = fileSystem.fstatSync(stdoutFile).size;
      } catch {
        rejectOnce("remote_operation_failed");
        return;
      }
      if (stdoutSize > MAX_OUTPUT_BYTES) outputExceeded = true;
      if (outputExceeded) {
        rejectOnce("output_limit_exceeded");
        return;
      }
      if (processFailure !== undefined) {
        rejectOnce(processFailure);
        return;
      }
      if (exitCode !== 0) {
        rejectOnce("remote_operation_failed");
        return;
      }
      const stdout = Buffer.alloc(stdoutSize);
      let offset = 0;
      while (offset < stdoutSize) {
        const bytesRead = fileSystem.readSync(
          stdoutFile,
          stdout,
          offset,
          stdoutSize - offset,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== stdoutSize) {
        rejectOnce("remote_operation_failed");
        return;
      }
      resolveOnce({
        exitCode: exitCode === null ? 1 : exitCode,
        stdout: stdout.toString("utf8"),
      });
    });
  });

  const mutationGroupExists = (pid) => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return !(error && error.code === "ESRCH");
    }
  };
  const waitForMutationGroupExit = (pid, timeoutMs) => new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const inspect = () => {
      if (!mutationGroupExists(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(inspect, 25);
    };
    inspect();
  });
  const invokeMutation = (args, timeoutMs, requestId) => new Promise((resolve, reject) => {
    const child = childProcess.spawn("npx", ["--yes", CLI_PACKAGE, ...args], {
      cwd: request.workspace,
      detached: true,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    const mutationPid = child.pid;
    if (mutationPid !== undefined) mutationGroups.add(mutationPid);
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let requestedDisposition;
    let processError = false;
    let settled = false;
    let cleanupDeadline;
    let cleanupProofTimer;
    let forceTimer;
    const signalMutationTree = (signal) => {
      if (mutationPid === undefined) {
        try { child.kill(signal); } catch {}
        return;
      }
      try { process.kill(-mutationPid, signal); } catch {}
    };
    const requestCleanup = (disposition) => {
      if (requestedDisposition !== undefined) return;
      requestedDisposition = disposition;
      cleanupDeadline = Date.now() + 1_900;
      signalMutationTree("SIGTERM");
      forceTimer = setTimeout(() => {
        signalMutationTree("SIGKILL");
      }, 1_000);
      cleanupProofTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        reject({ code: "remote_operation_failed" });
      }, 1_900);
    };
    requestMutationCleanup = () => requestCleanup("failed");
    const timeout = setTimeout(() => requestCleanup("timed-out"), timeoutMs);
    void nextRequest().then(
      (cancellation) => {
        if (cancellation === undefined) {
          transportLost = true;
          requestCleanup("failed");
          return;
        }
        if (
          cancellation.operation === "cancel" &&
          cancellation.requestId === requestId
        ) {
          requestCleanup("cancelled");
          return;
        }
        requestCleanup("failed");
      },
      () => {
        requestCleanup("failed");
      },
    );
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        requestCleanup("failed");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        requestCleanup("failed");
      }
    });
    child.once("error", () => {
      if (settled) return;
      processError = true;
      if (mutationPid !== undefined) return;
      settled = true;
      clearTimeout(timeout);
      if (cleanupProofTimer !== undefined) clearTimeout(cleanupProofTimer);
      children.delete(child);
      requestMutationCleanup = undefined;
      resolve({ disposition: requestedDisposition || "failed", exitCode: null });
    });
    child.once("close", (exitCode) => {
      if (settled) {
        clearTimeout(timeout);
        if (cleanupProofTimer !== undefined) clearTimeout(cleanupProofTimer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        children.delete(child);
        if (mutationPid !== undefined) mutationGroups.delete(mutationPid);
        requestMutationCleanup = undefined;
        return;
      }
      void (async () => {
        if (
          mutationPid !== undefined &&
          mutationGroupExists(mutationPid) &&
          requestedDisposition === undefined
        ) {
          requestCleanup("failed");
        }
        const cleanupConfirmed =
          mutationPid === undefined ||
          await waitForMutationGroupExit(
            mutationPid,
            Math.max(0, (cleanupDeadline || Date.now()) - Date.now()),
          );
        if (settled) {
          children.delete(child);
          if (mutationPid !== undefined) mutationGroups.delete(mutationPid);
          requestMutationCleanup = undefined;
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (cleanupProofTimer !== undefined) clearTimeout(cleanupProofTimer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        children.delete(child);
        if (mutationPid !== undefined) mutationGroups.delete(mutationPid);
        requestMutationCleanup = undefined;
        if (!cleanupConfirmed) {
          reject({ code: "remote_operation_failed" });
          return;
        }
        resolve({
          disposition: requestedDisposition || (processError || exitCode !== 0 ? "failed" : "completed"),
          exitCode: requestedDisposition === undefined ? (exitCode === null ? 1 : exitCode) : null,
        });
      })();
    });
  });

  let version;
  let projectJson;
  let globalJson;
  let phase = "version";
  try {
    version = await invoke(["--version"]);
    if (version.stdout.trim() !== CLI_VERSION) {
      failure("remote_runtime_unavailable", "The remote Skills CLI dialect is not supported.", phase, request.requestId);
      stopReading();
      return;
    }
    if (request.operation === "mutate") {
      phase = "mutation";
      if (transportLost) throw { code: "remote_operation_failed" };
      const mutation = request.mutation;
      if (!HARNESS_SCOPE_SUPPORT_BY_ID[harnessId][mutation.scope]) {
        failure("remote_protocol_violation", "The Wire harness is not supported in the selected scope.", "wire", request.requestId);
        stopReading();
        return;
      }
      const scopeFlag = mutation.scope === "global"
        ? ["--global"]
        : mutation.type === "update"
          ? ["--project"]
          : [];
      const args = mutation.type === "add"
        ? ["add", mutation.source.revision === undefined ? mutation.source.source : "https://github.com/" + mutation.source.source + "/archive/" + mutation.source.revision + ".tar.gz", "--skill", ...mutation.names, "--agent", harnessId, ...scopeFlag, "--yes"]
        : mutation.type === "remove"
          ? ["remove", ...mutation.names, "--agent", harnessId, ...scopeFlag, "--yes"]
          : ["update", ...mutation.names, ...scopeFlag, "--yes"];
      const mutationOutcome = await invokeMutation(
        args,
        mutation.type === "remove" ? 120_000 : 600_000,
        request.requestId,
      );
      if (transportLost) throw { code: "remote_operation_failed" };
      phase = "postflight";
      projectJson = (await invoke(["list", "--json"])).stdout;
      globalJson = (await invoke(["list", "--global", "--json"])).stdout;
      writeFrame({
        cliVersion: CLI_VERSION,
        globalJson,
        process: {
          cleanup: "confirmed",
          disposition: mutationOutcome.disposition,
          exitCode: mutationOutcome.exitCode,
        },
        projectJson,
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: request.requestId,
        type: "mutation-result",
      });
      stopReading();
      return;
    }
    phase = "observe";
    projectJson = (await invoke(["list", "--json"])).stdout;
    globalJson = (await invoke(["list", "--global", "--json"])).stdout;
    if (observationInterruption !== undefined) throw observationInterruption;
  } catch (error) {
    const code = error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "remote_operation_failed";
    const failurePhase = observationInterruption === undefined
      ? phase
      : observationInterruption.phase;
    const phaseLabel = failurePhase === "postflight"
      ? "mutation postflight"
      : failurePhase === "mutation"
        ? "mutation"
        : failurePhase === "version"
          ? "runtime verification"
          : failurePhase === "wire"
            ? "Wire framing"
          : "Inventory observation";
    failure(code, code === "output_limit_exceeded"
      ? "Remote " + phaseLabel + " output exceeds its byte limit."
      : code === "remote_runtime_unavailable"
        ? "The remote runtime is unavailable."
        : "Remote " + phaseLabel + " failed.", failurePhase, request.requestId);
    stopReading();
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
    stopReading();
  } catch {
    failure(
      "output_limit_exceeded",
      "Remote Inventory output exceeds its Wire frame limit.",
      "observe",
      request.requestId,
    );
    stopReading();
  }
})().catch(() => {
  try {
    const payload = encodeWireFramePayload({
      code: "remote_operation_failed",
      message: "Remote Bootstrap execution failed.",
      phase: "wire",
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
