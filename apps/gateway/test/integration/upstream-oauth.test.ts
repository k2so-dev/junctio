import { afterEach, describe, expect, test } from "bun:test";
import {
  connectClient,
  seedApiKey,
  seedEndpoint,
  seedHttpServer,
  seedNamespace,
  startHarness,
  type Harness
} from "../helpers.ts";
import { startMockAs, type MockAs } from "../fixtures/mock-as.ts";
import { startMockHttpMcp, type MockHttpMcp } from "../fixtures/mock-http-mcp.ts";
import { needsRefresh, refreshWindowMs } from "../../src/auth/upstream/refresher.ts";

let harness: Harness;
let as: MockAs;
let upstream: MockHttpMcp;

async function setupOauthServer(options: { ttlSec?: number; refreshIntervalMs?: number } = {}) {
  as = await startMockAs({ ttlSec: options.ttlSec ?? 3600, requirePkce: true });
  upstream = await startMockHttpMcp({ issuer: as.issuer, name: "remote" });
  harness = await startHarness({
    withBaseUrl: true,
    ...(options.refreshIntervalMs ? { refreshIntervalMs: options.refreshIntervalMs } : {})
  });
  const serverId = await seedHttpServer(harness.core, { name: "remote", url: upstream.url, authMode: "oauth" });
  const namespaceId = seedNamespace(harness.core, "ns", [{ serverId }]);
  const endpointId = seedEndpoint(harness.core, { slug: "gw", namespaceId });
  const token = await seedApiKey(harness.core, endpointId);
  return { serverId, token, url: `${harness.url}/mcp/gw` };
}

async function until(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the expected state");
    await Bun.sleep(25);
  }
}

async function authorize(serverId: string): Promise<void> {
  const flow = harness.core.upstreamAuth.flow;
  if (!flow) throw new Error("flow is not configured");
  const authorizationUrl = await flow.start(serverId);
  const redirect = await fetch(authorizationUrl, { redirect: "manual" });
  const location = redirect.headers.get("location");
  if (!location) throw new Error("authorization endpoint did not redirect");
  const callback = await fetch(location);
  if (!callback.ok) throw new Error(`callback failed with ${callback.status}`);
}

afterEach(async () => {
  await harness?.stop();
  await upstream?.stop();
  await as?.stop();
});

describe("upstream oauth flow", () => {
  test("registers a client, completes pkce authorization and stores tokens", async () => {
    const { serverId } = await setupOauthServer();
    await authorize(serverId);

    expect(as.counts.register).toBe(1);
    expect(as.counts.authorize).toBe(1);
    const params = as.lastTokenParams;
    expect(params?.get("grant_type")).toBe("authorization_code");
    expect(params?.get("code_verifier")).toBeTruthy();
    expect(params?.get("resource")).toBe(`${upstream.url}`);

    const state = await harness.core.upstreamAuth.store.read(serverId);
    expect(state?.status).toBe("ok");
    expect(state?.tokens?.accessToken).toBeTruthy();
    expect(state?.tokens?.refreshToken).toBeTruthy();
    expect(state?.client?.clientId).toBe("client_1");
  }, 20_000);

  test("stores the refresh token encrypted at rest", async () => {
    const { serverId } = await setupOauthServer();
    await authorize(serverId);
    const row = harness.core.upstreamAuth.store.row(serverId);
    expect(row?.refreshTokenEnc?.startsWith("v2.")).toBe(true);
    expect(row?.refreshTokenEnc).not.toContain("rt_");
    expect(row?.accessTokenEnc).not.toContain("eyJ");
  }, 20_000);

  test("proxies tool calls with the upstream access token", async () => {
    const { serverId, token, url } = await setupOauthServer();
    await authorize(serverId);
    const client = await connectClient(url, token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["remote__ping"]);
    const result = await client.callTool({ name: "remote__ping", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "pong" }]);
    expect(upstream.counts.unauthorized).toBe(0);
    await client.close();
  }, 20_000);

  test("marks the server as needing re-auth when no token is stored", async () => {
    const { token, url } = await setupOauthServer();
    const client = await connectClient(url, token);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(0);
    expect(upstream.counts.unauthorized).toBeGreaterThan(0);
    await client.close();
  }, 20_000);

  test("reports no_refresh when the upstream withholds a refresh token", async () => {
    const { serverId } = await setupOauthServer();
    as.setIssueRefreshToken(false);
    await authorize(serverId);
    const state = await harness.core.upstreamAuth.store.read(serverId);
    expect(state?.status).toBe("no_refresh");
    expect(state?.tokens?.refreshToken).toBeNull();
  }, 20_000);
});

