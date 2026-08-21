/// <reference types="vite/client" />

import type { ReviewBridge } from "../contracts/review.js";

declare global {
  interface Window {
    readonly skillsReview: ReviewBridge;
  }
}

export {};
