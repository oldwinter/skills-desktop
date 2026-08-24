import { z } from "zod";

import type { AboutBridge } from "./about.js";
import type { WorkspaceBridge } from "./workspace.js";

export const reviewWindowClosedEventSchema = z
  .object({
    reviewId: z.string().min(1).max(256),
    schemaVersion: z.literal(1),
  })
  .strict();

export type ReviewWindowClosedEvent = z.infer<
  typeof reviewWindowClosedEventSchema
>;

export interface DesktopBridge extends WorkspaceBridge {
  readonly about: AboutBridge;
  subscribeReviewWindowClosed(
    listener: (event: ReviewWindowClosedEvent) => void,
  ): () => void;
}
