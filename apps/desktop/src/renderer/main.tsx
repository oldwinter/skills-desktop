import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceShell } from "./features/workspace/WorkspaceShell.js";
import "./styles.css";

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Renderer root is unavailable.");

createRoot(root).render(
  <StrictMode>
    <WorkspaceShell client={window.skillsDesktop} />
  </StrictMode>,
);
