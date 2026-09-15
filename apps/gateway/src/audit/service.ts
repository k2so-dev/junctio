import { eq } from "drizzle-orm";
import type {
  AuditEcosystem,
  AuditOverviewDto,
  AuditReportDto,
  AuditStatus,
  AuditSummaryDto,
  AuditTrigger
} from "@junctio/schema";
import type { Db } from "../db/index.ts";
import type { AuditResultRow, ServerRow, StoredFinding } from "../db/schema.ts";
import { servers } from "../db/schema.ts";
import { getSetting } from "../db/settings.ts";
import type { Logger } from "../log.ts";
import type { LogRegistry } from "../upstream/logbuffer.ts";
import type { ServerRegistry } from "../upstream/registry.ts";
import { buildChildEnv } from "../upstream/command.ts";
import { BunAuditEngine } from "./engines/npm.ts";
import { OsvPypiEngine } from "./engines/pypi.ts";
import { APP_DIR, selfTarget } from "./engines/self.ts";
import { decide, emptyCounts, parseActionMap, shouldLift } from "./policy.ts";
import type { Decision } from "./policy.ts";
import { auditTarget } from "./spec.ts";
import { AuditStore } from "./store.ts";
import { sweepTempDirs, tempRoot } from "./tmp.ts";
import type { AuditEngine, AuditFinding, AuditRunSummary, AuditTarget, Unsupported } from "./types.ts";
import { ECOSYSTEM_BY_KIND, SELF_ID, targetValues } from "./types.ts";

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_SERVER_TIMEOUT_MS = 180_000;
const DEFAULT_STARTUP_DELAY_MS = 30_000;

export type AuditServiceOptions = {
  db: Db;
  logger: Logger;
  logs: LogRegistry;
  registry: ServerRegistry;
  stopInstance: (serverId: string, reason: string) => Promise<void>;
  engines?: AuditEngine[];
  targetFor?: (row: ServerRow) => AuditTarget | Unsupported;
  fetchImpl?: typeof fetch;
  tickMs?: number;
  intervalMs?: number;
  serverTimeoutMs?: number;
  startupDelayMs?: number;
  appDir?: string;
};

type Job = {
  serverId: string;
  trigger: AuditTrigger;
  resolve: (row: AuditResultRow) => void;
  reject: (error: unknown) => void;
};

function emptySummary(trigger: AuditTrigger, total: number): AuditRunSummary {
  return {
    trigger,
    startedAt: Date.now(),
    finishedAt: null,
    total,
    done: 0,
    ok: 0,
    vulnerable: 0,
    errors: 0,
    unsupported: 0,
    quarantined: 0,
    lifted: 0,
    disabled: 0
  };
}

export class AuditService {
  readonly store: AuditStore;
  readonly stats = { runs: 0, audited: 0, errors: 0, quarantines: 0, lifts: 0, disables: 0 };

  private readonly engines: AuditEngine[];
  private readonly appDir: string;
  private readonly queue: Job[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private worker: Promise<void> | null = null;
  private running: Promise<AuditRunSummary> | null = null;
  private currentSummary: AuditRunSummary | null = null;
  private controller = new AbortController();
  private startedAt = Date.now();
  private stopped = false;

  constructor(private readonly options: AuditServiceOptions) {
    this.store = new AuditStore(options.db);
    this.appDir = options.appDir ?? APP_DIR;
    this.engines = options.engines ?? [
      new BunAuditEngine(),
      new OsvPypiEngine({
        uvPath: () => Bun.which("uv", { PATH: this.runtimePath() }),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
      })
    ];
  }

  private runtimePath(): string {
    return getSetting(this.options.db, "runtime_path");
  }

  private actions() {
    return parseActionMap(getSetting(this.options.db, "audit_actions"));
  }

  isEnabled(): boolean {
    return getSetting(this.options.db, "audit_enabled") === "true";
  }

  private intervalMs(): number {
    if (this.options.intervalMs) return this.options.intervalMs;
    const hours = Number(getSetting(this.options.db, "audit_interval_hours"));
    return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 86_400_000;
  }

  nextRunAt(): number | null {
    if (!this.isEnabled()) return null;
    const last = this.store.lastRun();
    if (!last) return this.startedAt + (this.options.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS);
    return (last.finishedAt ?? last.startedAt) + this.intervalMs();
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), this.options.tickMs ?? DEFAULT_TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cancelPending();
    this.controller.abort();
  }

