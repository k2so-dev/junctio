import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { desc } from "drizzle-orm";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import { requestLog } from "../../src/db/schema.ts";
import { MOCK_STDIO, adminApi, connectClient, seedApiKey, startHarness, type Harness } from "../helpers.ts";
import registryList from "../fixtures/registry-list.json" with { type: "json" };

const ADMIN_TOKEN = "admin-token-0123456789abcdef";

let harness: Harness;

let api: (path: string, init?: RequestInit) => Promise<Response>;

async function enable(value = true): Promise<void> {
  const response = await api("/v1/settings", { method: "PATCH", body: JSON.stringify({ adminMcp: value }) });
  expect(response.status).toBe(200);
}

async function rawCall(token: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${harness.url}/mcp/_admin`, { method: "POST", headers, body: JSON.stringify(body) });
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } }
};

async function adminClient() {
  return connectClient(`${harness.url}/mcp/_admin`, ADMIN_TOKEN);
}

function payload(result: CallToolResult): unknown {
  const first = result.content[0];
  const text = first && first.type === "text" ? first.text : "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "";
}

async function call(client: Awaited<ReturnType<typeof adminClient>>, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

beforeEach(async () => {
  harness = await startHarness({ env: { JUNCTIO_ADMIN_TOKEN: ADMIN_TOKEN } });
  api = adminApi(() => harness);
  await api("/v1/session/setup", {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ password: "supersecret" })
  });
});

afterEach(async () => {
  await harness.stop();
});

describe("management mcp exposure", () => {
  test("stays switched off until a human turns it on", async () => {
    expect((await rawCall(ADMIN_TOKEN, initialize)).status).toBe(404);
    expect((await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/_admin`)).status).toBe(404);

    await enable();
    expect((await rawCall(ADMIN_TOKEN, initialize)).status).toBe(200);
  });

  test("goes quiet again when it is switched off", async () => {
    await enable();
    expect((await rawCall(ADMIN_TOKEN, initialize)).status).toBe(200);
    await enable(false);
    expect((await rawCall(ADMIN_TOKEN, initialize)).status).toBe(404);
  });

  test("refuses anything but the admin token", async () => {
    await enable();
    const anonymous = await rawCall(null, initialize);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain("invalid_token");

    expect((await rawCall("wrong-token", initialize)).status).toBe(401);

    const endpointKey = await seedApiKey(harness.core, null);
    expect((await rawCall(endpointKey, initialize)).status).toBe(401);
  });

  test("answers only POST", async () => {
    await enable();
    const response = await fetch(`${harness.url}/mcp/_admin`, {
      method: "GET",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    expect(response.status).toBe(405);
  });
});

