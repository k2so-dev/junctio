import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export const TEMP_PREFIX = "junctio-audit-";

export function tempRoot(): string {
  return Bun.env.TMPDIR ?? "/tmp";
}

export async function withTempDir<T>(root: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(root, TEMP_PREFIX));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function sweepTempDirs(root: string, maxAgeMs = 3_600_000, now = Date.now()): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(TEMP_PREFIX)) continue;
    const path = join(root, entry);
    try {
      if (now - statSync(path).mtimeMs < maxAgeMs) continue;
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } catch {}
  }
  return removed;
}
