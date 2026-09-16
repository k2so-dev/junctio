import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MOCK_STDIO, adminApi, startHarness, type Harness } from "../helpers.ts";

let harness: Harness;

let api: (path: string, init?: RequestInit) => Promise<Response>;

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

beforeEach(async () => {
  harness = await startHarness();
  api = adminApi(() => harness);
  await api("/v1/session/setup", { method: "POST", body: JSON.stringify({ password: "supersecret" }) });
});

afterEach(async () => {
  await harness.stop();
});

async function createStdioServer(name = "mock", env: Record<string, string> = {}) {
  const response = await api("/v1/servers", {
    method: "POST",
    body: JSON.stringify({
      name,
      transport: "stdio",
      runtime: "custom",
      args: ["bun", MOCK_STDIO],
      env: { PATH: Bun.env.PATH, HOME: Bun.env.HOME, MOCK_NAME: name, ...env }
    })
  });
  return json<{ id: string; commandPreview: string; status: string }>(response);
}

describe("session", () => {
  test("requires setup before any other call", async () => {
    const fresh = await startHarness();
    try {
      const response = await fetch(`${fresh.url}/api/v1/session`);
      const body = await json<{ needsSetup: boolean; authenticated: boolean }>(response);
      expect(body.needsSetup).toBe(true);
      expect(body.authenticated).toBe(false);
      const denied = await fetch(`${fresh.url}/api/v1/servers`);
      expect(denied.status).toBe(401);
    } finally {
      await fresh.stop();
    }
  });

  test("logs in with the configured password", async () => {
    const bad = await api("/v1/session/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) });
    expect(bad.status).toBe(401);
    const good = await api("/v1/session/login", { method: "POST", body: JSON.stringify({ password: "supersecret" }) });
    expect(good.status).toBe(200);
    expect((await json<{ authenticated: boolean }>(await api("/v1/session"))).authenticated).toBe(true);
  });

  test("rate limits repeated login attempts", async () => {
    let limited = false;
    for (let i = 0; i < 14; i++) {
      const response = await api("/v1/session/login", { method: "POST", body: JSON.stringify({ password: "nope" }) });
      if (response.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  test("logs out and invalidates the cookie", async () => {
    expect((await api("/v1/servers")).status).toBe(200);
    const loggedOut = await api("/v1/session/logout", { method: "POST" });
    expect(loggedOut.status).toBe(200);
    expect((await api("/v1/servers")).status).toBe(401);
  });

  test("accepts the admin token instead of a cookie", async () => {
    const withToken = await startHarness({ env: { JUNCTIO_ADMIN_TOKEN: "token-0123456789abcdef" } });
    try {
      const response = await fetch(`${withToken.url}/api/v1/servers`, {
        headers: { authorization: "Bearer token-0123456789abcdef" }
      });
      expect(response.status).toBe(200);
    } finally {
      await withToken.stop();
    }
  });

  test("guards setup with the admin token when one is configured", async () => {
    const token = "token-0123456789abcdef";
    const guarded = await startHarness({ env: { JUNCTIO_ADMIN_TOKEN: token } });
    try {
      const anonymous = await fetch(`${guarded.url}/api/v1/session/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "attackerchosen" })
      });
      expect(anonymous.status).toBe(401);
      expect((await json<{ needsSetup: boolean }>(await fetch(`${guarded.url}/api/v1/session`))).needsSetup).toBe(true);

      const authorized = await fetch(`${guarded.url}/api/v1/session/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: "operatorchosen" })
      });
      expect(authorized.status).toBe(200);
    } finally {
      await guarded.stop();
    }
  });

  test("marks the session cookie secure behind a trusted https proxy", async () => {
    const proxied = await startHarness({ env: { JUNCTIO_TRUST_PROXY: "true" } });
    try {
      const response = await fetch(`${proxied.url}/api/v1/session/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
        body: JSON.stringify({ password: "supersecret" })
      });
      expect(response.headers.get("set-cookie")).toContain("Secure");
    } finally {
      await proxied.stop();
    }
  });
});

describe("security headers", () => {
  test("sends hardening headers and keeps api responses out of caches", async () => {
    const response = await api("/v1/session");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("servers api", () => {
  test("creates, reads, updates and deletes a server", async () => {
    const created = await createStdioServer();
    expect(created.commandPreview).toContain("bun");
    expect(created.status).toBe("stopped");

    const list = await json<unknown[]>(await api("/v1/servers"));
    expect(list).toHaveLength(1);

    const patched = await json<{ idleTimeoutSec: number; warm: boolean }>(
      await api(`/v1/servers/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ idleTimeoutSec: 60, warm: true })
      })
    );
    expect(patched.idleTimeoutSec).toBe(60);
    expect(patched.warm).toBe(true);

    expect((await api(`/v1/servers/${created.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/v1/servers/${created.id}`)).status).toBe(404);
  });

  test("rejects a duplicate name", async () => {
    await createStdioServer("dup");
    const response = await api("/v1/servers", {
      method: "POST",
      body: JSON.stringify({ name: "dup", transport: "stdio", runtime: "custom", args: ["bun"] })
    });
    expect(response.status).toBe(409);
  });

  test("rejects an invalid payload", async () => {
    const response = await api("/v1/servers", {
      method: "POST",
      body: JSON.stringify({ name: "bad name!", transport: "stdio", args: ["x"] })
    });
    expect(response.status).toBe(400);
    const body = await json<{ error: string; details: unknown[] }>(response);
    expect(body.error).toBe("validation_failed");
    expect(body.details.length).toBeGreaterThan(0);
  });

  test("requires a url for http transport", async () => {
    const response = await api("/v1/servers", {
      method: "POST",
      body: JSON.stringify({ name: "remote", transport: "http" })
    });
    expect(response.status).toBe(400);
  });

  test("requires a url for sse transport", async () => {
    const response = await api("/v1/servers", {
      method: "POST",
      body: JSON.stringify({ name: "legacy", transport: "sse" })
    });
    expect(response.status).toBe(400);
  });

  test("previews the resolved command", async () => {
    const response = await api("/v1/servers/preview", {
      method: "POST",
      body: JSON.stringify({
        name: "everything",
        transport: "stdio",
        runtime: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"]
      })
    });
    const body = await json<{ preview: string; argv: string[] }>(response);
    expect(body.preview).toBe("npx -y @modelcontextprotocol/server-everything");
    expect(body.argv[0]).toBe("npx");
  });

  test("masks stored headers and keeps them on update", async () => {
    const created = await json<{ id: string; headers: Record<string, string> }>(
      await api("/v1/servers", {
        method: "POST",
        body: JSON.stringify({
          name: "remote",
          transport: "http",
          url: "https://example.com/mcp",
          authMode: "header",
          headers: { authorization: "Bearer super-secret-value" }
        })
      })
    );
    expect(created.headers).toEqual({ authorization: "***" });

    await api(`/v1/servers/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ headers: { authorization: "***" }, idleTimeoutSec: 30 })
    });
    const resolved = await harness.core.registry.resolve(created.id);
    expect(resolved?.headers.authorization).toBe("Bearer super-secret-value");
  });

  test("masks stored env and keeps it on update", async () => {
    const created = await json<{ id: string; env: Record<string, string> }>(
      await api("/v1/servers", {
        method: "POST",
        body: JSON.stringify({
          name: "secretive",
          transport: "stdio",
          runtime: "custom",
          args: ["bun", MOCK_STDIO],
          env: { GITHUB_TOKEN: "ghp_super_secret_value" }
        })
      })
    );
    expect(created.env).toEqual({ GITHUB_TOKEN: "***" });

    await api(`/v1/servers/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ env: { GITHUB_TOKEN: "***" }, idleTimeoutSec: 30 })
    });
    const resolved = await harness.core.registry.resolve(created.id);
    expect(resolved?.env.GITHUB_TOKEN).toBe("ghp_super_secret_value");
    expect(resolved?.row.envEnc).toBeTruthy();
  });

  test("starts, tests and stops a server", async () => {
    const created = await createStdioServer();
    const started = await json<{ status: string; pid: number | null }>(
      await api(`/v1/servers/${created.id}/start`, { method: "POST" })
    );
    expect(started.status).toBe("running");
    expect(started.pid).toBeGreaterThan(0);

    const tested = await json<{ ok: boolean; toolCount: number; serverInfo: { name: string } | null }>(
      await api(`/v1/servers/${created.id}/test`, { method: "POST" })
    );
    expect(tested.ok).toBe(true);
    expect(tested.toolCount).toBe(3);
    expect(tested.serverInfo?.name).toBe("mock");

    const tools = await json<{ tools: { name: string }[] }>(await api(`/v1/servers/${created.id}/tools`));
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["add", "echo", "whoami"]);

    const stopped = await json<{ status: string }>(await api(`/v1/servers/${created.id}/stop`, { method: "POST" }));
    expect(stopped.status).toBe("stopped");
  }, 30_000);

  test("keeps the process alive when only the name changes", async () => {
    const created = await createStdioServer();
    const started = await json<{ pid: number | null }>(
      await api(`/v1/servers/${created.id}/start`, { method: "POST" })
    );

    const renamed = await json<{ name: string; status: string; pid: number | null }>(
      await api(`/v1/servers/${created.id}`, { method: "PATCH", body: JSON.stringify({ name: "renamed" }) })
    );
    expect(renamed.name).toBe("renamed");
    expect(renamed.status).toBe("running");
    expect(renamed.pid).toBe(started.pid);

    const changed = await json<{ status: string }>(
      await api(`/v1/servers/${created.id}`, { method: "PATCH", body: JSON.stringify({ args: [MOCK_STDIO, "x"] }) })
    );
    expect(changed.status).not.toBe("running");
  }, 30_000);

  test("returns logs for a started server", async () => {
    const created = await createStdioServer();
    await api(`/v1/servers/${created.id}/start`, { method: "POST" });
    await Bun.sleep(200);
    const lines = await json<{ stream: string; line: string }[]>(await api(`/v1/servers/${created.id}/logs?tail=50`));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((entry) => entry.line.includes("ready"))).toBe(true);
  }, 30_000);

  test("reports a failing server through test", async () => {
    const created = await json<{ id: string }>(
      await api("/v1/servers", {
        method: "POST",
        body: JSON.stringify({
          name: "broken",
          transport: "stdio",
          runtime: "custom",
          args: ["bun", MOCK_STDIO],
          env: { PATH: Bun.env.PATH, HOME: Bun.env.HOME, MOCK_EXIT_IMMEDIATELY: "1" }
        })
      })
    );
    const tested = await json<{ ok: boolean; error: string | null }>(
      await api(`/v1/servers/${created.id}/test`, { method: "POST" })
    );
    expect(tested.ok).toBe(false);
    expect(tested.error).toContain("mock server refusing to start");
  }, 30_000);

  test("test reports why the process died, not just a closed connection", async () => {
    const created = await json<{ id: string }>(
      await api("/v1/servers", {
        method: "POST",
        body: JSON.stringify({
          name: "silent",
          transport: "stdio",
          runtime: "custom",
          args: ["bun", MOCK_STDIO],
          env: { PATH: Bun.env.PATH, HOME: Bun.env.HOME, MOCK_SILENT_EXIT: "1" }
        })
      })
    );
    const tested = await json<{ ok: boolean; error: string | null }>(
      await api(`/v1/servers/${created.id}/test`, { method: "POST" })
    );
    expect(tested.ok).toBe(false);
    expect(tested.error).toContain("without writing anything");
  }, 30_000);
});

