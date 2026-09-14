import { lt } from "drizzle-orm";
import type { Core } from "../core.ts";
import { requestLog } from "../db/schema.ts";
import { getSetting } from "../db/settings.ts";

export type RequestRecord = {
  endpointId: string | null;
  serverId: string | null;
  method: string;
  tool: string | null;
  durationMs: number;
  status: "ok" | "error";
  errorCode: string | null;
};

export function recordRequest(core: Core, record: RequestRecord): void {
  try {
    core.db
      .insert(requestLog)
      .values({ ...record, ts: Date.now() })
      .run();
  } catch (error) {
    core.logger.warn("failed to record request", { error: String(error) });
  }
}

export function pruneRequestLog(core: Core): number {
  const days = Number(getSetting(core.db, "request_log_retention_days"));
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = Date.now() - days * 86_400_000;
  const result = core.db.delete(requestLog).where(lt(requestLog.ts, cutoff)).run() as unknown as { changes?: number };
  return Number(result?.changes ?? 0);
}
