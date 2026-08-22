import { basename, normalize, parse } from "node:path";

export function localWorkspaceLabel(workspace: string): string {
  return basename(workspace) || workspace;
}

export function isLocalWorkspaceRoot(workspace: string): boolean {
  const normalized = normalize(workspace);
  return normalized === parse(normalized).root;
}
