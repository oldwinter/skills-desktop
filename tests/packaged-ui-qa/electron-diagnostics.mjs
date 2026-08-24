const SANDBOX_STARTUP_HEADING =
  "Electron sandboxed_renderer.bundle.js script failed to run";
const SANDBOX_STARTUP_CAUSE =
  "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.";
const SANDBOX_STARTUP_FRAME =
  /^ {4}at (?:.+ \()?node:electron\/js2c\/sandbox_bundle:\d+:\d+\)?$/;

export function isElectronSandboxStartupDiagnostic(text) {
  if (text === SANDBOX_STARTUP_HEADING) return true;

  const [heading, cause, ...frames] = text.split(/\r?\n/);
  return (
    heading === SANDBOX_STARTUP_HEADING &&
    cause === SANDBOX_STARTUP_CAUSE &&
    frames.length > 0 &&
    frames.every((frame) => SANDBOX_STARTUP_FRAME.test(frame))
  );
}
