const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

export class CdpRequestTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super(`CDP request ${method} timed out after ${timeoutMs} ms.`);
    this.name = "CdpRequestTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class CdpDisconnectedError extends Error {
  constructor() {
    super("CDP browser session disconnected.");
    this.name = "CdpDisconnectedError";
  }
}

function timeoutPromise(timeoutMs, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
  });
}

export class CdpPage {
  constructor(socket, options = {}) {
    this.errors = [];
    this.nextId = 1;
    this.pending = new Map();
    this.socket = socket;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.closed = socket.readyState === 3;
    socket.addEventListener("message", (event) => this.#receive(event));
    socket.addEventListener("close", () => this.#disconnect());
    socket.addEventListener("error", () => this.#disconnect());
  }

  static async connect(port, expectedUrl, options = {}) {
    const connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const deadline = Date.now() + connectTimeoutMs;
    let target;
    while (target === undefined) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error("Timed out waiting for the packaged Electron page.");
      }
      const listTargets = await Promise.race([
        fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(Math.min(remainingMs, 1_000)),
        }).then((response) => response.json()),
        timeoutPromise(remainingMs, "Timed out listing CDP targets."),
      ]).catch(() => []);
      target = listTargets.find(
        ({ type, url }) =>
          type === "page" &&
          (expectedUrl === undefined || url === expectedUrl),
      );
      if (target === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await Promise.race([
      new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener(
          "error",
          () => reject(new CdpDisconnectedError()),
          { once: true },
        );
      }),
      timeoutPromise(connectTimeoutMs, "Timed out opening the CDP session."),
    ]);
    const page = new CdpPage(socket, options);
    await Promise.all([page.send("Runtime.enable"), page.send("Page.enable")]);
    return page;
  }

  #receive(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      this.errors.push("CDP returned invalid JSON.");
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        pending.reject(
          new Error(message.error.message ?? "CDP request failed."),
        );
      } else pending.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      this.errors.push(
        message.params?.exceptionDetails?.text ?? "Runtime exception",
      );
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params?.type === "error"
    ) {
      this.errors.push(
        (message.params.args ?? [])
          .map((argument) => argument.value ?? argument.description ?? "Error")
          .join(" "),
      );
    }
  }

  #disconnect() {
    if (this.closed) return;
    this.closed = true;
    const error = new CdpDisconnectedError();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}) {
    if (this.closed || this.socket.readyState !== 1) {
      return Promise.reject(new CdpDisconnectedError());
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpRequestTimeoutError(method, this.requestTimeoutMs));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { reject, resolve, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          this.closed || this.socket.readyState !== 1
            ? new CdpDisconnectedError()
            : error,
        );
      }
    });
  }

  async disconnect(timeoutMs = 5_000) {
    if (this.socket.readyState === 3) {
      this.#disconnect();
      return;
    }
    await Promise.race([
      new Promise((resolve) => {
        this.socket.addEventListener("close", resolve, { once: true });
        this.socket.close();
      }),
      timeoutPromise(timeoutMs, "CDP connection did not close."),
    ]);
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text,
      );
    }
    return response.result.value;
  }

  async setViewportSize(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height,
      mobile: false,
      width,
    });
  }

  async setMediaFeature(name, value) {
    await this.send("Emulation.setEmulatedMedia", {
      features: [{ name, value }],
    });
  }

  async dispatchKey(key, code = key) {
    const virtualKeyCodes = {
      ArrowDown: 40,
      ArrowLeft: 37,
      ArrowRight: 39,
      ArrowUp: 38,
      Enter: 13,
      Escape: 27,
      Space: 32,
      Tab: 9,
    };
    const windowsVirtualKeyCode =
      key.length === 1
        ? key.toUpperCase().charCodeAt(0)
        : virtualKeyCodes[key];
    await this.send("Input.dispatchKeyEvent", {
      code,
      key,
      type: "keyDown",
      windowsVirtualKeyCode,
    });
    await this.send("Input.dispatchKeyEvent", {
      code,
      key,
      type: "keyUp",
      windowsVirtualKeyCode,
    });
  }

  async waitFor(expression, label, timeoutMs = 30_000) {
    await this.evaluate(`(() => new Promise((resolve, reject) => {
      const check = () => {
        if (${expression}) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(true);
        }
      };
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error(${JSON.stringify(`Timed out waiting for ${label}.`)}));
      }, ${timeoutMs});
      observer.observe(document, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      check();
    }))()`);
  }
}
