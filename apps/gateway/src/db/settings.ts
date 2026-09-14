import { eq } from "drizzle-orm";
import { dirname } from "node:path";
import type { Db } from "./index.ts";
import { settings } from "./schema.ts";

const RUNTIME_BINARIES = ["bun", "bunx", "node", "npx", "uv", "uvx"];
const SYSTEM_PATH = ["/usr/local/bin", "/usr/bin", "/bin"];

export function defaultRuntimePath(): string {
  const dirs: string[] = [];
  const add = (dir: string) => {
    if (!dirs.includes(dir)) dirs.push(dir);
  };
  add(dirname(process.execPath));
  for (const binary of RUNTIME_BINARIES) {
    const found = Bun.which(binary);
    if (found) add(dirname(found));
  }
  for (const dir of SYSTEM_PATH) add(dir);
  return dirs.join(":");
}

export const DEFAULT_SETTINGS = {
  tool_separator: "__",
  runtime_path: defaultRuntimePath(),
  api_key_query_param: "false",
  request_log_retention_days: "7",
  admin_password_hash: ""
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export function getSetting(db: Db, key: SettingKey): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? DEFAULT_SETTINGS[key];
}

export function setSetting(db: Db, key: SettingKey, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getSettings(db: Db): Record<SettingKey, string> {
  const rows = db.select().from(settings).all();
  const out = { ...DEFAULT_SETTINGS } as Record<SettingKey, string>;
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) out[row.key as SettingKey] = row.value;
  }
  return out;
}
