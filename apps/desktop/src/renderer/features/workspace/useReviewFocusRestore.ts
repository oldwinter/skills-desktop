import { useEffect, useRef, type RefObject } from "react";

import type { DesktopBridge } from "../../../contracts/desktop.js";
import type { PublicMutationState } from "../../../contracts/workspace.js";

export interface ReviewFocusIntent {
  closed: boolean;
  exhausted: boolean;
  reviewId: string | undefined;
}

const REVIEW_FOCUS_INTERVAL_MS = 16;
const REVIEW_FOCUS_MAX_CHECKS = 60;
const REVIEW_FOCUS_STABLE_CHECKS = 12;

export function useReviewFocusRestore(
  client: DesktopBridge,
  mutationPhase: PublicMutationState["phase"] | undefined,
): {
  readonly cancel: () => void;
  readonly currentIntent: () => ReviewFocusIntent | null;
  readonly mutationOutcomeRef: RefObject<HTMLParagraphElement | null>;
  readonly noteOpenedReview: (
    intent: ReviewFocusIntent,
    reviewId: string,
  ) => void;
  readonly schedule: () => void;
  readonly setReturnFocus: (element: HTMLButtonElement) => void;
  readonly startIntent: () => ReviewFocusIntent;
} {
  const mutationPhaseRef = useRef(mutationPhase);
  mutationPhaseRef.current = mutationPhase;
  const mutationOutcomeRef = useRef<HTMLParagraphElement | null>(null);
  const reviewReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const cancelReviewFocusRestoreRef = useRef<() => void>(() => undefined);
  const scheduleReviewFocusRestoreRef = useRef<() => void>(() => undefined);
  const reviewFocusIntentRef = useRef<ReviewFocusIntent | null>(null);
  const lastClosedReviewIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let pendingRestore: number | undefined;
    let restoreGeneration = 0;
    const cancelScheduledRestore = () => {
      restoreGeneration += 1;
      if (pendingRestore !== undefined) {
        window.clearTimeout(pendingRestore);
        pendingRestore = undefined;
      }
    };
    const cancelReviewFocusRestore = () => {
      cancelScheduledRestore();
      reviewReturnFocusRef.current = null;
      reviewFocusIntentRef.current = null;
      lastClosedReviewIdRef.current = undefined;
    };
    const scheduleReviewFocusRestore = () => {
      const intent = reviewFocusIntentRef.current;
      if (intent === null || !intent.closed) return;
      cancelScheduledRestore();
      intent.exhausted = false;
      const generation = restoreGeneration;
      let expectedTarget: HTMLElement | null = null;
      let focusChecks = 0;
      let stableChecks = 0;
      const scheduleNextCheck = () => {
        if (focusChecks >= REVIEW_FOCUS_MAX_CHECKS) {
          intent.exhausted = true;
          return;
        }
        pendingRestore = window.setTimeout(
          restoreFocus,
          REVIEW_FOCUS_INTERVAL_MS,
        );
      };
      const restoreFocus = () => {
        pendingRestore = undefined;
        if (generation !== restoreGeneration) return;
        if (reviewFocusIntentRef.current !== intent || !intent.closed) return;
        const opener = reviewReturnFocusRef.current;
        if (opener === null) return;

        focusChecks += 1;
        const workspaceFocused =
          document.hasFocus() && mutationPhaseRef.current !== "reviewing";
        if (!workspaceFocused) {
          scheduleNextCheck();
          return;
        }
        const target =
          opener.isConnected && !opener.disabled
            ? opener
            : (mutationOutcomeRef.current ??
              document.querySelector<HTMLButtonElement>(
                'button[aria-label="Inventory"]',
              ));
        if (target === null) {
          if (focusChecks >= REVIEW_FOCUS_MAX_CHECKS) intent.exhausted = true;
          else scheduleNextCheck();
          return;
        }

        if (target !== expectedTarget) {
          expectedTarget = target;
          stableChecks = 0;
        }
        if (document.activeElement === target) {
          stableChecks += 1;
        } else {
          target.focus({ preventScroll: true });
          stableChecks = 0;
        }
        if (stableChecks >= REVIEW_FOCUS_STABLE_CHECKS) {
          reviewReturnFocusRef.current = null;
          reviewFocusIntentRef.current = null;
          lastClosedReviewIdRef.current = undefined;
          return;
        }
        if (focusChecks >= REVIEW_FOCUS_MAX_CHECKS) {
          intent.exhausted = true;
          return;
        }
        scheduleNextCheck();
      };
      scheduleNextCheck();
    };
    const handleWindowFocus = () => {
      scheduleReviewFocusRestore();
    };
    const handleWorkspaceInput = () => {
      if (reviewReturnFocusRef.current !== null) cancelReviewFocusRestore();
    };
    cancelReviewFocusRestoreRef.current = cancelReviewFocusRestore;
    scheduleReviewFocusRestoreRef.current = scheduleReviewFocusRestore;
    window.addEventListener("click", handleWorkspaceInput, true);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("keydown", handleWorkspaceInput, true);
    window.addEventListener("pointerdown", handleWorkspaceInput, true);
    return () => {
      window.removeEventListener("click", handleWorkspaceInput, true);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("keydown", handleWorkspaceInput, true);
      window.removeEventListener("pointerdown", handleWorkspaceInput, true);
      cancelReviewFocusRestore();
      cancelReviewFocusRestoreRef.current = () => undefined;
      scheduleReviewFocusRestoreRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = client.subscribeReviewWindowClosed(({ reviewId }) => {
      const intent = reviewFocusIntentRef.current;
      if (intent === null) return;
      if (intent.reviewId === undefined) {
        lastClosedReviewIdRef.current = reviewId;
        return;
      }
      if (intent.reviewId !== reviewId) return;
      intent.closed = true;
      scheduleReviewFocusRestoreRef.current();
    });
    return unsubscribe;
  }, [client]);

  useEffect(() => {
    const intent = reviewFocusIntentRef.current;
    if (
      intent?.closed &&
      intent.exhausted &&
      mutationPhase !== "reviewing"
    ) {
      scheduleReviewFocusRestoreRef.current();
    }
  }, [mutationPhase]);

  return {
    cancel: () => cancelReviewFocusRestoreRef.current(),
    currentIntent: () => reviewFocusIntentRef.current,
    mutationOutcomeRef,
    noteOpenedReview: (intent, reviewId) => {
      intent.reviewId = reviewId;
      const lastClosedReviewId = lastClosedReviewIdRef.current;
      lastClosedReviewIdRef.current = undefined;
      if (lastClosedReviewId === reviewId) {
        intent.closed = true;
        scheduleReviewFocusRestoreRef.current();
      }
    },
    schedule: () => scheduleReviewFocusRestoreRef.current(),
    setReturnFocus: (element) => {
      reviewReturnFocusRef.current = element;
    },
    startIntent: () => {
      const intent: ReviewFocusIntent = {
        closed: false,
        exhausted: false,
        reviewId: undefined,
      };
      reviewFocusIntentRef.current = intent;
      return intent;
    },
  };
}
