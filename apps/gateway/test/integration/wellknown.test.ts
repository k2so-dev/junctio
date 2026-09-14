import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seedEndpoint, seedNamespace, seedStdioServer, startHarness, type Harness } from "../helpers.ts";
import { startMockAs, type MockAs } from "../fixtures/mock-as.ts";
import { RemoteJwtVerifier } from "../../src/auth/downstream/jwt.ts";

let harness: Harness;
let as: MockAs;

beforeEach(async () => {
  as = await startMockAs();
  harness = await startHarness({
    env: { JUNCTIO_OAUTH_ISSUER: as.issuer, JUNCTIO_BASE_URL: "http://127.0.0.1:9999" },
    verifier: new RemoteJwtVerifier(as.issuer)
  });
});

afterEach(async () => {
  await harness.stop();
  await as.stop();
});

function makeEndpoint(slug: string, authMode: "none" | "api_key" | "oauth" | "any") {
  const serverId = seedStdioServer(harness.core, { name: slug });
  const namespaceId = seedNamespace(harness.core, slug, [{ serverId }]);
  return seedEndpoint(harness.core, { slug, namespaceId, authMode });
}

describe("protected resource metadata", () => {
  test("returns 404 for an api key only endpoint", async () => {
    makeEndpoint("keyonly", "api_key");
    const response = await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/keyonly`);
    expect(response.status).toBe(404);
  });

  test("returns 404 for an endpoint without auth", async () => {
    makeEndpoint("open", "none");
    const response = await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/open`);
    expect(response.status).toBe(404);
  });

  test("returns 404 for an unknown endpoint", async () => {
    const response = await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/missing`);
    expect(response.status).toBe(404);
  });

  test("serves metadata for an oauth endpoint", async () => {
    makeEndpoint("secured", "oauth");
    const response = await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/secured`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe("http://127.0.0.1:9999/mcp/secured");
    expect(body.authorization_servers).toEqual([as.issuer]);
  });

  test("serves metadata for an endpoint accepting any credential", async () => {
    makeEndpoint("mixed", "any");
    const response = await fetch(`${harness.url}/.well-known/oauth-protected-resource/mcp/mixed`);
    expect(response.status).toBe(200);
  });

  test("proxies authorization server metadata only for oauth endpoints", async () => {
    makeEndpoint("keyonly", "api_key");
    expect((await fetch(`${harness.url}/.well-known/oauth-authorization-server/mcp/keyonly`)).status).toBe(404);
    makeEndpoint("secured", "oauth");
    const response = await fetch(`${harness.url}/.well-known/oauth-authorization-server/mcp/secured`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { issuer: string };
    expect(body.issuer).toBe(as.issuer);
  });
});

describe("oauth resource server mode", () => {
  test("rejects a request without a token and advertises resource metadata", async () => {
    makeEndpoint("secured", "oauth");
    const response = await fetch(`${harness.url}/mcp/secured`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('resource_metadata="http://127.0.0.1:9999/.well-known/oauth-protected-resource/mcp/secured"');
  });

  test("accepts a valid token with the endpoint audience", async () => {
    makeEndpoint("secured", "oauth");
    const token = await as.mintAccessToken({ audience: "http://127.0.0.1:9999/mcp/secured" });
    const response = await fetch(`${harness.url}/mcp/secured`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }
      })
    });
    expect(response.status).toBe(200);
  });

  test("rejects a token minted for another audience", async () => {
    makeEndpoint("secured", "oauth");
    const token = await as.mintAccessToken({ audience: "http://127.0.0.1:9999/mcp/other" });
    const response = await fetch(`${harness.url}/mcp/secured`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(401);
  });

  test("rejects an expired token", async () => {
    makeEndpoint("secured", "oauth");
    const token = await as.mintAccessToken({ audience: "http://127.0.0.1:9999/mcp/secured", ttlSec: -10 });
    const response = await fetch(`${harness.url}/mcp/secured`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(401);
  });

  test("accepts either credential when the endpoint allows any", async () => {
    const endpointId = makeEndpoint("mixed", "any");
    const { createApiKey } = await import("../../src/auth/downstream/apikey.ts");
    const { token: apiKey } = await createApiKey(harness.core.db, { name: "k", endpointId, expiresAt: null });
    const jwt = await as.mintAccessToken({ audience: "http://127.0.0.1:9999/mcp/mixed" });
    for (const credential of [apiKey, jwt]) {
      const response = await fetch(`${harness.url}/mcp/mixed`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${credential}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }
        })
      });
      expect(response.status).toBe(200);
    }
  });
});
