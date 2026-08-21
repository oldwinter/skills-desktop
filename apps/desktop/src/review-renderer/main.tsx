import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ReviewSurface } from "./ReviewSurface.js";
import "./styles.css";

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement))
  throw new Error("Review root is unavailable.");
createRoot(root).render(
  <StrictMode>
    <ReviewSurface client={window.skillsReview} />
  </StrictMode>,
);
