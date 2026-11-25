import type { Subprocess } from "bun";
import type { Catalog } from "./catalog.ts";
import type { ChildMessage, RunMessage, SandboxFailure, SandboxMode } from "./protocol.ts";

const CHILD = new URL("./sandbox-child.ts", import.meta.url).pathname;
const STDERR_LIMIT = 4_000;

export type SandboxLimits = {
  timeoutMs: number;
  memoryBytes: number;
  stackBytes: number;
  maxCalls: number;
  maxConcurrentCalls: number;
  logLines: number;
  logChars: number;
};

export const DEFAULT_LIMITS: SandboxLimits = {
  timeoutMs: 120_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  maxCalls: 100,
  maxConcurrentCalls: 8,
  logLines: 200,
  logChars: 8_000
};

export const SEARCH_TIMEOUT_MS = 10_000;

export type CallContext = { signal: AbortSignal; deadline: number };

export const CALL_GRACE_MS = 1_000;

export type SandboxCall = { name: string; ok: boolean };

export type SandboxRequest = {
  mode: SandboxMode;
  code: string;
  catalog: Catalog;
  call?: (name: string, input: unknown, context: CallContext) => Promise<unknown>;
  signal?: AbortSignal;
  limits?: Partial<SandboxLimits>;
};

export type SandboxFailureKind = "code" | "timeout" | "cancelled" | "crashed" | "busy";

type Settled =
  | { ok: true; value: unknown; logs: string[]; calls: SandboxCall[] }
  | { ok: false; kind: SandboxFailureKind; error: SandboxFailure; logs: string[]; calls: SandboxCall[] };

export type SandboxOutcome = Settled & { durationMs: number };

