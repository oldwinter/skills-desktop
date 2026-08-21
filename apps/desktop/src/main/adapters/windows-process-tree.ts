import { execFile } from "node:child_process";

export function createWindowsProcessTreeKiller(timeoutMs: number) {
  return (pid: number) =>
    new Promise<void>((resolve, reject) => {
      execFile(
        "taskkill.exe",
        ["/pid", String(pid), "/t", "/f"],
        {
          shell: false,
          timeout: timeoutMs,
          windowsHide: true,
        },
        (error) => {
          if (error === null) resolve();
          else reject(error);
        },
      );
    });
}
