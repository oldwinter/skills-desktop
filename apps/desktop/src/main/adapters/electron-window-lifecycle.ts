interface WindowLifecycleSource {
  readonly webContents: {
    readonly id: number;
  };
  once(event: "closed", listener: () => void): unknown;
}

export function onWindowClosed(
  window: WindowLifecycleSource,
  handleClosed: (webContentsId: number) => void,
) {
  const webContentsId = window.webContents.id;
  window.once("closed", () => handleClosed(webContentsId));
}
