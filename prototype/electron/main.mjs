import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain } from "electron";

const execFileAsync = promisify(execFile);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const prototypeRoot = path.resolve(currentDir, "..");
const workspaceRoot = process.env.SKILLS_WORKSPACE || path.resolve(prototypeRoot, "../../..");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

async function runSkills(args) {
  const { stdout } = await execFileAsync(npxCommand, ["-y", "skills@latest", ...args], {
    cwd: workspaceRoot,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function listLocalSkills() {
  const [projectOutput, globalOutput, cliVersion] = await Promise.all([
    runSkills(["list", "--json"]),
    runSkills(["list", "--global", "--json"]),
    runSkills(["--version"]),
  ]);

  const skills = [...JSON.parse(projectOutput), ...JSON.parse(globalOutput)].map((skill) => ({
    ...skill,
    agents: Array.isArray(skill.agents) ? skill.agents : [],
  }));

  return {
    cliVersion,
    scannedAt: new Date().toISOString(),
    skills,
    workspaceRoot,
  };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: "#f5f6f7",
    title: "Skills Desktop Prototype",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDir, "preload.cjs"),
      sandbox: true,
    },
  });

  const entry = path.join(prototypeRoot, "dist", "index.html");
  void window.loadFile(entry, { query: { prototype: "1" } });
}

ipcMain.handle("skills:list-local", listLocalSkills);

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