describe("management mcp tools", () => {
  beforeEach(async () => {
    await enable();
  });

  test("offers management tools and withholds key issuing", async () => {
    const client = await adminClient();
    const { tools } = await client.listTools();
    const names = tools.map((tool: Tool) => tool.name);

    expect(names).toContain("create_server");
    expect(names).toContain("create_namespace");
    expect(names).toContain("create_endpoint");
    expect(names).toContain("install_registry_server");
    expect(names).toContain("list_api_keys");

    expect(names).not.toContain("create_api_key");
    expect(names).not.toContain("delete_api_key");
    expect(names).not.toContain("revoke_oauth_client");
    expect(names).not.toContain("approve_oauth_request");

    const destroy = tools.find((tool: Tool) => tool.name === "delete_server");
    expect(destroy?.annotations?.destructiveHint).toBe(true);
    const read = tools.find((tool: Tool) => tool.name === "list_servers");
    expect(read?.annotations?.readOnlyHint).toBe(true);

    await client.close();
  });

  test("walks the whole path from a server to an endpoint", async () => {
    const client = await adminClient();

    const created = payload(
      await call(client, "create_server", {
        name: "mock",
        transport: "stdio",
        runtime: "custom",
        args: ["bun", MOCK_STDIO],
        env: { PATH: Bun.env.PATH ?? "/usr/bin", HOME: Bun.env.HOME ?? "/tmp", MOCK_NAME: "mock" }
      })
    ) as { id: string; name: string };
    expect(created.name).toBe("mock");

    const namespace = payload(await call(client, "create_namespace", { name: "team" })) as { id: string };
    await call(client, "add_namespace_server", { namespaceId: namespace.id, serverId: created.id });

    const endpoint = payload(
      await call(client, "create_endpoint", { slug: "team", namespaceId: namespace.id, authMode: "none" })
    ) as { slug: string; url: string };
    expect(endpoint.slug).toBe("team");

    const tools = payload(await call(client, "list_namespace_tools", { id: namespace.id })) as {
      exposedName: string;
    }[];
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.exposedName.startsWith("mock__"))).toBe(true);

    const deleted = await call(client, "delete_server", { id: created.id });
    expect(deleted.isError).toBeFalsy();
    expect(payload(await call(client, "list_servers"))).toEqual([]);

    await client.close();
  });

  test("reports a validation failure instead of throwing", async () => {
    const client = await adminClient();
    const result = await call(client, "create_server", { name: "broken", transport: "stdio", args: [] });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("args");
    await client.close();
  });

  test("refuses a server id that is not a plain identifier", async () => {
    const client = await adminClient();
    const server = payload(
      await call(client, "create_server", {
        name: "quarantined",
        transport: "stdio",
        runtime: "custom",
        args: ["bun", MOCK_STDIO],
        env: {}
      })
    ) as { id: string };
    harness.core.audit.store.setQuarantine(server.id, "test");

    const smuggled = await call(client, "delete_server", { id: `${server.id}/quarantine` });
    expect(smuggled.isError).toBe(true);
    const after = payload(await call(client, "get_server", { id: server.id })) as { status: string };
    expect(after.status).toBe("quarantined");
    await client.close();
  });

  test("refuses to change the runtime path or the audit interval", async () => {
    const client = await adminClient();
    expect((await call(client, "update_settings", { runtimePath: "/tmp/evil" })).isError).toBe(true);
    expect((await call(client, "update_settings", { auditIntervalHours: 720 })).isError).toBe(true);
    await client.close();
  });

  test("refuses to switch itself off", async () => {
    const client = await adminClient();
    const result = await call(client, "update_settings", { adminMcp: false });
    expect(result.isError).toBe(true);
    const settings = payload(await call(client, "get_settings")) as { adminMcp: boolean };
    expect(settings.adminMcp).toBe(true);
    await client.close();
  });

  test("writes every call to the request log", async () => {
    const client = await adminClient();
    await call(client, "list_servers");
    const missing = await call(client, "get_server", { id: crypto.randomUUID() });
    expect(missing.isError).toBe(true);
    await client.close();

    const rows = harness.core.db.select().from(requestLog).orderBy(desc(requestLog.ts)).all();
    const listed = rows.find((row) => row.tool === "list_servers");
    expect(listed?.endpointId).toBeNull();
    expect(listed?.method).toBe("tools/call");
    expect(listed?.status).toBe("ok");

    const failed = rows.find((row) => row.tool === "get_server");
    expect(failed?.status).toBe("error");
    expect(failed?.errorCode).toBe("tool_error");
  });

  test("exposes the gateway state as resources", async () => {
    const client = await adminClient();
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain("junctio://health");

    const read = await client.readResource({ uri: "junctio://health" });
    const first = read.contents[0];
    expect(first?.mimeType).toBe("application/json");
    expect(first && "text" in first).toBe(true);
    const health = JSON.parse(first && "text" in first ? first.text : "{}") as { version: string };
    expect(health.version).toBe(harness.core.config.version);
    await client.close();
  });
});

