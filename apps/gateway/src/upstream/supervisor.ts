import type { Logger } from "../log.ts";
import { ChildProcessTransport } from "./stdio.ts";
import type { LogRegistry } from "./logbuffer.ts";
import type { Handle, Launch, Launcher } from "./launch.ts";
import { spawnProcess } from "./process.ts";

export type ProcessState = "stopped" | "starting" | "running" | "idle" | "failed";

export type SpawnSpec = {
  launch: Launch;
  idleTimeoutSec: number;
  warm: boolean;
};

export type ProcessInfo = {
  state: ProcessState;
  pid: number | null;
  containerId: string | null;
  restarts: number;
  consecutiveFailures: number;
  lastError: string | null;
  generation: number;
};

export type AcquireResult = {
  transport: ChildProcessTransport;
  generation: number;
};

export type SupervisorOptions = {
  getSpec: (serverId: string) => SpawnSpec | null;
  logs: LogRegistry;
  logger: Logger;
  launcher?: Launcher;
  onExit?: (serverId: string, generation: number) => void;
  maxConsecutiveFailures?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  stopGraceMs?: number;
  idleCheckMs?: number;
};

const HEALTHY_AFTER_MS = 5_000;
const HINT = "check the arguments the runtime received and that TMPDIR allows execution";

const MAX_REASON = 200;

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const ERROR_LINE = /\b(error|fatal|exception|traceback|panic)\b/i;

function explain(silent: boolean, managed: Managed): string {
  if (silent) return ` without writing anything; ${HINT}`;
  const line = (managed.errorLine ?? managed.lastLine)?.trim();
  if (!line) return "";
  const reason = line.length > MAX_REASON ? `${line.slice(0, MAX_REASON)}…` : line;
  return managed.errorLine ? `: ${reason}` : `, last output: ${reason}`;
}

function remember(managed: Managed, line: string): void {
  managed.output += 1;
  managed.lastLine = line;
  if (!managed.errorLine && ERROR_LINE.test(line)) managed.errorLine = line;
}

type Managed = {
  serverId: string;
  handle: Handle;
  transport: ChildProcessTransport;
  generation: number;
  startedAt: number;
  lastActivity: number;
  idleTimeoutSec: number;
  stopping: boolean;
  output: number;
  lastLine: string | null;
  errorLine: string | null;
  exited: Promise<void>;
};

async function defaultLauncher(launch: Launch, log: (line: string) => void): Promise<Handle> {
  if (launch.kind === "process") return spawnProcess(launch, log);
  throw new Error("this gateway was built without a container launcher");
}

export class ProcessSupervisor {
  private readonly running = new Map<string, Managed>();
  private readonly starting = new Map<string, Promise<AcquireResult>>();
  private readonly info = new Map<string, ProcessInfo>();
  private readonly backoffUntil = new Map<string, number>();
  private generationSeq = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;

  private readonly maxConsecutiveFailures: number;
  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  private readonly stopGraceMs: number;
  private readonly launcher: Launcher;

  constructor(private readonly options: SupervisorOptions) {
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 10;
    this.backoffBaseMs = options.backoffBaseMs ?? 1_000;
    this.backoffCapMs = options.backoffCapMs ?? 60_000;
    this.stopGraceMs = options.stopGraceMs ?? 5_000;
    this.launcher = options.launcher ?? defaultLauncher;
    const interval = options.idleCheckMs ?? 30_000;
    if (interval > 0) {
      this.idleTimer = setInterval(() => void this.sweepIdle(), interval);
      this.idleTimer.unref?.();
    }
  }

  getInfo(serverId: string): ProcessInfo {
    const current = this.info.get(serverId);
    if (current) return { ...current };
    return {
      state: "stopped",
      pid: null,
      containerId: null,
      restarts: 0,
      consecutiveFailures: 0,
      lastError: null,
      generation: 0
    };
  }

  private patchInfo(serverId: string, patch: Partial<ProcessInfo>): void {
    const current = this.getInfo(serverId);
    this.info.set(serverId, { ...current, ...patch });
  }

