import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { adminApi, connectClient, seedApiKey, seedEndpoint, seedNamespace, seedStdioServer, startHarness, withHarness, type Harness } from "../helpers.ts";
import { eq } from "drizzle-orm";
import { setSetting } from "../../src/db/settings.ts";
import { servers } from "../../src/db/schema.ts";
import { UpstreamError } from "../../src/upstream/types.ts";
import type { AuditEngine, AuditFinding, EngineResult } from "../../src/audit/types.ts";

class FakeEngine implements AuditEngine {
  readonly kinds = ["npm", "pypi", "node-project", "self"] as const;
  findings: AuditFinding[] = [];
  error: Error | null = null;
  delayMs = 0;
  calls = 0;

  async audit(): Promise<EngineResult> {
    this.calls += 1;
    if (this.delayMs > 0) await Bun.sleep(this.delayMs);
    if (this.error) throw this.error;
    return { findings: this.findings, resolved: ["pkg@1.0.0"], engine: "fake" };
  }
}

function finding(severity: AuditFinding["severity"], id?: string): AuditFinding {
  return {
    id: id ?? `GHSA-${severity.slice(0, 4).padEnd(4, "x")}-bbbb-cccc`.toUpperCase(),
    aliases: ["CVE-2024-99"],
    package: "pkg",
    version: "1.0.0",
    vulnerableRange: "<2",
    title: "a vulnerability",
    severity,
    cvss: 9.1,
    url: null
  };
}

let harness: Harness;
let engine: FakeEngine;

let api: (path: string, init?: RequestInit) => Promise<Response>;

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

beforeEach(async () => {
  engine = new FakeEngine();
  harness = await startHarness({
    audit: {
      engines: [engine],
      targetFor: () => ({ kind: "npm", specs: ["pkg@1.0.0"] }),
      tickMs: 50,
      intervalMs: 200,
      startupDelayMs: 0
    }
  });
  api = adminApi(() => harness);
  setSetting(harness.core.db, "audit_enabled", "true");
  await api("/v1/session/setup", { method: "POST", body: JSON.stringify({ password: "supersecret" }) });
});

afterEach(async () => {
  await harness.stop();
});

async function seedPublished(name = "mock") {
  const serverId = await seedStdioServer(harness.core, { name });
  await harness.core.audit.runServer(serverId, "manual");
  const namespaceId = seedNamespace(harness.core, `ns-${name}`, [{ serverId }]);
  const endpointId = seedEndpoint(harness.core, { slug: `ep-${name}`, namespaceId, authMode: "api_key" });
  const token = await seedApiKey(harness.core, endpointId);
  return { serverId, url: `${harness.url}/mcp/ep-${name}`, token };
}

