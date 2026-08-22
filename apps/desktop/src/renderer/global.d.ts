/// <reference types="vite/client" />

import type { DesktopBridge } from "../contracts/desktop.js";

declare global {
  interface Window {
    readonly skillsDesktop: DesktopBridge;
  }
}

export {};
