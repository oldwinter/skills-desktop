import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { InventoryApp } from "./features/inventory/InventoryApp.js";
import "./styles.css";

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Renderer root is unavailable.");

createRoot(root).render(
  <StrictMode>
    <InventoryApp client={window.skillsDesktop} />
  </StrictMode>,
);
