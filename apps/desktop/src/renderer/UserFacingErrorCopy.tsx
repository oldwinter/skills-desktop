import { userFacingErrorMessage, type UserFacingErrorLike } from "../contracts/user-facing-error.js";
import { useTranslator } from "./i18n/LocaleProvider.js";

export function UserFacingErrorCopy({
  error,
}: {
  readonly error: UserFacingErrorLike;
}) {
  const { locale, t } = useTranslator();
  return (
    <span className="user-facing-error">
      <span>{userFacingErrorMessage(error, locale)}</span>
      <details className="user-facing-error-details">
        <summary>{t("common.details")}</summary>
        <code>{error.message}</code>
      </details>
    </span>
  );
}