describe("namespaces api", () => {
  test("creates a namespace and attaches servers", async () => {
    const server = await createStdioServer("alpha");
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    const withServer = await json<{ servers: { prefix: string }[] }>(
      await api(`/v1/namespaces/${namespace.id}/servers`, {
        method: "POST",
        body: JSON.stringify({ serverId: server.id })
      })
    );
    expect(withServer.servers).toHaveLength(1);
    expect(withServer.servers[0]?.prefix).toBe("alpha");
  });

  test("composes the instructions of a namespace", async () => {
    const server = await createStdioServer("alpha", { MOCK_INSTRUCTIONS: "Upstream says hi." });
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: server.id })
    });

    const upstream = await json<{ instructions: string | null }>(
      await api(`/v1/namespaces/${namespace.id}/instructions`)
    );
    expect(upstream.instructions).toBe("## alpha\n\nUpstream says hi.");

    const overridden = await json<{ servers: { description: string | null; originalDescription: string | null }[] }>(
      await api(`/v1/namespaces/${namespace.id}/servers`, {
        method: "POST",
        body: JSON.stringify({ serverId: server.id, description: "Use alpha sparingly." })
      })
    );
    expect(overridden.servers[0]?.description).toBe("Use alpha sparingly.");
    expect(overridden.servers[0]?.originalDescription).toBe("Upstream says hi.");
    expect(
      (await json<{ instructions: string | null }>(await api(`/v1/namespaces/${namespace.id}/instructions`)))
        .instructions
    ).toBe("## alpha\n\nUse alpha sparingly.");

    const renamed = await json<{ servers: { description: string | null }[] }>(
      await api(`/v1/namespaces/${namespace.id}/servers`, {
        method: "POST",
        body: JSON.stringify({ serverId: server.id, prefix: "a" })
      })
    );
    expect(renamed.servers[0]?.description).toBe("Use alpha sparingly.");
    expect(
      (await json<{ instructions: string | null }>(await api(`/v1/namespaces/${namespace.id}/instructions`)))
        .instructions
    ).toBe("## a\n\nUse alpha sparingly.");

    await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: server.id, prefix: "a", description: null })
    });
    expect(
      (await json<{ instructions: string | null }>(await api(`/v1/namespaces/${namespace.id}/instructions`)))
        .instructions
    ).toBe("## a\n\nUpstream says hi.");

    await api(`/v1/namespaces/${namespace.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "Team stack." })
    });
    expect(
      (await json<{ instructions: string | null }>(await api(`/v1/namespaces/${namespace.id}/instructions`)))
        .instructions
    ).toBe("Team stack.\n\n## a\n\nUpstream says hi.");

    const missing = await api("/v1/namespaces/2f1f3f6c-0000-4000-8000-000000000000/instructions");
    expect(missing.status).toBe(404);
  }, 30_000);

  test("rejects a colliding prefix", async () => {
    const first = await createStdioServer("alpha");
    const second = await createStdioServer("beta");
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: first.id, prefix: "same" })
    });
    const response = await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: second.id, prefix: "same" })
    });
    expect(response.status).toBe(409);
    const after = await json<{ servers: unknown[] }>(await api(`/v1/namespaces/${namespace.id}`));
    expect(after.servers).toHaveLength(1);
  });

  test("keeps the previous prefix when an update collides", async () => {
    const first = await createStdioServer("alpha");
    const second = await createStdioServer("beta");
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: first.id, prefix: "one" })
    });
    await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: second.id, prefix: "two" })
    });

    const response = await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: second.id, prefix: "one" })
    });
    expect(response.status).toBe(409);

    const after = await json<{ servers: { serverId: string; prefix: string }[] }>(
      await api(`/v1/namespaces/${namespace.id}`)
    );
    expect(after.servers).toHaveLength(2);
    expect(after.servers.find((member) => member.serverId === second.id)?.prefix).toBe("two");
  });

  test("renaming a namespace keeps its description", async () => {
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", {
        method: "POST",
        body: JSON.stringify({ name: "team", description: "the coding stack" })
      })
    );
    const renamed = await json<{ name: string; description: string | null }>(
      await api(`/v1/namespaces/${namespace.id}`, { method: "PATCH", body: JSON.stringify({ name: "crew" }) })
    );
    expect(renamed.name).toBe("crew");
    expect(renamed.description).toBe("the coding stack");
  });

  test("refuses a tool override for a server outside the namespace", async () => {
    const server = await createStdioServer("alpha");
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    const response = await api(`/v1/namespaces/${namespace.id}/tools`, {
      method: "PUT",
      body: JSON.stringify({ serverId: server.id, toolName: "echo", enabled: false })
    });
    expect(response.status).toBe(400);
  });

  test("lists namespace tools and stores overrides", async () => {
    const server = await createStdioServer("alpha");
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: server.id })
    });

    const tools = await json<{ toolName: string; exposedName: string; enabled: boolean }[]>(
      await api(`/v1/namespaces/${namespace.id}/tools`)
    );
    expect(tools.map((tool) => tool.exposedName).sort()).toEqual(["alpha__add", "alpha__echo", "alpha__whoami"]);

    await api(`/v1/namespaces/${namespace.id}/tools`, {
      method: "PUT",
      body: JSON.stringify({ serverId: server.id, toolName: "echo", enabled: false, description: "hidden" })
    });
    const updated = await json<{ toolName: string; enabled: boolean }[]>(
      await api(`/v1/namespaces/${namespace.id}/tools`)
    );
    expect(updated.find((tool) => tool.toolName === "echo")?.enabled).toBe(false);
  }, 30_000);
});

describe("endpoints and keys api", () => {
  test("creates an endpoint and issues a key once", async () => {
    const server = await createStdioServer("alpha");
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: server.id })
    });
    const endpoint = await json<{ id: string; url: string; authMode: string }>(
      await api("/v1/endpoints", {
        method: "POST",
        body: JSON.stringify({ slug: "team", namespaceId: namespace.id })
      })
    );
    expect(endpoint.url).toContain("/mcp/team");
    expect(endpoint.authMode).toBe("api_key");

    const key = await json<{ token: string; prefix: string }>(
      await api("/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "laptop", endpointId: endpoint.id })
      })
    );
    expect(key.token.startsWith("jn_")).toBe(true);
    expect(key.token).toContain(key.prefix);

    const listed = await json<{ token?: string }[]>(await api("/v1/api-keys"));
    expect(listed).toHaveLength(1);
    expect(listed[0]?.token).toBeUndefined();
  });

  test("a patch leaves every field it does not name alone", async () => {
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    const endpoint = await json<{ id: string; protocolMin: string }>(
      await api("/v1/endpoints", {
        method: "POST",
        body: JSON.stringify({
          slug: "team",
          namespaceId: namespace.id,
          authMode: "oauth",
          protocolMin: "2025-11-25",
          rateLimit: { perMinute: 60 },
          enabled: false
        })
      })
    );

    const afterProtocol = await json<{
      authMode: string;
      protocolMin: string;
      rateLimit: { perMinute: number };
      enabled: boolean;
    }>(
      await api(`/v1/endpoints/${endpoint.id}`, {
        method: "PATCH",
        body: JSON.stringify({ protocolMin: "2026-07-28" })
      })
    );
    expect(afterProtocol.protocolMin).toBe("2026-07-28");
    expect(afterProtocol.authMode).toBe("oauth");
    expect(afterProtocol.rateLimit.perMinute).toBe(60);
    expect(afterProtocol.enabled).toBe(false);

    const afterAuth = await json<{ authMode: string; protocolMin: string }>(
      await api(`/v1/endpoints/${endpoint.id}`, {
        method: "PATCH",
        body: JSON.stringify({ authMode: "any" })
      })
    );
    expect(afterAuth.authMode).toBe("any");
    expect(afterAuth.protocolMin).toBe("2026-07-28");
  });

  test("a new endpoint speaks the newest revision only", async () => {
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    const endpoint = await json<{ protocolMin: string }>(
      await api("/v1/endpoints", {
        method: "POST",
        body: JSON.stringify({ slug: "team", namespaceId: namespace.id })
      })
    );
    expect(endpoint.protocolMin).toBe("2026-07-28");
  });

  test("refuses to move an endpoint to a missing namespace", async () => {
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    const endpoint = await json<{ id: string }>(
      await api("/v1/endpoints", {
        method: "POST",
        body: JSON.stringify({ slug: "team", namespaceId: namespace.id })
      })
    );
    const response = await api(`/v1/endpoints/${endpoint.id}`, {
      method: "PATCH",
      body: JSON.stringify({ namespaceId: "does-not-exist" })
    });
    expect(response.status).toBe(404);
  });

  test("accepts oauth endpoints backed by the built-in authorization server", async () => {
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    const response = await api("/v1/endpoints", {
      method: "POST",
      body: JSON.stringify({ slug: "team", namespaceId: namespace.id, authMode: "oauth" })
    });
    expect(response.status).toBe(201);

    const settings = await json<{ authorizationServer: string }>(await api("/v1/settings"));
    expect(settings.authorizationServer).toBe("builtin");
  });
});

describe("settings and request log", () => {
  test("reads and updates settings", async () => {
    const settings = await json<{ toolSeparator: string }>(await api("/v1/settings"));
    expect(settings.toolSeparator).toBe("__");
    const updated = await api("/v1/settings", { method: "PATCH", body: JSON.stringify({ toolSeparator: "." }) });
    expect(updated.status).toBe(200);
    expect((await json<{ toolSeparator: string }>(await api("/v1/settings"))).toolSeparator).toBe(".");
  });

  test("records proxied calls in the request log", async () => {
    const server = await createStdioServer("alpha");
    const namespace = await json<{ id: string }>(
      await api("/v1/namespaces", { method: "POST", body: JSON.stringify({ name: "team" }) })
    );
    await api(`/v1/namespaces/${namespace.id}/servers`, {
      method: "POST",
      body: JSON.stringify({ serverId: server.id })
    });
    const endpoint = await json<{ id: string }>(
      await api("/v1/endpoints", {
        method: "POST",
        body: JSON.stringify({ slug: "team", namespaceId: namespace.id, authMode: "none" })
      })
    );

    const { connectClient } = await import("../helpers.ts");
    const client = await connectClient(`${harness.url}/mcp/team`, null, { pin: "2026-07-28" });
    await client.listTools();
    await client.callTool({ name: "alpha__echo", arguments: { message: "logged" } });
    await client.close();

    const entries = await json<{ method: string; tool: string | null; status: string; endpointId: string }[]>(
      await api("/v1/request-log")
    );
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some((entry) => entry.method === "tools/call" && entry.tool === "alpha__echo")).toBe(true);
    expect(entries.every((entry) => entry.endpointId === endpoint.id)).toBe(true);

    const filtered = await json<unknown[]>(await api("/v1/request-log?status=error"));
    expect(filtered).toHaveLength(0);
  }, 30_000);
});
