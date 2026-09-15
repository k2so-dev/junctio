import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seedEndpoint, seedNamespace, seedStdioServer, startHarness, type Harness } from "../helpers.ts";

let harness: Harness;
let cookie = "";
let slug = "team";

function pkce(): { verifier: string; challenge: string } {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const digest = new Bun.CryptoHasher("sha256").update(verifier).digest();
  return { verifier, challenge: Buffer.from(digest).toString("base64url") };
}

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${harness.url}/api${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0] ?? cookie;
  return response;
}

async function register(overrides: Record<string, unknown> = {}): Promise<{ client_id: string; client_secret?: string }> {
  const response = await fetch(`${harness.url}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...overrides
    })
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string; client_secret?: string };
}

async function authorize(clientId: string, challenge: string, resource: string, state = "xyz"): Promise<string> {
  const url = new URL(`${harness.url}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("resource", resource);
  const response = await fetch(url, { redirect: "manual" });
  expect(response.status).toBe(302);
  return response.headers.get("location") ?? "";
}

async function token(body: Record<string, string>): Promise<Response> {
  return fetch(`${harness.url}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
}

async function grant(resourceSlug = slug): Promise<{ access: string; refresh: string; clientId: string }> {
  const client = await register();
  const { verifier, challenge } = pkce();
  const resource = `${harness.url}/mcp/${resourceSlug}`;
  const location = await authorize(client.client_id, challenge, resource);
  const requestId = new URL(location, harness.url).searchParams.get("request") ?? "";
  const approved = (await (await admin(`/v1/oauth/requests/${requestId}/approve`, { method: "POST" })).json()) as {
    redirectUrl: string;
  };
  const code = new URL(approved.redirectUrl).searchParams.get("code") ?? "";
  const response = await token({
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    code_verifier: verifier,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    resource
  });
  expect(response.status).toBe(200);
  const tokens = (await response.json()) as { access_token: string; refresh_token: string };
  return { access: tokens.access_token, refresh: tokens.refresh_token, clientId: client.client_id };
}

async function callMcp(accessToken: string | null, target = slug): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return fetch(`${harness.url}/mcp/${target}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } }
    })
  });
}

beforeEach(async () => {
  cookie = "";
  slug = "team";
  harness = await startHarness({ withBaseUrl: true });
  await admin("/v1/session/setup", { method: "POST", body: JSON.stringify({ password: "supersecret" }) });
  const serverId = await seedStdioServer(harness.core, { name: "alpha" });
  const namespaceId = seedNamespace(harness.core, "team", [{ serverId }]);
  seedEndpoint(harness.core, { slug: "team", namespaceId, authMode: "oauth" });
  seedEndpoint(harness.core, { slug: "other", namespaceId, authMode: "oauth" });
});

afterEach(async () => {
  await harness.stop();
});

