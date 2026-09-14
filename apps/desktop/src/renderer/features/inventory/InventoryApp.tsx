import type { DesktopBridge } from "../../../contracts/desktop.js";
import { WorkspaceShell } from "../workspace/WorkspaceShell.js";

export function InventoryApp({ client }: { readonly client: DesktopBridge }) {
  return <WorkspaceShell client={client} />;
}
