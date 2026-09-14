import { SignJWT, exportJWK, generateKeyPair, type JWK, type CryptoKey } from "jose";

export type MockAsOptions = {
  ttlSec?: number;
  issueRefreshToken?: boolean;
  rotateRefreshToken?: boolean;
  requireResource?: boolean;
  requirePkce?: boolean;
};

export type MockAs = {
  url: string;
  issuer: string;
  counts: { token: number; refresh: number; register: number; authorize: number; metadata: number };
  lastTokenParams: URLSearchParams | null;
  revoked: Set<string>;
  activeRefreshTokens: Set<string>;
  mintAccessToken(options?: { audience?: string; subject?: string; scope?: string; ttlSec?: number }): Promise<string>;
  issueInitialTokens(options?: { resource?: string; scope?: string }): Promise<{
    access_token: string;
    refresh_token: string | null;
  }>;
  setTtl(seconds: number): void;
  setIssueRefreshToken(value: boolean): void;
  failNextRefresh(times?: number): void;
  stop(): Promise<void>;
};

export async function startMockAs(options: MockAsOptions = {}): Promise<MockAs> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey as CryptoKey)), kid: "test-key", alg: "RS256", use: "sig" };

  let ttlSec = options.ttlSec ?? 3600;
  let issueRefreshToken = options.issueRefreshToken ?? true;
  const rotate = options.rotateRefreshToken ?? true;
  let failRefreshTimes = 0;

  const counts = { token: 0, refresh: 0, register: 0, authorize: 0, metadata: 0 };
  const revoked = new Set<string>();
  const activeRefreshTokens = new Set<string>();
  const codes = new Map<string, { resource: string | null; scope: string | null }>();
  let lastTokenParams: URLSearchParams | null = null;
  let issuer = "";

  const mintAccessToken: MockAs["mintAccessToken"] = async (opts = {}) => {
    return new SignJWT({ scope: opts.scope ?? "mcp", client_id: "test-client" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setSubject(opts.subject ?? "user-1")
      .setAudience(opts.audience ?? `${issuer}/resource`)
      .setIssuedAt()
      .setExpirationTime(`${opts.ttlSec ?? ttlSec}s`)
      .sign(privateKey as CryptoKey);
  };

  function newRefreshToken(): string {
    const token = `rt_${crypto.randomUUID()}`;
    activeRefreshTokens.add(token);
    return token;
  }

  async function tokenResponse(resource: string | null, scope: string | null): Promise<Response> {
    const access = await mintAccessToken({ audience: resource ?? undefined, scope: scope ?? undefined });
    const body: Record<string, unknown> = {
      access_token: access,
      token_type: "Bearer",
      expires_in: ttlSec,
      scope: scope ?? "mcp"
    };
    if (issueRefreshToken) body.refresh_token = newRefreshToken();
    return Response.json(body);
  }

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        counts.metadata += 1;
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          jwks_uri: `${issuer}/jwks.json`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["mcp", "offline_access"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"]
        });
      }

      if (url.pathname === "/jwks.json") return Response.json({ keys: [jwk] });

      if (url.pathname === "/register" && request.method === "POST") {
        counts.register += 1;
        const body = (await request.json()) as Record<string, unknown>;
        return Response.json(
          {
            client_id: `client_${counts.register}`,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            redirect_uris: body.redirect_uris ?? [],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"]
          },
          { status: 201 }
        );
      }

      if (url.pathname === "/authorize") {
        counts.authorize += 1;
        const redirectUri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state");
        if (options.requirePkce && url.searchParams.get("code_challenge_method") !== "S256") {
          return new Response("pkce required", { status: 400 });
        }
        const code = `code_${crypto.randomUUID()}`;
        codes.set(code, { resource: url.searchParams.get("resource"), scope: url.searchParams.get("scope") });
        const target = new URL(redirectUri ?? `${issuer}/callback`);
        target.searchParams.set("code", code);
        if (state) target.searchParams.set("state", state);
        return new Response(null, { status: 302, headers: { location: target.toString() } });
      }

      if (url.pathname === "/token" && request.method === "POST") {
        counts.token += 1;
        const params = new URLSearchParams(await request.text());
        lastTokenParams = params;
        const grant = params.get("grant_type");

        if (grant === "authorization_code") {
          const code = params.get("code") ?? "";
          const stored = codes.get(code);
          if (!stored) return Response.json({ error: "invalid_grant" }, { status: 400 });
          codes.delete(code);
          if (options.requirePkce && !params.get("code_verifier")) {
            return Response.json({ error: "invalid_request" }, { status: 400 });
          }
          if (options.requireResource && !params.get("resource")) {
            return Response.json({ error: "invalid_target" }, { status: 400 });
          }
          return tokenResponse(params.get("resource") ?? stored.resource, params.get("scope") ?? stored.scope);
        }

        if (grant === "refresh_token") {
          counts.refresh += 1;
          if (failRefreshTimes > 0) {
            failRefreshTimes -= 1;
            return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
          }
          const presented = params.get("refresh_token") ?? "";
          if (revoked.has(presented)) return Response.json({ error: "invalid_grant" }, { status: 400 });
          if (!activeRefreshTokens.has(presented)) return Response.json({ error: "invalid_grant" }, { status: 400 });
          if (rotate) {
            activeRefreshTokens.delete(presented);
            revoked.add(presented);
          }
          return tokenResponse(params.get("resource"), params.get("scope"));
        }

        return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
      }

      return new Response("not found", { status: 404 });
    }
  });

  issuer = `http://127.0.0.1:${server.port}`;

  return {
    url: issuer,
    issuer,
    counts,
    get lastTokenParams() {
      return lastTokenParams;
    },
    revoked,
    activeRefreshTokens,
    mintAccessToken,
    async issueInitialTokens(opts = {}) {
      const access = await mintAccessToken({ audience: opts.resource, scope: opts.scope });
      const refresh = issueRefreshToken ? newRefreshToken() : null;
      return { access_token: access, refresh_token: refresh };
    },
    setTtl(seconds) {
      ttlSec = seconds;
    },
    setIssueRefreshToken(value) {
      issueRefreshToken = value;
    },
    failNextRefresh(times = 1) {
      failRefreshTimes = times;
    },
    async stop() {
      await server.stop(true);
    }
  };
}