describe("token refresh", () => {
  test("keeps a short lived token alive across many calls without a single client error", async () => {
    const { serverId, token, url } = await setupOauthServer({ ttlSec: 5 });
    await authorize(serverId);
    const client = await connectClient(url, token);

    const calls = 40;
    const spacing = 300;
    let failures = 0;
    for (let i = 0; i < calls; i++) {
      try {
        const result = await client.callTool({ name: "remote__ping", arguments: {} });
        if (result.isError) failures += 1;
      } catch {
        failures += 1;
      }
      if (i < calls - 1) await Bun.sleep(spacing);
    }
    await client.close();

    expect(failures).toBe(0);
    expect(upstream.counts.unauthorized).toBe(0);
    expect(upstream.counts.toolCalls).toBe(calls);
    expect(as.counts.refresh).toBeGreaterThanOrEqual(2);
  }, 60_000);

  test("collapses concurrent refreshes into a single token request", async () => {
    const { serverId, token, url } = await setupOauthServer({ ttlSec: 2 });
    await authorize(serverId);
    const before = as.counts.refresh;
    const state = await harness.core.upstreamAuth.store.read(serverId);
    await until(() => (state?.tokens?.expiresAt ?? 0) - Date.now() <= refreshWindowMs(2));

    const client = await connectClient(url, token);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => client.callTool({ name: "remote__ping", arguments: {} }))
    );
    expect(results.every((result) => !result.isError)).toBe(true);
    expect(as.counts.refresh - before).toBe(1);
    expect(upstream.counts.unauthorized).toBe(0);
    await client.close();
  }, 30_000);

  test("refreshes reactively on a 401 and retries the request once", async () => {
    const { serverId, token, url } = await setupOauthServer({ ttlSec: 3600 });
    await authorize(serverId);

    const state = await harness.core.upstreamAuth.store.read(serverId);
    const expired = await as.mintAccessToken({ ttlSec: -60 });
    await harness.core.upstreamAuth.store.saveTokens(
      serverId,
      {
        accessToken: expired,
        refreshToken: state?.tokens?.refreshToken ?? null,
        expiresAt: Date.now() + 3_600_000,
        ttlSec: 3600,
        scope: null
      },
      "ok"
    );

    const before = as.counts.refresh;
    const client = await connectClient(url, token);
    const result = await client.callTool({ name: "remote__ping", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "pong" }]);
    expect(as.counts.refresh - before).toBe(1);
    expect(upstream.counts.unauthorized).toBeGreaterThan(0);
    await client.close();
  }, 30_000);

  test("stops retrying and flags needs_reauth when the refresh token is revoked", async () => {
    const { serverId, token, url } = await setupOauthServer({ ttlSec: 3600 });
    await authorize(serverId);

    const state = await harness.core.upstreamAuth.store.read(serverId);
    const refreshToken = state?.tokens?.refreshToken ?? "";
    as.activeRefreshTokens.delete(refreshToken);
    as.revoked.add(refreshToken);
    const expired = await as.mintAccessToken({ ttlSec: -60 });
    await harness.core.upstreamAuth.store.saveTokens(
      serverId,
      { accessToken: expired, refreshToken, expiresAt: Date.now() + 3_600_000, ttlSec: 3600, scope: null },
      "ok"
    );

    const client = await connectClient(url, token);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(0);
    const after = await harness.core.upstreamAuth.store.read(serverId);
    expect(after?.status).toBe("needs_reauth");
    expect(as.counts.refresh).toBeLessThanOrEqual(3);
    await client.close();
  }, 30_000);

  test("refreshes proactively from the scheduler without any traffic", async () => {
    const { serverId } = await setupOauthServer({ ttlSec: 4, refreshIntervalMs: 300 });
    await authorize(serverId);
    harness.core.upstreamAuth.start();
    const before = as.counts.refresh;
    await until(() => as.counts.refresh > before);
    harness.core.upstreamAuth.stop();
    expect(as.counts.refresh - before).toBeGreaterThanOrEqual(1);
    const state = await harness.core.upstreamAuth.store.read(serverId);
    expect(state?.status).toBe("ok");
    expect(state?.tokens?.expiresAt ?? 0).toBeGreaterThan(Date.now());
  }, 30_000);

  test("rotates the stored refresh token on every refresh", async () => {
    const { serverId } = await setupOauthServer({ ttlSec: 3600 });
    await authorize(serverId);
    const first = await harness.core.upstreamAuth.store.read(serverId);
    await harness.core.upstreamAuth.refresher.refresh(serverId);
    const second = await harness.core.upstreamAuth.store.read(serverId);
    expect(second?.tokens?.refreshToken).not.toBe(first?.tokens?.refreshToken);
    expect(as.revoked.has(first?.tokens?.refreshToken ?? "")).toBe(true);
    expect(second?.status).toBe("ok");
  }, 20_000);
});

describe("refresh window", () => {
  test("uses one fifth of a short ttl", () => {
    expect(refreshWindowMs(5)).toBe(1_000);
    expect(refreshWindowMs(600)).toBe(120_000);
  });

  test("uses at least five minutes for a long ttl", () => {
    expect(refreshWindowMs(1800)).toBe(360_000);
    expect(refreshWindowMs(900)).toBe(300_000);
    expect(refreshWindowMs(3600)).toBe(720_000);
  });

  test("treats a missing ttl as five minutes", () => {
    expect(refreshWindowMs(null)).toBe(300_000);
  });

  test("flags a token inside the window", () => {
    const base = {
      serverId: "s",
      issuer: null,
      authorizationServerUrl: null,
      client: null,
      resource: null,
      asMetadata: null,
      status: "ok" as const,
      lastRefreshAt: null,
      lastError: null
    };
    expect(
      needsRefresh({
        ...base,
        tokens: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 500, ttlSec: 5, scope: null }
      })
    ).toBe(true);
    expect(
      needsRefresh({
        ...base,
        tokens: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 4_000, ttlSec: 5, scope: null }
      })
    ).toBe(false);
    expect(needsRefresh({ ...base, tokens: null })).toBe(false);
  });
});
