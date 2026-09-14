import { afterEach, describe, expect, test } from "bun:test";
import { ProcessSupervisor, type SpawnSpec } from "../../src/upstream/supervisor.ts";
import { LogRegistry } from "../../src/upstream/logbuffer.ts";
import { createLogger, setLogLevel } from "../../src/log.ts";

setLogLevel("error");

const FIXTURE = new URL("../fixtures/mock-stdio-server.ts", import.meta.url).pathname;

function makeSupervisor(spec: Partial<SpawnSpec> & { env?: Record<string, string> } = {}) {
  const full: SpawnSpec = {
    argv: ["bun", FIXTURE],
    cwd: null,
    env: { PATH: Bun.env.PATH ?? "/usr/bin", HOME: Bun.env.HOME ?? "/tmp", ...(spec.env ?? {}) },
    idleTimeoutSec: spec.idleTimeoutSec ?? 0,
    warm: spec.warm ?? false,
    ...(spec.argv ? { argv: spec.argv } : {})
  };
  const logs = new LogRegistry();
  const supervisor = new ProcessSupervisor({
    getSpec: () => full,
    logs,
    logger: createLogger(),
    backoffBaseMs: 10,
    backoffCapMs: 40,
    stopGraceMs: 200,
    idleCheckMs: 50
  });
  return { supervisor, logs };
}

function zombieCount(): number {
  const out = Bun.spawnSync(["ps", "-o", "pid=,ppid=,stat=", "-A"]).stdout.toString();
  const pid = String(process.pid);
  return out
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === pid && (parts[2] ?? "").startsWith("Z")).length;
}

function childCount(): number {
  const out = Bun.spawnSync(["ps", "-o", "pid=,ppid=", "-A"]).stdout.toString();
  const pid = String(process.pid);
  return out
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === pid).length;
}

let active: ProcessSupervisor | null = null;

afterEach(async () => {
  if (active) await active.shutdown();
  active = null;
});

describe("ProcessSupervisor", () => {
  test("starts lazily and reuses the process", async () => {
    const { supervisor } = makeSupervisor();
    active = supervisor;
    const first = await supervisor.acquire("s1");
    const second = await supervisor.acquire("s1");
    expect(second.generation).toBe(first.generation);
    expect(supervisor.getInfo("s1").state).toBe("running");
    expect(supervisor.getInfo("s1").pid).toBeGreaterThan(0);
  });

  test("50 restart cycles leave no zombies", async () => {
    const { supervisor } = makeSupervisor();
    active = supervisor;
    const baselineChildren = childCount();
    for (let i = 0; i < 50; i++) {
      await supervisor.acquire("s1");
      await supervisor.stop("s1");
    }
    expect(supervisor.isRunning("s1")).toBe(false);
    expect(zombieCount()).toBe(0);
    expect(childCount()).toBeLessThanOrEqual(baselineChildren);
  }, 60_000);

  test("marks the server failed after repeated spawn failures", async () => {
    const { supervisor } = makeSupervisor({ env: { MOCK_EXIT_IMMEDIATELY: "1" } });
    active = supervisor;
    for (let i = 0; i < 40; i++) {
      try {
        const handle = await supervisor.acquire("s1");
        await handle.transport.close();
        await Bun.sleep(80);
      } catch {
        await Bun.sleep(80);
      }
      if (supervisor.getInfo("s1").state === "failed") break;
    }
    const info = supervisor.getInfo("s1");
    expect(info.state).toBe("failed");
    expect(info.consecutiveFailures).toBeGreaterThanOrEqual(10);
    await expect(supervisor.acquire("s1")).rejects.toThrow(/failed state/);
    supervisor.reset("s1");
    expect(supervisor.getInfo("s1").state).toBe("stopped");
  }, 30_000);

  test("says so when a process dies without writing anything", async () => {
    const { supervisor, logs } = makeSupervisor({ env: { MOCK_SILENT_EXIT: "1" } });
    active = supervisor;
    const handle = await supervisor.acquire("s1");
    await handle.transport.close();
    await Bun.sleep(200);
    const lines = logs.tail("s1").map((entry) => entry.line);
    expect(lines.some((line) => /exited with code 1 after \d+ms without writing anything/.test(line))).toBe(true);
    expect(supervisor.getInfo("s1").lastError).toContain("without writing anything");
  }, 15_000);

  test("keeps non-protocol stdout in the log", async () => {
    const { supervisor, logs } = makeSupervisor({ env: { MOCK_GARBAGE_STDOUT: "1" } });
    active = supervisor;
    const handle = await supervisor.acquire("s1");
    await handle.transport.start();
    await Bun.sleep(300);
    await handle.transport.close();
    const entry = logs.tail("s1").find((line) => line.stream === "stdout");
    expect(entry?.line).toBe("Usage: mock-server <package>");
    expect(supervisor.getInfo("s1").lastError).not.toContain("without writing anything");
  }, 15_000);

  test("stops the process after the idle timeout", async () => {
    const { supervisor } = makeSupervisor({ idleTimeoutSec: 1 });
    active = supervisor;
    await supervisor.acquire("s1");
    await Bun.sleep(1_400);
    expect(supervisor.isRunning("s1")).toBe(false);
    expect(supervisor.getInfo("s1").state).toBe("idle");
    const again = await supervisor.acquire("s1");
    expect(again.generation).toBeGreaterThan(0);
  }, 15_000);

  test("notifies on unexpected exit", async () => {
    const logs = new LogRegistry();
    const exits: number[] = [];
    const supervisor = new ProcessSupervisor({
      getSpec: () => ({
        argv: ["bun", FIXTURE],
        cwd: null,
        env: { PATH: Bun.env.PATH ?? "/usr/bin", HOME: Bun.env.HOME ?? "/tmp", MOCK_CRASH_AFTER_MS: "150" },
        idleTimeoutSec: 0,
        warm: false
      }),
      logs,
      logger: createLogger(),
      backoffBaseMs: 10,
      idleCheckMs: 0
    });
    active = supervisor;
    const handle = await supervisor.acquire("s1");
    await Bun.sleep(500);
    expect(supervisor.isRunning("s1")).toBe(false);
    expect(supervisor.getInfo("s1").lastError).toContain("exited");
    expect(handle.generation).toBeGreaterThan(0);
    expect(exits.length).toBe(0);
  }, 15_000);

  test("shutdown terminates every child", async () => {
    const { supervisor } = makeSupervisor();
    const baseline = childCount();
    await supervisor.acquire("a");
    await supervisor.shutdown();
    await Bun.sleep(100);
    expect(childCount()).toBeLessThanOrEqual(baseline);
    expect(zombieCount()).toBe(0);
  }, 15_000);
});
