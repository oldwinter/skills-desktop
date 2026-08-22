import type { AboutBridge } from "./about.js";
import type { WorkspaceBridge } from "./workspace.js";

export interface DesktopBridge extends WorkspaceBridge {
  readonly about: AboutBridge;
}
