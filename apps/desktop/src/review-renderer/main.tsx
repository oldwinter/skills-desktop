import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { ReviewBridge, ReviewSnapshot } from "../contracts/review.js";
import "./styles.css";

function ReviewSurface({ client }: { readonly client: ReviewBridge }) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>();
  useEffect(() => {
    void client.getReview().then((result) => {
      if (result.ok) setSnapshot(result.value);
    });
  }, [client]);
  return (
    <main>
      <h1>Trusted Review</h1>
      <p>{snapshot === undefined ? "Loading review" : "No review is available"}</p>
    </main>
  );
}

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Review root is unavailable.");
createRoot(root).render(
  <StrictMode><ReviewSurface client={window.skillsReview} /></StrictMode>,
);
