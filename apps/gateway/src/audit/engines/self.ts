import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AuditTarget, Unsupported } from "../types.ts";

export const APP_DIR = resolve(import.meta.dir, "../../..");

export function selfTarget(appDir: string = APP_DIR): AuditTarget | Unsupported {
  if (!existsSync(join(appDir, "package.json"))) {
    return { kind: "unsupported", reason: "package.json is not next to the gateway sources" };
  }
  if (!existsSync(join(appDir, "bun.lock"))) {
    return { kind: "unsupported", reason: "bun.lock is not shipped in this image, the gateway cannot audit itself" };
  }
  return { kind: "self", appDir };
}
