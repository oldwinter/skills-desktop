import { REPOSITORY_URL } from "./downloads.js";

const blob = (path: string) => `${REPOSITORY_URL}/blob/main/${path}`;

export const DOC_LINKS = {
  adrs: `${REPOSITORY_URL}/tree/main/docs/adr`,
  changelog: `${REPOSITORY_URL}/commits/main`,
  context: blob("CONTEXT.md"),
  contributing: blob("CONTRIBUTING.md"),
  previewGuide: blob("docs/unsigned-developer-preview.md"),
  userGuide: blob("docs/user-guide.md"),
} as const;