class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }

  get queued(): number {
    return this.waiting.length;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name !== "" ? error.name : "Error";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type SandboxOptions = { maxRuns?: number; maxQueued?: number; limits?: Partial<SandboxLimits> };

export class Sandbox {
  private readonly runs: Gate;
  private readonly maxQueued: number;
  private readonly limits: SandboxLimits;
  private readonly active = new Set<() => void>();
  private closed = false;

  constructor(options: SandboxOptions = {}) {
    this.runs = new Gate(options.maxRuns ?? 8);
    this.maxQueued = options.maxQueued ?? 32;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
  }

  get defaults(): SandboxLimits {
    return this.limits;
  }

  close(): void {
    this.closed = true;
    for (const stop of [...this.active]) stop();
  }

  async run(request: SandboxRequest): Promise<SandboxOutcome> {
    const started = Date.now();
    if (this.closed || this.runs.queued >= this.maxQueued) {
      return {
        ok: false,
        kind: "busy",
        error: { name: "BusyError", message: "the gateway is running too much code right now, retry shortly" },
        logs: [],
        calls: [],
        durationMs: 0
      };
    }
    const release = await this.runs.acquire();
    if (this.closed) {
      release();
      return {
        ok: false,
        kind: "busy",
        error: { name: "BusyError", message: "the gateway is shutting down" },
        logs: [],
        calls: [],
        durationMs: Date.now() - started
      };
    }
    try {
      const outcome = await this.spawn(request);
      return { ...outcome, durationMs: Date.now() - started };
    } finally {
      release();
    }
  }

  private spawn(request: SandboxRequest): Promise<Settled> {
    const limits = { ...this.limits, ...request.limits };
    const deadline = Date.now() + limits.timeoutMs;
    const logs: string[] = [];
    const calls: SandboxCall[] = [];
    const abort = new AbortController();
    const callGate = new Gate(limits.maxConcurrentCalls);
    let stderr = "";
    let settled = false;
    let child: Subprocess<"ignore", "ignore", "pipe"> | null = null;

    return new Promise((resolve) => {
      const settle = (outcome: Settled) => {
        if (settled) return;
        settled = true;
        this.active.delete(onAbort);
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        abort.abort();
        child?.kill("SIGKILL");
        resolve(outcome);
      };
      const fail = (kind: SandboxFailureKind, error: SandboxFailure) => settle({ ok: false, kind, error, logs, calls });

      const timer = setTimeout(
        () =>
          fail("timeout", {
            name: "TimeoutError",
            message: `the code did not finish within ${Math.round(limits.timeoutMs / 1000)} s`
          }),
        limits.timeoutMs
      );
      const onAbort = () => fail("cancelled", { name: "AbortError", message: "the request was cancelled" });
      if (request.signal?.aborted) {
        onAbort();
        return;
      }
      request.signal?.addEventListener("abort", onAbort, { once: true });
      this.active.add(onAbort);

      const runCall = async (id: number, name: string, input: string) => {
        const respond = (message: Parameters<Subprocess["send"]>[0]) => {
          if (!settled) child?.send(message);
        };
        if (!request.call) {
          respond({ type: "result", id, ok: false, name: "TypeError", error: "tools are not available in search" });
          return;
        }
        if (calls.length >= limits.maxCalls) {
          respond({
            type: "result",
            id,
            ok: false,
            name: "LimitError",
            error: `a run may call at most ${limits.maxCalls} tools`
          });
          return;
        }
        const record: SandboxCall = { name, ok: false };
        calls.push(record);
        const releaseCall = await callGate.acquire();
        try {
          if (settled) return;
          const value = await request.call(name, JSON.parse(input), { signal: abort.signal, deadline });
          record.ok = true;
          respond({ type: "result", id, ok: true, value: JSON.stringify(value ?? null) });
        } catch (error) {
          respond({ type: "result", id, ok: false, name: errorName(error), error: errorText(error) });
        } finally {
          releaseCall();
        }
      };

      const onMessage = (message: ChildMessage) => {
        if (settled) return;
        switch (message.type) {
          case "ready": {
            const run: RunMessage = {
              type: "run",
              mode: request.mode,
              code: request.code,
              catalog: JSON.stringify(request.catalog),
              deadline,
              memoryBytes: limits.memoryBytes,
              stackBytes: limits.stackBytes,
              logLines: limits.logLines,
              logChars: limits.logChars
            };
            child?.send(run);
            return;
          }
          case "log":
            if (logs.length <= limits.logLines) logs.push(message.line);
            return;
          case "call":
            void runCall(message.id, message.name, message.input);
            return;
          case "done":
            if (message.ok) {
              settle({ ok: true, value: JSON.parse(message.value), logs, calls });
              return;
            }
            if (classify(message.error, deadline) === "timeout") {
              fail("timeout", {
                name: "TimeoutError",
                message: `the code did not finish within ${Math.round(limits.timeoutMs / 1000)} s`
              });
              return;
            }
            fail("code", message.error);
            return;
        }
      };

      try {
        child = Bun.spawn([process.execPath, "--smol", CHILD], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
          env: { ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) },
          ipc: (message) => onMessage(message as ChildMessage),
          serialization: "json"
        });
      } catch (error) {
        fail("crashed", { name: "SandboxError", message: `the sandbox could not start: ${errorText(error)}` });
        return;
      }

      void (async () => {
        const reader = child.stderr.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
          if (chunk.done) break;
          if (stderr.length < STDERR_LIMIT) stderr += decoder.decode(chunk.value, { stream: true });
        }
      })();

      void child.exited.then((code) => {
        if (settled) return;
        const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        const memory = /out of memory|memory/i.test(detail);
        fail("crashed", {
          name: memory ? "MemoryError" : "SandboxError",
          message: memory
            ? "the code ran out of memory"
            : `the sandbox exited unexpectedly (code ${code})${detail ? `: ${detail}` : ""}`
        });
      });
    });
  }
}

function classify(error: SandboxFailure, deadline: number): SandboxFailureKind {
  if (error.name === "InternalError" && error.message === "interrupted" && Date.now() >= deadline - 50) {
    return "timeout";
  }
  return "code";
}
