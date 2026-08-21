/// <reference types="vite/client" />

import type { WorkspaceBridge } from "../contracts/workspace.js";

declare global {
  interface Window {
    readonly skillsDesktop: WorkspaceBridge;
  }
}

export {};