  cancelPending(): void {
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      job?.reject(new Error("audit cancelled"));
    }
  }

  private tick(): void {
    if (this.stopped || !this.isEnabled() || this.running) return;
    const next = this.nextRunAt();
    if (next === null || Date.now() < next) return;
    void this.runAll("periodic").catch(() => undefined);
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  current(): AuditRunSummary | null {
    return this.running ? this.currentSummary : null;
  }

  lastRun(): AuditRunSummary | null {
    return this.store.lastRun();
  }

  private serverRows(): ServerRow[] {
    return this.options.db.select().from(servers).all();
  }

  private findRow(serverId: string): ServerRow | null {
    return this.options.db.select().from(servers).where(eq(servers.id, serverId)).get() ?? null;
  }

  runAll(trigger: AuditTrigger): Promise<AuditRunSummary> {
    if (this.running) return this.running;
    const rows = this.serverRows();
    const summary = emptySummary(trigger, rows.length + 1);
    this.currentSummary = summary;
    const run = (async () => {
      this.stats.runs += 1;
      this.options.logger.info("audit run started", { trigger, servers: rows.length });
      for (const id of [...rows.map((row) => row.id), SELF_ID]) {
        if (this.stopped) break;
        try {
          const result = await this.runServer(id, trigger);
          summary.done += 1;
          if (result.status === "ok") summary.ok += 1;
          if (result.status === "vulnerable") summary.vulnerable += 1;
          if (result.status === "error") summary.errors += 1;
          if (result.status === "unsupported") summary.unsupported += 1;
        } catch (error) {
          summary.done += 1;
          summary.errors += 1;
          this.options.logger.warn("audit job failed", { server: id, error: String(error) });
        }
      }
      const rowsAfter = this.serverRows();
      summary.quarantined = rowsAfter.filter((row) => row.quarantinedAt !== null).length;
      summary.disabled = rowsAfter.filter((row) => row.disabledReason !== null).length;
      summary.finishedAt = Date.now();
      this.store.saveLastRun(summary);
      this.options.logger.info("audit run finished", {
        trigger,
        vulnerable: summary.vulnerable,
        errors: summary.errors,
        quarantined: summary.quarantined
      });
      return summary;
    })();
    this.running = run.finally(() => {
      this.running = null;
    }) as Promise<AuditRunSummary>;
    return this.running;
  }

  runServer(serverId: string, trigger: AuditTrigger): Promise<AuditResultRow> {
    return new Promise<AuditResultRow>((resolve, reject) => {
      this.queue.push({ serverId, trigger, resolve, reject });
      this.drain();
    });
  }

  enqueue(serverId: string, trigger: AuditTrigger): void {
    if (!this.isEnabled() || this.stopped) return;
    if (this.queue.some((job) => job.serverId === serverId)) return;
    void this.runServer(serverId, trigger).catch((error: unknown) => {
      this.options.logger.debug("queued audit failed", { server: serverId, error: String(error) });
    });
  }

  private drain(): void {
    if (this.worker) return;
    this.worker = (async () => {
      for (;;) {
        const job = this.queue.shift();
        if (!job) break;
        try {
          job.resolve(await this.execute(job.serverId, job.trigger));
        } catch (error) {
          job.reject(error);
        }
      }
    })().finally(() => {
      this.worker = null;
      if (this.queue.length > 0) this.drain();
    });
  }

  private engineFor(kind: AuditTarget["kind"]): AuditEngine | null {
    return this.engines.find((engine) => engine.kinds.includes(kind)) ?? null;
  }

  private targetFor(row: ServerRow): AuditTarget | Unsupported {
    if (this.options.targetFor) return this.options.targetFor(row);
    return auditTarget(row);
  }

  private async execute(serverId: string, trigger: AuditTrigger): Promise<AuditResultRow> {
    const isSelf = serverId === SELF_ID;
    const row = isSelf ? null : this.findRow(serverId);
    if (!isSelf && !row) throw new Error(`server ${serverId} does not exist`);

    const target = isSelf ? selfTarget(this.appDir) : this.targetFor(row!);
    const ecosystem: AuditEcosystem | null = target.kind === "unsupported" ? null : ECOSYSTEM_BY_KIND[target.kind];
    const values = target.kind === "unsupported" ? [] : targetValues(target);

    if (target.kind === "unsupported") {
      this.store.save({
        serverId,
        status: "unsupported",
        ecosystem,
        target: values,
        resolved: [],
        findings: [],
        engine: null,
        error: null,
        reason: target.reason,
        trigger,
        durationMs: null
      });
      return this.store.get(serverId)!;
    }

    const engine = this.engineFor(target.kind);
    const startedAt = Date.now();
    if (!engine) {
      this.store.save({
        serverId,
        status: "unsupported",
        ecosystem,
        target: values,
        resolved: [],
        findings: [],
        engine: null,
        error: null,
        reason: `no audit engine for ${target.kind}`,
        trigger,
        durationMs: null
      });
      return this.store.get(serverId)!;
    }

    const timeout = AbortSignal.timeout(this.options.serverTimeoutMs ?? DEFAULT_SERVER_TIMEOUT_MS);
    const ctx = {
      signal: AbortSignal.any([this.controller.signal, timeout]),
      env: buildChildEnv({ env: {}, path: this.runtimePath(), home: Bun.env.HOME ?? tempRoot() }),
      logger: this.options.logger,
      fetchImpl: this.options.fetchImpl ?? fetch,
      tmpRoot: tempRoot()
    };
    ctx.env.NO_COLOR = "1";

    try {
      const result = await engine.audit(target, ctx);
      this.stats.audited += 1;
      const ignores = isSelf ? new Set<string>() : this.store.ignoreSet(serverId);
      const decision = decide(result.findings, ignores, this.actions());
      const status: AuditStatus = decision.active.length > 0 ? "vulnerable" : "ok";
      this.store.save({
        serverId,
        status,
        ecosystem,
        target: values,
        resolved: result.resolved,
        findings: result.findings as StoredFinding[],
        engine: result.engine,
        error: null,
        reason: decision.reason,
        trigger,
        durationMs: Date.now() - startedAt
      });
      if (!isSelf && row) await this.apply(row, status, decision);
      else if (isSelf && decision.active.length > 0) {
        this.options.logger.warn("gateway dependencies have advisories", { detail: decision.reason });
      }
    } catch (error) {
      this.stats.errors += 1;
      const message = timeout.aborted
        ? `audit timed out after ${Math.round((this.options.serverTimeoutMs ?? DEFAULT_SERVER_TIMEOUT_MS) / 1000)}s`
        : error instanceof Error
          ? error.message
          : String(error);
      this.options.logger.warn("audit failed", { server: serverId, error: message });
      this.store.save({
        serverId,
        status: "error",
        ecosystem,
        target: values,
        resolved: [],
        findings: [],
        engine: null,
        error: message,
        reason: null,
        trigger,
        durationMs: Date.now() - startedAt
      });
    }
    return this.store.get(serverId)!;
  }

  private async apply(row: ServerRow, status: AuditStatus, decision: Decision): Promise<void> {
    const action = decision.action;
    const reason = decision.reason ?? "vulnerable package";
    if (action === "disable") {
      if (row.enabled) {
        this.store.setDisabledByAudit(row.id, reason);
        this.options.registry.invalidate(row.id);
        await this.options.stopInstance(row.id, "disabled by audit");
        this.options.logs.append(row.id, "system", `disabled by audit: ${reason}`);
        this.options.logger.warn("server disabled by audit", { server: row.id, detail: reason });
        this.stats.disables += 1;
      }
      return;
    }
    if (action === "quarantine") {
      if (row.quarantinedAt === null) {
        this.store.setQuarantine(row.id, reason);
        this.options.registry.invalidate(row.id);
        await this.options.stopInstance(row.id, "quarantined by audit");
        this.options.logs.append(row.id, "system", `quarantined by audit: ${reason}`);
        this.options.logger.warn("server quarantined by audit", { server: row.id, detail: reason });
        this.stats.quarantines += 1;
      }
      return;
    }
    if (action === "report") {
      this.options.logger.warn("vulnerable packages reported", { server: row.id, detail: reason });
    }
    if (shouldLift(row.quarantinedAt !== null, status, decision)) await this.liftQuarantine(row.id, "audit");
  }

  async liftQuarantine(serverId: string, by: "admin" | "audit"): Promise<boolean> {
    const row = this.findRow(serverId);
    if (!row || row.quarantinedAt === null) return false;
    this.store.setQuarantine(serverId, null);
    this.options.registry.invalidate(serverId);
    this.options.logs.append(serverId, "system", `quarantine lifted by ${by}`);
    this.options.logger.info("quarantine lifted", { server: serverId, by });
    this.stats.lifts += 1;
    return true;
  }

  async reevaluate(serverId: string): Promise<void> {
    const row = this.findRow(serverId);
    const stored = this.store.get(serverId);
    if (!row || !stored) return;
    if (stored.status !== "ok" && stored.status !== "vulnerable") return;
    const decision = decide(stored.findings, this.store.ignoreSet(serverId), this.actions());
    const status: AuditStatus = decision.active.length > 0 ? "vulnerable" : "ok";
    this.store.save({
      serverId,
      status,
      ecosystem: stored.ecosystem,
      target: stored.target,
      resolved: stored.resolved,
      findings: stored.findings,
      engine: stored.engine,
      error: null,
      reason: decision.reason,
      trigger: stored.trigger,
      durationMs: stored.durationMs
    });
    await this.apply(this.findRow(serverId)!, status, decision);
  }

  async reevaluateAll(): Promise<void> {
    for (const row of this.serverRows()) await this.reevaluate(row.id);
  }

  onServerDeleted(serverId: string): void {
    this.store.delete(serverId);
  }

  private summaryFrom(row: AuditResultRow | null, ignores: Set<string>): AuditSummaryDto | null {
    if (!row) return null;
    const decision = decide(row.findings, ignores, this.actions());
    return {
      status: row.status,
      ecosystem: row.ecosystem,
      counts: row.status === "vulnerable" || row.status === "ok" ? decision.counts : emptyCounts(),
      activeCount: decision.active.length,
      ignoredCount: decision.ignored.length,
      worst: decision.worst,
      action: decision.action,
      checkedAt: row.checkedAt,
      error: row.error,
      reason: row.reason
    };
  }

  summary(serverId: string): AuditSummaryDto | null {
    const row = this.store.get(serverId);
    if (!row) return null;
    const ignores = serverId === SELF_ID ? new Set<string>() : this.store.ignoreSet(serverId);
    return this.summaryFrom(row, ignores);
  }

  report(serverId: string): AuditReportDto | null {
    const isSelf = serverId === SELF_ID;
    const row = isSelf ? null : this.findRow(serverId);
    if (!isSelf && !row) return null;
    const name = isSelf ? "Junctio" : (row?.name ?? serverId);
    const stored = this.store.get(serverId);
    const ignores = isSelf ? new Set<string>() : this.store.ignoreSet(serverId);
    const summary = this.summaryFrom(stored, ignores);
    const pending = (): AuditSummaryDto => {
      const target = isSelf ? selfTarget(this.appDir) : this.targetFor(row!);
      const unsupported = target.kind === "unsupported";
      return {
        status: unsupported ? "unsupported" : "pending",
        ecosystem: unsupported ? null : ECOSYSTEM_BY_KIND[target.kind],
        counts: emptyCounts(),
        activeCount: 0,
        ignoredCount: 0,
        worst: null,
        action: null,
        checkedAt: null,
        error: null,
        reason: unsupported ? target.reason : null
      };
    };
    const base = summary ?? pending();
    const findings: AuditFinding[] = stored?.findings ?? [];
    const decision = decide(findings, ignores, this.actions());
    const ignoredKeys = new Set(decision.ignored.map((finding) => `${finding.package}:${finding.id}`));
    return {
      ...base,
      id: serverId,
      name,
      target: stored?.target ?? [],
      resolved: stored?.resolved ?? [],
      engine: stored?.engine ?? null,
      trigger: stored?.trigger ?? null,
      durationMs: stored?.durationMs ?? null,
      quarantined: row?.quarantinedAt !== null && row?.quarantinedAt !== undefined,
      quarantineReason: row?.quarantineReason ?? null,
      findings: findings.map((finding) => ({ ...finding, ignored: ignoredKeys.has(`${finding.package}:${finding.id}`) })),
      ignores: (isSelf ? [] : this.store.ignores(serverId)).map((ignore) => ({
        advisoryId: ignore.advisoryId,
        reason: ignore.reason,
        createdAt: ignore.createdAt
      }))
    };
  }

  overview(): AuditOverviewDto {
    const rows = this.serverRows();
    const results = new Map(this.store.all().map((row) => [row.serverId, row]));
    return {
      enabled: this.isEnabled(),
      running: this.isRunning(),
      current: this.current(),
      lastRun: this.lastRun(),
      nextRunAt: this.nextRunAt(),
      self: this.summaryFrom(results.get(SELF_ID) ?? null, new Set()),
      servers: rows.map((row) => {
        const summary = this.summaryFrom(results.get(row.id) ?? null, this.store.ignoreSet(row.id));
        const fallback: AuditSummaryDto = {
          status: "pending",
          ecosystem: null,
          counts: emptyCounts(),
          activeCount: 0,
          ignoredCount: 0,
          worst: null,
          action: null,
          checkedAt: null,
          error: null,
          reason: null
        };
        return {
          ...(summary ?? fallback),
          serverId: row.id,
          serverName: row.name,
          quarantined: row.quarantinedAt !== null
        };
      })
    };
  }

  sweepTemp(): number {
    return sweepTempDirs(tempRoot());
  }
}
