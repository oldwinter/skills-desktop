export type EffectsCertainty = "none" | "possible" | "confirmed";

export interface PublicError<Code extends string = string> {
  readonly code: Code;
  readonly effects: EffectsCertainty;
  readonly message: string;
  readonly phase: string;
  readonly retryable: boolean;
}

export type Result<Value, ErrorValue = PublicError> =
  | { readonly ok: true; readonly value: Value }
  | { readonly error: ErrorValue; readonly ok: false };
