import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AuditTarget, Unsupported } from "../types.ts";

/**
 * The workspace root, which is where the lockfile covering every gateway dependency lives. Walking
 * up beats a fixed climb: that one pointed at apps/gateway once the sources moved under apps/.
 */
function workspaceRoot(from: string): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "bun.lock"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from, "../../..");
    dir = parent;
  }
}

export const APP_DIR = workspaceRoot(import.meta.dir);

export function selfTarget(appDir: string = APP_DIR): AuditTarget | Unsupported {
  if (!existsSync(join(appDir, "package.json"))) {
    return { kind: "unsupported", reason: "package.json is not next to the gateway sources" };
  }
  if (!existsSync(join(appDir, "bun.lock"))) {
    return { kind: "unsupported", reason: "bun.lock is not shipped in this image, the gateway cannot audit itself" };
  }
  return { kind: "self", appDir };
}