describe("management mcp over oauth", () => {
  let oauthHarness: Harness;

  function pkce(): { verifier: string; challenge: string } {
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const digest = new Bun.CryptoHasher("sha256").update(verifier).digest();
    return { verifier, challenge: Buffer.from(digest).toString("base64url") };
  }

  async function grant(resource: string): Promise<string> {
    const registration = await fetch(`${harness.url}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        client_name: "Claude",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"]
      })
    });
    const client = (await registration.json()) as { client_id: string };
    const { verifier, challenge } = pkce();

    const url = new URL(`${harness.url}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", "xyz");
    url.searchParams.set("resource", resource);
    const authorized = await fetch(url, { redirect: "manual" });
    const requestId = new URL(authorized.headers.get("location") ?? "", harness.url).searchParams.get("request") ?? "";

    const approved = (await (await api(`/v1/oauth/requests/${requestId}/approve`, { method: "POST" })).json()) as {
      redirectUrl: string;
    };
    const code = new URL(approved.redirectUrl).searchParams.get("code") ?? "";

    const issued = await fetch(`${harness.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        code_verifier: verifier,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        resource
      })
    });
    const tokens = (await issued.json()) as { access_token: string };
    return tokens.access_token;
  }

  beforeEach(async () => {
    await harness.stop();
    oauthHarness = await startHarness({ withBaseUrl: true, env: { JUNCTIO_ADMIN_TOKEN: ADMIN_TOKEN } });
    harness = oauthHarness;
    await api("/v1/session/setup", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ password: "supersecret" })
    });
    await enable();
  });

  test("publishes its discovery documents once it is on", async () => {
    const resource = (await (await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/_admin`)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(`${harness.url}/mcp/_admin`);
    expect(resource.authorization_servers).toEqual([harness.url]);

    expect((await fetch(`${harness.url}/.well-known/oauth-authorization-server/mcp/_admin`)).status).toBe(200);
    expect((await fetch(`${harness.url}/.well-known/oauth-authorization-server`)).status).toBe(200);

    await enable(false);
    expect((await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/_admin`)).status).toBe(404);
  });

  test("points an unauthenticated client at the resource metadata", async () => {
    const response = await rawCall(null, initialize);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `${harness.url}/.well-known/oauth-protected-resource/mcp/_admin`
    );
  });

  test("accepts a token granted for the management server", async () => {
    const access = await grant(`${harness.url}/mcp/_admin`);
    const client = await connectClient(`${harness.url}/mcp/_admin`, access);
    const { tools } = await client.listTools();
    expect(tools.map((tool: Tool) => tool.name)).toContain("list_servers");
    await client.close();
  }, 30_000);

  test("rejects a token granted for another resource", async () => {
    const access = await grant(`${harness.url}/mcp/team`);
    expect((await rawCall(access, initialize)).status).toBe(401);
  }, 30_000);
});

describe("installing from the registry", () => {
  let registryHarness: Harness;

  beforeEach(async () => {
    await harness.stop();
    const fetchImpl = (async (input: Request | string | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/v0.1/servers/")) {
        const name = decodeURIComponent(url.split("/v0.1/servers/")[1]?.split("/")[0] ?? "");
        const entry = (registryList as { servers: { server: { name: string } }[] }).servers.find(
          (item) => item.server.name === name
        );
        if (!entry) return new Response(JSON.stringify({ title: "not found" }), { status: 404 });
        return new Response(JSON.stringify(entry), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(registryList), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    registryHarness = await startHarness({ env: { JUNCTIO_ADMIN_TOKEN: ADMIN_TOKEN }, fetchImpl });
    harness = registryHarness;
    await api("/v1/session/setup", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ password: "supersecret" })
    });
    await enable();
  });

  test("creates a server from a registry entry with the values the agent supplies", async () => {
    const client = await adminClient();

    const detail = payload(await call(client, "get_registry_server", { name: "io.github.j0hanz/filesystem-mcp" })) as {
      options: { id: string; kind: string; supported: boolean }[];
    };
    const npm = detail.options.find((option) => option.kind === "npm");
    expect(npm?.supported).toBe(true);

    const created = payload(
      await call(client, "install_registry_server", {
        name: "io.github.j0hanz/filesystem-mcp",
        optionId: npm?.id,
        serverName: "files",
        args: ["-y", "@j0hanz/filesystem-mcp@2.2.0", "/tmp"],
        env: { FS_ALLOWED_DIRS: "/tmp" }
      })
    ) as { id: string; name: string; runtime: string; args: string[]; env: Record<string, string> };

    expect(created.name).toBe("files");
    expect(created.runtime).toBe("npx");
    expect(created.args).toEqual(["-y", "@j0hanz/filesystem-mcp@2.2.0", "/tmp"]);
    expect(created.env.FS_ALLOWED_DIRS).toBe("***");

    const resolved = await harness.core.registry.resolve(created.id);
    expect(resolved?.env.FS_ALLOWED_DIRS).toBe("/tmp");
    expect(resolved?.row.envEnc).toBeTruthy();

    await client.close();
  });

  test("explains why an option cannot be installed", async () => {
    const client = await adminClient();

    const detail = payload(
      await call(client, "get_registry_server", { name: "io.github.dotnetmcp/nuget-filesystem" })
    ) as { options: { id: string; supported: boolean }[] };
    const blocked = detail.options.find((option) => !option.supported);
    expect(blocked).toBeDefined();

    const refused = await call(client, "install_registry_server", {
      name: "io.github.dotnetmcp/nuget-filesystem",
      optionId: blocked?.id
    });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain("dotnet toolchain");

    const unknown = await call(client, "install_registry_server", {
      name: "io.github.j0hanz/filesystem-mcp",
      optionId: "package:99"
    });
    expect(unknown.isError).toBe(true);
    expect(errorText(unknown)).toContain("Known options");

    await client.close();
  });
});
