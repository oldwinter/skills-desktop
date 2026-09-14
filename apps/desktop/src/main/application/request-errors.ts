import type { Result } from "@skills-desktop/skills-runtime";

import type { RendererError } from "../../contracts/workspace.js";

export type RequestError = RendererError;

export function publicError<Code extends RequestError["code"]>(
  code: Code,
  message: string,
  phase: string,
  retryable: boolean,
): Omit<RendererError, "code"> & { readonly code: Code } {
  return { code, effects: "none", message, phase, retryable };
}

export function requestFailure(
  error: RequestError,
): Result<never, RequestError> {
  return { error, ok: false };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
