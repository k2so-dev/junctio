import { and, eq } from "drizzle-orm";
import type { AuditEcosystem, AuditStatus, AuditTrigger } from "@junctio/schema";
import type { Db } from "../db/index.ts";
import type { AuditIgnoreRow, AuditResultRow, StoredFinding } from "../db/schema.ts";
import { auditIgnores, auditResults, servers } from "../db/schema.ts";
import { getSetting, setSetting } from "../db/settings.ts";
import { normalizeAdvisoryId } from "./policy.ts";
import type { AuditRunSummary } from "./types.ts";
import { SELF_ID } from "./types.ts";

export type SaveResult = {
  serverId: string;
  status: AuditStatus;
  ecosystem: AuditEcosystem | null;
  target: string[];
  resolved: string[];
  findings: StoredFinding[];
  engine: string | null;
  error: string | null;
  reason: string | null;
  trigger: AuditTrigger;
  durationMs: number | null;
};

export class AuditStore {
  constructor(private readonly db: Db) {}

  get(serverId: string): AuditResultRow | null {
    return this.db.select().from(auditResults).where(eq(auditResults.serverId, serverId)).get() ?? null;
  }

  all(): AuditResultRow[] {
    return this.db.select().from(auditResults).all();
  }

  save(result: SaveResult): void {
    const row = { ...result, checkedAt: Date.now() };
    this.db
      .insert(auditResults)
      .values(row)
      .onConflictDoUpdate({ target: auditResults.serverId, set: row })
      .run();
  }

  delete(serverId: string): void {
    this.db.delete(auditResults).where(eq(auditResults.serverId, serverId)).run();
  }

  ignores(serverId: string): AuditIgnoreRow[] {
    return this.db.select().from(auditIgnores).where(eq(auditIgnores.serverId, serverId)).all();
  }

  ignoreSet(serverId: string): Set<string> {
    return new Set(this.ignores(serverId).map((row) => normalizeAdvisoryId(row.advisoryId)));
  }

  addIgnore(serverId: string, advisoryId: string, reason: string | null): void {
    const id = normalizeAdvisoryId(advisoryId);
    this.db
      .insert(auditIgnores)
      .values({ serverId, advisoryId: id, reason, createdAt: Date.now() })
      .onConflictDoUpdate({ target: [auditIgnores.serverId, auditIgnores.advisoryId], set: { reason } })
      .run();
  }

  removeIgnore(serverId: string, advisoryId: string): boolean {
    const id = normalizeAdvisoryId(advisoryId);
    const existing = this.db
      .select()
      .from(auditIgnores)
      .where(and(eq(auditIgnores.serverId, serverId), eq(auditIgnores.advisoryId, id)))
      .get();
    if (!existing) return false;
    this.db
      .delete(auditIgnores)
      .where(and(eq(auditIgnores.serverId, serverId), eq(auditIgnores.advisoryId, id)))
      .run();
    return true;
  }

  setQuarantine(serverId: string, reason: string | null): void {
    this.db
      .update(servers)
      .set({ quarantinedAt: reason === null ? null : Date.now(), quarantineReason: reason })
      .where(eq(servers.id, serverId))
      .run();
  }

  setDisabledByAudit(serverId: string, reason: string): void {
    this.db
      .update(servers)
      .set({ enabled: false, disabledReason: reason, updatedAt: Date.now() })
      .where(eq(servers.id, serverId))
      .run();
  }

  clearDisabledReason(serverId: string): void {
    this.db.update(servers).set({ disabledReason: null }).where(eq(servers.id, serverId)).run();
  }

  lastRun(): AuditRunSummary | null {
    const raw = getSetting(this.db, "audit_last_run");
    if (raw === "") return null;
    try {
      return JSON.parse(raw) as AuditRunSummary;
    } catch {
      return null;
    }
  }

  saveLastRun(summary: AuditRunSummary): void {
    setSetting(this.db, "audit_last_run", JSON.stringify(summary));
  }

  pruneOrphans(): number {
    const known = new Set(this.db.select({ id: servers.id }).from(servers).all().map((row) => row.id));
    known.add(SELF_ID);
    let removed = 0;
    for (const row of this.all()) {
      if (known.has(row.serverId)) continue;
      this.delete(row.serverId);
      removed += 1;
    }
    return removed;
  }
}