describe("built-in authorization server", () => {
  test("advertises itself in the discovery documents", async () => {
    const resource = (await (await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/team`)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(`${harness.url}/mcp/team`);
    expect(resource.authorization_servers).toEqual([harness.url]);

    const meta = (await (await fetch(`${harness.url}/.well-known/oauth-authorization-server`)).json()) as {
      issuer: string;
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    expect(meta.issuer).toBe(harness.url);
    expect(meta.registration_endpoint).toBe(`${harness.url}/oauth/register`);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
  });

  test("registers a public client without a secret", async () => {
    const client = await register();
    expect(client.client_id.startsWith("jnc_")).toBe(true);
    expect(client.client_secret).toBeUndefined();
  });

  test("issues a client secret that never expires", async () => {
    const client = (await register({ token_endpoint_auth_method: "client_secret_post" })) as {
      client_id: string;
      client_secret?: string;
      client_secret_expires_at?: number;
    };
    expect(client.client_secret).toBeTruthy();
    expect(client.client_secret_expires_at).toBe(0);
  });

  test("runs the whole flow and accepts the token on the endpoint", async () => {
    const { access } = await grant();
    const response = await callMcp(access);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("junctio");
  }, 30_000);

  test("sends an unauthenticated caller to the resource metadata", async () => {
    const response = await callMcp(null);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `${harness.url}/.well-known/oauth-protected-resource/mcp/team`
    );
  });

  test("rejects a token issued for another endpoint", async () => {
    const { access } = await grant("other");
    const response = await callMcp(access, "team");
    expect(response.status).toBe(401);
  }, 30_000);

  test("refuses to authorize without a resource", async () => {
    const client = await register();
    const { challenge } = pkce();
    const url = new URL(`${harness.url}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", "xyz");
    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "", harness.url);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("error_description")).toContain("resource");
  });

  test("keeps an endpoint token away from the management server", async () => {
    const { access } = await grant("team");
    const response = await fetch(`${harness.url}/mcp/_admin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${access}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).not.toBe(200);
  }, 30_000);

  test("rejects a wrong pkce verifier", async () => {
    const client = await register();
    const { challenge } = pkce();
    const resource = `${harness.url}/mcp/team`;
    const location = await authorize(client.client_id, challenge, resource);
    const requestId = new URL(location, harness.url).searchParams.get("request") ?? "";
    const approved = (await (await admin(`/v1/oauth/requests/${requestId}/approve`, { method: "POST" })).json()) as {
      redirectUrl: string;
    };
    const code = new URL(approved.redirectUrl).searchParams.get("code") ?? "";
    const response = await token({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      code_verifier: pkce().verifier,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback"
    });
    expect(response.status).toBe(400);
  });

  test("burns the authorization code after one exchange", async () => {
    const client = await register();
    const { verifier, challenge } = pkce();
    const resource = `${harness.url}/mcp/team`;
    const location = await authorize(client.client_id, challenge, resource);
    const requestId = new URL(location, harness.url).searchParams.get("request") ?? "";
    const approved = (await (await admin(`/v1/oauth/requests/${requestId}/approve`, { method: "POST" })).json()) as {
      redirectUrl: string;
    };
    const code = new URL(approved.redirectUrl).searchParams.get("code") ?? "";
    const body = {
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      code_verifier: verifier,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      resource
    };
    expect((await token(body)).status).toBe(200);
    expect((await token(body)).status).toBe(400);
  });

  test("rotates the refresh token and retires the old one", async () => {
    const { refresh, clientId } = await grant();
    const first = await token({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
    expect(first.status).toBe(200);
    const rotated = (await first.json()) as { access_token: string; refresh_token: string };
    expect(rotated.refresh_token).not.toBe(refresh);

    const replay = await token({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
    expect(replay.status).toBe(400);

    expect((await callMcp(rotated.access_token)).status).toBe(200);
  }, 30_000);

  test("denying the request sends an error back to the client", async () => {
    const client = await register();
    const { challenge } = pkce();
    const location = await authorize(client.client_id, challenge, `${harness.url}/mcp/team`);
    const requestId = new URL(location, harness.url).searchParams.get("request") ?? "";
    const denied = (await (await admin(`/v1/oauth/requests/${requestId}/deny`, { method: "POST" })).json()) as {
      redirectUrl: string;
    };
    const url = new URL(denied.redirectUrl);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("xyz");
  });

  test("requires an admin session to read or approve a request", async () => {
    const client = await register();
    const { challenge } = pkce();
    const location = await authorize(client.client_id, challenge, `${harness.url}/mcp/team`);
    const requestId = new URL(location, harness.url).searchParams.get("request") ?? "";
    expect((await fetch(`${harness.url}/api/v1/oauth/requests/${requestId}`)).status).toBe(401);
    const approve = await fetch(`${harness.url}/api/v1/oauth/requests/${requestId}/approve`, { method: "POST" });
    expect(approve.status).toBe(401);
  });

  test("revoking a client invalidates its tokens", async () => {
    const { access, clientId } = await grant();
    expect((await callMcp(access)).status).toBe(200);

    const removed = await admin(`/v1/oauth/clients/${clientId}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect((await callMcp(access)).status).toBe(401);

    const listed = (await (await admin("/v1/oauth/clients")).json()) as unknown[];
    expect(listed).toHaveLength(0);
  }, 30_000);
});