describe("audit sanctions", () => {
  test("quarantines a server with a critical finding and refuses new connections", async () => {
    const { serverId, url, token } = await seedPublished();
    await harness.core.pool.acquire(serverId);
    expect(harness.core.supervisor.isRunning(serverId)).toBe(true);

    engine.findings = [finding("critical")];
    const result = await harness.core.audit.runServer(serverId, "manual");
    expect(result.status).toBe("vulnerable");

    expect(harness.core.supervisor.isRunning(serverId)).toBe(false);

    await expect(harness.core.pool.acquire(serverId)).rejects.toThrow(UpstreamError);
    const error = await harness.core.pool.acquire(serverId).catch((caught: unknown) => caught);
    expect((error as UpstreamError).code).toBe("quarantined");

    const client = await connectClient(url, token);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(0);
    await client.close();
  });

  test("reports a quarantined server through the api and health", async () => {
    const { serverId } = await seedPublished();
    engine.findings = [finding("critical")];
    await harness.core.audit.runServer(serverId, "manual");

    const detail = await body<{ status: string; quarantineReason: string | null; audit: { action: string } }>(
      await api(`/v1/servers/${serverId}`)
    );
    expect(detail.status).toBe("quarantined");
    expect(detail.quarantineReason).toContain("1 critical");
    expect(detail.audit.action).toBe("quarantine");

    const health = (await (await fetch(`${harness.url}/health`)).json()) as {
      status: string;
      servers: { quarantined: number };
      audit: { enabled: boolean; vulnerable: number };
    };
    expect(health.status).toBe("degraded");
    expect(health.servers.quarantined).toBe(1);
    expect(health.audit.enabled).toBe(true);
    expect(health.audit.vulnerable).toBe(1);
  });

  test("returns a tool error instead of a crash when a quarantined tool is called", async () => {
    const { serverId, url, token } = await seedPublished();
    const client = await connectClient(url, token);
    await client.listTools();
    engine.findings = [finding("critical")];
    await harness.core.audit.runServer(serverId, "manual");
    harness.core.pool.invalidateCatalog(serverId);

    const response = await client.callTool({ name: "mock__echo", arguments: { text: "hi" } });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.content)).toContain("quarantined");
    await client.close();
  });

  test("lifts the quarantine once a later audit comes back clean", async () => {
    const { serverId } = await seedPublished();
    engine.findings = [finding("critical")];
    await harness.core.audit.runServer(serverId, "manual");
    expect(harness.core.audit.report(serverId)?.quarantined).toBe(true);

    engine.findings = [];
    const result = await harness.core.audit.runServer(serverId, "manual");
    expect(result.status).toBe("ok");
    expect(harness.core.audit.report(serverId)?.quarantined).toBe(false);
    await harness.core.pool.acquire(serverId);
    expect(harness.core.supervisor.isRunning(serverId)).toBe(true);
  });

  test("lifts the quarantine when the advisory is ignored and restores it when the ignore goes away", async () => {
    const { serverId } = await seedPublished();
    engine.findings = [finding("critical")];
    await harness.core.audit.runServer(serverId, "manual");
    const advisoryId = engine.findings[0]!.id;

    const ignored = await api(`/v1/servers/${serverId}/audit/ignores/${advisoryId}`, {
      method: "PUT",
      body: JSON.stringify({ reason: "accepted risk" })
    });
    expect(ignored.status).toBe(200);
    const report = await body<{ status: string; quarantined: boolean; ignoredCount: number }>(ignored);
    expect(report.status).toBe("ok");
    expect(report.quarantined).toBe(false);
    expect(report.ignoredCount).toBe(1);

    const removed = await api(`/v1/servers/${serverId}/audit/ignores/${advisoryId}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect(harness.core.audit.report(serverId)?.quarantined).toBe(true);
  });

  test("lifts the quarantine on demand", async () => {
    const { serverId } = await seedPublished();
    engine.findings = [finding("critical")];
    await harness.core.audit.runServer(serverId, "manual");

    const response = await api(`/v1/servers/${serverId}/quarantine`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect((await body<{ status: string }>(response)).status).not.toBe("quarantined");
  });

  test("disables a server when the settings say so and keeps it down until the audit is clean", async () => {
    const { serverId } = await seedPublished();
    engine.findings = [finding("critical")];
    await api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ auditActions: { critical: "disable", high: "report", moderate: "report", low: "ignore" } })
    });
    await harness.core.audit.runServer(serverId, "manual");

    const disabled = await body<{ enabled: boolean; disabledReason: string | null }>(
      await api(`/v1/servers/${serverId}`)
    );
    expect(disabled.enabled).toBe(false);
    expect(disabled.disabledReason).toContain("critical");

    const refused = await api(`/v1/servers/${serverId}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    expect(refused.status).toBe(409);
    expect((await body<{ enabled: boolean }>(await api(`/v1/servers/${serverId}`))).enabled).toBe(false);

    engine.findings = [];
    await harness.core.audit.runServer(serverId, "manual");
    const reenabled = await body<{ enabled: boolean; disabledReason: string | null }>(
      await api(`/v1/servers/${serverId}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) })
    );
    expect(reenabled.enabled).toBe(true);
    expect(reenabled.disabledReason).toBeNull();
  });

  test("applies a changed action map to findings that are already stored", async () => {
    const { serverId } = await seedPublished();
    engine.findings = [finding("high")];
    await harness.core.audit.runServer(serverId, "manual");
    expect(harness.core.audit.report(serverId)?.quarantined).toBe(false);

    const callsBefore = engine.calls;
    await api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ auditActions: { critical: "quarantine", high: "quarantine", moderate: "report", low: "ignore" } })
    });
    expect(harness.core.audit.report(serverId)?.quarantined).toBe(true);
    expect(engine.calls).toBe(callsBefore);
  });
});

describe("launch gate", () => {
  test("refuses to launch a server the audit has never checked", async () => {
    const serverId = await seedStdioServer(harness.core, { name: "unchecked" });
    const error = await harness.core.pool.acquire(serverId).catch((caught: unknown) => caught);
    expect((error as UpstreamError).code).toBe("audit_pending");
    expect(harness.core.supervisor.isRunning(serverId)).toBe(false);

    await harness.core.audit.runServer(serverId, "manual");
    await harness.core.pool.acquire(serverId);
    expect(harness.core.supervisor.isRunning(serverId)).toBe(true);
  });

  test("refuses to launch while the last audit is an error", async () => {
    const serverId = await seedStdioServer(harness.core, { name: "broken" });
    engine.error = new Error("registry unreachable");
    await harness.core.audit.runServer(serverId, "manual");

    const error = await harness.core.pool.acquire(serverId).catch((caught: unknown) => caught);
    expect((error as UpstreamError).code).toBe("audit_error");
    expect((error as UpstreamError).message).toContain("registry unreachable");

    engine.error = null;
    await harness.core.audit.runServer(serverId, "manual");
    await harness.core.pool.acquire(serverId);
    expect(harness.core.supervisor.isRunning(serverId)).toBe(true);
  });

  test("answers start and test with the audit reason", async () => {
    const serverId = await seedStdioServer(harness.core, { name: "pending" });
    engine.error = new Error("registry unreachable");
    await harness.core.audit.runServer(serverId, "manual");

    const start = await api(`/v1/servers/${serverId}/start`, { method: "POST" });
    expect(start.status).toBe(409);
    expect((await body<{ message: string }>(start)).message).toContain("registry unreachable");

    const tested = await body<{ ok: boolean; error: string }>(
      await api(`/v1/servers/${serverId}/test`, { method: "POST" })
    );
    expect(tested.ok).toBe(false);
    expect(tested.error).toContain("registry unreachable");
    expect(harness.core.supervisor.isRunning(serverId)).toBe(false);
  });

  test("keeps launching servers the audit cannot check", async () => {
    await withHarness(
      {
        audit: {
          engines: [new FakeEngine()],
          targetFor: () => ({ kind: "unsupported", reason: "not auditable" }),
          startupDelayMs: 0
        }
      },
      async (plain) => {
        setSetting(plain.core.db, "audit_enabled", "true");
        const serverId = await seedStdioServer(plain.core, { name: "opaque" });
        await plain.core.pool.acquire(serverId);
        expect(plain.core.supervisor.isRunning(serverId)).toBe(true);
      }
    );
  });

  test("keeps the quarantine reason current", async () => {
    const { serverId } = await seedPublished("shifting");
    engine.findings = [finding("critical", "GHSA-first")];
    await harness.core.audit.runServer(serverId, "manual");
    const first = await body<{ quarantineReason: string }>(await api(`/v1/servers/${serverId}`));
    expect(first.quarantineReason).toContain("1 critical");

    engine.findings = [finding("critical", "GHSA-a"), finding("critical", "GHSA-b")];
    await harness.core.audit.runServer(serverId, "manual");
    const second = await body<{ quarantineReason: string }>(await api(`/v1/servers/${serverId}`));
    expect(second.quarantineReason).toContain("2 critical");
  });

  test("counts lifted quarantines in the run summary", async () => {
    const { serverId } = await seedPublished("lifted");
    engine.findings = [finding("critical")];
    await harness.core.audit.runServer(serverId, "manual");
    expect(harness.core.audit.report(serverId)?.quarantined).toBe(true);

    engine.findings = [];
    const summary = await harness.core.audit.runAll("manual");
    expect(summary.lifted).toBe(1);
    expect(harness.core.audit.report(serverId)?.quarantined).toBe(false);
  });
});

describe("audit failures", () => {
  test("records an engine failure without touching the sanctions", async () => {
    const { serverId } = await seedPublished();
    engine.findings = [finding("critical")];
    await harness.core.audit.runServer(serverId, "manual");
    engine.error = new Error("network is down");

    const result = await harness.core.audit.runServer(serverId, "manual");
    expect(result.status).toBe("error");
    expect(result.error).toBe("network is down");
    expect(harness.core.audit.report(serverId)?.quarantined).toBe(true);
  });

  test("times out a slow engine and reports it as an error", async () => {
    await withHarness(
      {
        audit: {
          engines: [Object.assign(new FakeEngine(), { delayMs: 5_000 })],
          targetFor: () => ({ kind: "npm", specs: ["pkg"] }),
          serverTimeoutMs: 50,
          startupDelayMs: 0
        }
      },
      async (slow) => {
        setSetting(slow.core.db, "audit_enabled", "true");
        const serverId = await seedStdioServer(slow.core, { name: "slow" });
        const result = await slow.core.audit.runServer(serverId, "manual");
        expect(result.status).toBe("error");
        expect(result.error).toContain("timed out");
      }
    );
  });

  test("marks a docker server as unsupported without running an engine", async () => {
    await withHarness({ audit: { engines: [engine], startupDelayMs: 0 } }, async (plain) => {
      setSetting(plain.core.db, "audit_enabled", "true");
      const serverId = await seedStdioServer(plain.core, { name: "docker-ish" });
      plain.core.db
        .update(servers)
        .set({ runtime: "docker", args: ["run", "--rm", "img"] })
        .where(eq(servers.id, serverId))
        .run();
      const result = await plain.core.audit.runServer(serverId, "manual");
      expect(result.status).toBe("unsupported");
      expect(result.reason).toContain("container images");
    });
  });
});

describe("audit scheduling", () => {
  test("coalesces two concurrent full runs", async () => {
    await seedStdioServer(harness.core, { name: "one" });
    const [first, second] = await Promise.all([
      harness.core.audit.runAll("manual"),
      harness.core.audit.runAll("manual")
    ]);
    expect(first).toBe(second);
    expect(first.done).toBe(first.total);
  });

  test("runs periodically once the interval elapses", async () => {
    await seedStdioServer(harness.core, { name: "ticker" });
    harness.core.audit.start();
    await Bun.sleep(150);
    const first = harness.core.audit.lastRun();
    expect(first).not.toBeNull();
    await Bun.sleep(400);
    const second = harness.core.audit.lastRun();
    expect(second?.startedAt).toBeGreaterThan(first!.startedAt);
  });

  test("audits a freshly created server without being asked", async () => {
    const response = await api("/v1/servers", {
      method: "POST",
      body: JSON.stringify({ name: "fresh", transport: "stdio", runtime: "npx", args: ["-y", "pkg"] })
    });
    const created = await body<{ id: string }>(response);
    for (let i = 0; i < 40 && !harness.core.audit.store.get(created.id); i += 1) await Bun.sleep(25);
    expect(harness.core.audit.store.get(created.id)?.trigger).toBe("server-saved");
  });

  test("keeps the audit out of reach of the management server", async () => {
    const response = await api("/v1/settings", { method: "PATCH", body: JSON.stringify({ auditIntervalHours: 0 }) });
    expect(response.status).toBe(400);
  });
});
