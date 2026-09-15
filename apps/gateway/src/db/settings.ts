import { eq } from "drizzle-orm";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Db } from "./index.ts";
import { settings } from "./schema.ts";
import { newCipherSalt, randomId } from "../crypto.ts";
import { DEFAULT_ACTIONS } from "../audit/policy.ts";

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
  gateway_id: "",
  cipher_salt: "",
  tool_separator: "__",
  runtime_path: defaultRuntimePath(),
  api_key_query_param: "false",
  request_log_retention_days: "7",
  admin_password_hash: "",
  admin_mcp_enabled: "false",
  audit_enabled: "false",
  audit_interval_hours: "24",
  audit_actions: JSON.stringify(DEFAULT_ACTIONS),
  audit_last_run: ""
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export function getSetting(db: Db, key: SettingKey): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? DEFAULT_SETTINGS[key];
}

export function setSetting(db: Db, key: SettingKey, value: string): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export function cipherSalt(db: Db): Uint8Array {
  const current = getSetting(db, "cipher_salt");
  if (current !== "") return Uint8Array.from(Buffer.from(current, "hex"));
  const salt = newCipherSalt();
  setSetting(db, "cipher_salt", Buffer.from(salt).toString("hex"));
  return salt;
}

export function gatewayId(db: Db): string {
  const current = getSetting(db, "gateway_id");
  if (current !== "") return current;
  const next = randomId();
  setSetting(db, "gateway_id", next);
  return next;
}

export function reconcileGatewayId(db: Db, dataDir: string): string {
  const file = join(dataDir, "gateway-id");
  const onDisk = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  if (onDisk !== "" && getSetting(db, "gateway_id") === "") {
    setSetting(db, "gateway_id", onDisk);
    return onDisk;
  }
  const id = gatewayId(db);
  if (onDisk !== id) writeFileSync(file, id);
  return id;
}

export function getSettings(db: Db): Record<SettingKey, string> {
  const rows = db.select().from(settings).all();
  const out = { ...DEFAULT_SETTINGS } as Record<SettingKey, string>;
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) out[row.key as SettingKey] = row.value;
  }
  return out;
}
