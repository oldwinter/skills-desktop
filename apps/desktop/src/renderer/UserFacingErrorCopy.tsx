import { userFacingErrorMessage, type UserFacingErrorLike } from "../contracts/user-facing-error.js";

export function UserFacingErrorCopy({
  error,
}: {
  readonly error: UserFacingErrorLike;
}) {
  return (
    <span className="user-facing-error">
      <span>{userFacingErrorMessage(error)}</span>
      <details className="user-facing-error-details">
        <summary>详情</summary>
        <code>{error.message}</code>
      </details>
    </span>
  );
}
