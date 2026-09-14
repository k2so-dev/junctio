import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type TmpdirCheck = {
  path: string;
  noexec: boolean;
};

function mountOptions(path: string, mounts: string): string[] | null {
  let best: { length: number; options: string[] } | null = null;
  for (const line of mounts.split("\n")) {
    const parts = line.split(" ");
    const point = parts[1];
    const options = parts[3];
    if (!point || !options) continue;
    const decoded = point.replaceAll("\\040", " ");
    if (path !== decoded && !path.startsWith(decoded === "/" ? "/" : `${decoded}/`)) continue;
    if (!best || decoded.length > best.length) best = { length: decoded.length, options: options.split(",") };
  }
  return best?.options ?? null;
}

export function checkTmpdir(env: Record<string, string | undefined> = Bun.env): TmpdirCheck {
  const path = resolve(env.TMPDIR ?? "/tmp");
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    return { path, noexec: false };
  }
  let mounts = "";
  try {
    mounts = readFileSync("/proc/mounts", "utf8");
  } catch {
    return { path, noexec: false };
  }
  return { path, noexec: mountOptions(path, mounts)?.includes("noexec") ?? false };
}