  reset(serverId: string): void {
    this.backoffUntil.delete(serverId);
    this.patchInfo(serverId, { state: "stopped", consecutiveFailures: 0, lastError: null });
  }

  touch(serverId: string): void {
    const managed = this.running.get(serverId);
    if (managed) managed.lastActivity = Date.now();
  }

  isRunning(serverId: string): boolean {
    return this.running.has(serverId);
  }

  async acquire(serverId: string): Promise<AcquireResult> {
    if (this.shuttingDown) throw new Error("gateway is shutting down");
    const managed = this.running.get(serverId);
    if (managed && !managed.stopping) {
      managed.lastActivity = Date.now();
      return { transport: managed.transport, generation: managed.generation };
    }
    const pending = this.starting.get(serverId);
    if (pending) return pending;

    const info = this.getInfo(serverId);
    if (info.state === "failed") {
      throw new Error(`server is in failed state: ${info.lastError ?? "unknown error"}`);
    }
    const until = this.backoffUntil.get(serverId) ?? 0;
    if (Date.now() < until) {
      const waitMs = until - Date.now();
      throw new Error(`server is backing off after a crash, retry in ${waitMs}ms`);
    }

    const promise = this.spawn(serverId).finally(() => this.starting.delete(serverId));
    this.starting.set(serverId, promise);
    return promise;
  }

