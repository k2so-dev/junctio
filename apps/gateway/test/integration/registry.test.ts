import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RegistryDetailDto, RegistryListDto } from "@junctio/schema";
import fixture from "../fixtures/registry-list.json" with { type: "json" };
import { registryCache } from "../../src/db/schema.ts";
import { adminApi, startHarness, type Harness } from "../helpers.ts";

type Entry = { server: { name: string } };

let harness: Harness;
let calls: string[] = [];
let respond: (url: string, init: RequestInit | undefined) => Promise<Response>;

const list = fixture as { servers: Entry[]; metadata: { count: number } };

function entryNamed(name: string): Entry {
  const found = list.servers.find((item) => item.server.name === name);
  if (!found) throw new Error(`fixture is missing ${name}`);
  return found;
}

function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(url);
  return await respond(url, init);
}) as typeof fetch;

let api: (path: string, init?: RequestInit) => Promise<Response>;

beforeEach(async () => {
  calls = [];
  respond = async (url) =>
    url.includes("/versions/latest")
      ? ok(entryNamed(decodeURIComponent(url.split("/servers/")[1]?.split("/versions")[0] ?? "")))
      : ok(list);
  harness = await startHarness({ fetchImpl, registryTimeoutMs: 200 });
  api = adminApi(() => harness);
  await api("/v1/session/setup", { method: "POST", body: JSON.stringify({ password: "supersecret" }) });
});

afterEach(async () => {
  await harness.stop();
});

describe("registry browsing", () => {
  test("asks the registry once and serves the cached copy after that", async () => {
    const first = (await (await api("/v1/registry/servers")).json()) as RegistryListDto;
    expect(first.items).toHaveLength(list.servers.length);
    expect(first.stale).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("version=latest");

    const second = (await (await api("/v1/registry/servers")).json()) as RegistryListDto;
    expect(calls).toHaveLength(1);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(harness.core.db.select().from(registryCache).all()).toHaveLength(1);
  });

  test("a refresh goes back out, a different page does not reuse the first", async () => {
    await api("/v1/registry/servers");
    await api("/v1/registry/servers?refresh=1");
    expect(calls).toHaveLength(2);

    await api("/v1/registry/servers?search=filesystem");
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain("search=filesystem");
  });

  test("rejects a page size the registry would refuse, without asking it", async () => {
    const response = await api("/v1/registry/servers?limit=500");
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("serves a stale copy when the registry breaks, and says so", async () => {
    await api("/v1/registry/servers");
    harness.core.db.delete(registryCache).run();
    harness.core.db
      .insert(registryCache)
      .values({
        key: "list:version=latest&limit=30",
        body: JSON.stringify(list),
        fetchedAt: Date.now() - 7_200_000,
        expiresAt: Date.now() - 3_600_000
      })
      .run();
    respond = async () => new Response("upstream is down", { status: 503 });

    const response = await api("/v1/registry/servers");
    expect(response.status).toBe(200);
    const body = (await response.json()) as RegistryListDto;
    expect(body.stale).toBe(true);
    expect(body.error).toContain("503");
    expect(body.items).toHaveLength(list.servers.length);
  });

  test("answers 502 when the registry breaks and nothing is cached", async () => {
    respond = async () => new Response(JSON.stringify({ detail: "validation failed" }), { status: 422 });
    const response = await api("/v1/registry/servers");
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("registry_unavailable");
    expect(body.message).toContain("validation failed");
  });

  test("gives up on a registry that never answers", async () => {
    respond = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const started = Date.now();
    const response = await api("/v1/registry/servers");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("did not answer within 200ms");
  });
});

describe("registry install drafts", () => {
  test("hands back a draft the server form can open", async () => {
    const response = await api("/v1/registry/server?name=com.pulsemcp%2Fremote-filesystem");
    expect(response.status).toBe(200);
    const body = (await response.json()) as RegistryDetailDto;
    expect(body.server.name).toBe("com.pulsemcp/remote-filesystem");
    const option = body.options[0]!;
    expect(option.draft?.name).toBe("remote-filesystem");
    expect(option.draft?.runtime).toBe("npx");
    expect(option.inputs.length).toBeGreaterThan(0);
  });

  test("never proposes a name another server already holds", async () => {
    await api("/v1/servers", {
      method: "POST",
      body: JSON.stringify({
        name: "remote-filesystem",
        transport: "stdio",
        runtime: "custom",
        args: ["bun", "--version"]
      })
    });
    const body = (await (
      await api("/v1/registry/server?name=com.pulsemcp%2Fremote-filesystem")
    ).json()) as RegistryDetailDto;
    expect(body.options[0]?.draft?.name).toBe("remote-filesystem-2");
  });

  test("marks an entry as installed once its package is configured", async () => {
    const before = (await (await api("/v1/registry/servers")).json()) as RegistryListDto;
    expect(before.items.every((item) => !item.installed)).toBe(true);

    await api("/v1/servers", {
      method: "POST",
      body: JSON.stringify({
        name: "already-here",
        transport: "stdio",
        runtime: "npx",
        args: ["-y", "remote-filesystem-mcp-server@0.1.5"]
      })
    });

    const after = (await (await api("/v1/registry/servers?refresh=1")).json()) as RegistryListDto;
    const entry = after.items.find((item) => item.name === "com.pulsemcp/remote-filesystem");
    expect(entry?.installed).toBe(true);
    expect(after.items.filter((item) => item.installed)).toHaveLength(1);
  });

  test("passes a missing server through as a 404", async () => {
    respond = async () => new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
    const response = await api("/v1/registry/server?name=io.github.nobody%2Fnothing");
    expect(response.status).toBe(404);
  });

  test("needs an admin session like every other admin route", async () => {
    const response = await fetch(`${harness.url}/api/v1/registry/servers`);
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