  private readSpec(serverId: string): SpawnSpec {
    let spec: SpawnSpec | null;
    try {
      spec = this.options.getSpec(serverId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logs.append(serverId, "system", message);
      this.recordFailure(serverId, message);
      throw new Error(message);
    }
    if (!spec) throw new Error("server is not configured for stdio");
    return spec;
  }

  private async spawn(serverId: string): Promise<AcquireResult> {
    const spec = this.readSpec(serverId);

    this.patchInfo(serverId, { state: "starting", lastError: null });
    const generation = ++this.generationSeq;
    const logger = this.options.logger.child({ server: serverId });
    const log = (line: string) => this.options.logs.append(serverId, "system", line);

    let handle: Handle;
    try {
      handle = await this.launcher(spec.launch, log);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logs.append(serverId, "system", message);
      this.recordFailure(serverId, message);
      throw new Error(message);
    }

    logger.info("upstream started", { pid: handle.pid, container: handle.containerId, describe: handle.describe });

    const transport = new ChildProcessTransport({
      stdin: handle.stdin,
      stdout: handle.stdout,
      onUnparsed: (line) => {
        remember(managed, line);
        this.options.logs.append(serverId, "stdout", line);
        logger.debug("upstream wrote a non-protocol line", { line });
      }
    });
    const managed: Managed = {
      serverId,
      handle,
      transport,
      generation,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      idleTimeoutSec: spec.idleTimeoutSec,
      stopping: false,
      output: 0,
      lastLine: null,
      errorLine: null,
      exited: Promise.resolve()
    };

    void this.pipeStderr(managed, handle.stderr);
    managed.exited = this.watchExit(managed, spec);
    this.running.set(serverId, managed);
    this.patchInfo(serverId, {
      state: "running",
      pid: handle.pid,
      containerId: handle.containerId,
      generation
    });
    return { transport, generation };
  }

  private async pipeStderr(managed: Managed, stream: ReadableStream<Uint8Array>): Promise<void> {
    const serverId = managed.serverId;
    const decoder = new TextDecoder();
    let rest = "";
    const logger = this.options.logger.child({ server: serverId });
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += decoder.decode(value, { stream: true });
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() === "") continue;
          remember(managed, line);
          this.options.logs.append(serverId, "stderr", line);
          logger.debug("upstream stderr", { line });
        }
      }
    } catch {
      return;
    } finally {
      reader.releaseLock();
    }
    if (rest.trim() !== "") {
      remember(managed, rest.trim());
      this.options.logs.append(serverId, "stderr", rest);
    }
  }

  private async watchExit(managed: Managed, spec: SpawnSpec): Promise<void> {
    const { serverId, handle, generation } = managed;
    const { code, signal } = await handle.exited;
    if (this.running.get(serverId) === managed) this.running.delete(serverId);
    await managed.transport.close();
    const logger = this.options.logger.child({ server: serverId });
    const lived = Date.now() - managed.startedAt;
    const detail = `${signal ? `signal ${signal}` : `code ${code}`} after ${formatDuration(lived)}`;
    const silent = managed.output === 0 && !managed.stopping && !this.shuttingDown;
    this.options.logs.append(
      serverId,
      "system",
      silent ? `exited with ${detail} without writing anything; ${HINT}` : `exited with ${detail}`
    );

    if (managed.stopping || this.shuttingDown) {
      logger.info("upstream stopped", { detail });
      if (!this.shuttingDown && this.getInfo(serverId).state !== "idle") {
        this.patchInfo(serverId, { state: "stopped", pid: null, containerId: null });
      }
      this.options.onExit?.(serverId, generation);
      return;
    }

    logger.warn("upstream exited unexpectedly", { detail });
    if (lived >= HEALTHY_AFTER_MS) this.patchInfo(serverId, { consecutiveFailures: 0 });
    this.recordFailure(serverId, `process exited with ${detail}${explain(silent, managed)}`);
    this.options.onExit?.(serverId, generation);

    const info = this.getInfo(serverId);
    if (spec.warm && info.state !== "failed" && !this.shuttingDown) {
      const delay = Math.max(0, (this.backoffUntil.get(serverId) ?? 0) - Date.now());
      const timer = setTimeout(() => {
        if (this.shuttingDown) return;
        this.acquire(serverId).catch((error: unknown) => {
          logger.warn("warm restart failed", { error: String(error) });
        });
      }, delay);
      timer.unref?.();
    }
  }

  private recordFailure(serverId: string, message: string): void {
    const info = this.getInfo(serverId);
    const failures = info.consecutiveFailures + 1;
    const failed = failures >= this.maxConsecutiveFailures;
    this.patchInfo(serverId, {
      state: failed ? "failed" : "stopped",
      pid: null,
      containerId: null,
      restarts: info.restarts + 1,
      consecutiveFailures: failures,
      lastError: message
    });
    if (failed) {
      this.backoffUntil.delete(serverId);
      this.options.logs.append(serverId, "system", `giving up after ${failures} consecutive failures`);
      return;
    }
    const delay = Math.min(this.backoffCapMs, this.backoffBaseMs * 2 ** (failures - 1));
    this.backoffUntil.set(serverId, Date.now() + delay);
  }

  private async halt(managed: Managed): Promise<void> {
    managed.handle.terminate(this.stopGraceMs);
    const timer = setTimeout(() => managed.handle.kill(), this.stopGraceMs);
    timer.unref?.();
    try {
      await managed.exited;
    } finally {
      clearTimeout(timer);
      managed.handle.dispose();
    }
  }

  async stop(serverId: string, state: ProcessState = "stopped"): Promise<void> {
    const pending = this.starting.get(serverId);
    if (pending) await pending.catch(() => undefined);
    const managed = this.running.get(serverId);
    if (!managed) {
      if (this.getInfo(serverId).state !== "failed") {
        this.patchInfo(serverId, { state, pid: null, containerId: null });
      }
      return;
    }
    managed.stopping = true;
    this.running.delete(serverId);
    this.patchInfo(serverId, { state, pid: null, containerId: null });
    await this.halt(managed);
  }

  async restart(serverId: string): Promise<void> {
    await this.stop(serverId);
    this.reset(serverId);
    await this.acquire(serverId);
  }

  private async sweepIdle(): Promise<void> {
    const now = Date.now();
    for (const managed of [...this.running.values()]) {
      if (managed.idleTimeoutSec <= 0 || managed.stopping) continue;
      if (now - managed.lastActivity < managed.idleTimeoutSec * 1000) continue;
      this.options.logs.append(managed.serverId, "system", "stopped after idle timeout");
      await this.stop(managed.serverId, "idle");
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    const pending = [...this.starting.values()];
    await Promise.allSettled(pending);
    const all = [...this.running.values()];
    await Promise.allSettled(
      all.map(async (managed) => {
        managed.stopping = true;
        this.running.delete(managed.serverId);
        await this.halt(managed);
      })
    );
  }
}
