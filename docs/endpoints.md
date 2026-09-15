# Endpoints

## Aggregation

Tools from an upstream are exposed as `<prefix>__<tool>`. The prefix defaults to the server name and is set per namespace membership; the separator is global. Name collisions are rejected when you save the configuration, not at request time. Per namespace you can hide a tool, rename it, rewrite its description or add annotations.

Resources are prefixed in the URI scheme, so `mock://readme` from a server prefixed `alpha` becomes `alpha+mock://readme`.

A dead upstream does not take the rest down. `tools/list` queries every server in parallel with a five second per-server timeout and returns what it has.

## Authentication

An endpoint accepts `none`, `api_key`, `oauth` or `any`.

API keys are sent as `Authorization: Bearer jn_...` or `X-API-Key`. Only an argon2id hash is stored and the key is shown once. A key can be bound to a single endpoint. The query parameter form is off unless you enable it for clients that cannot send headers.

An endpoint can cap requests per minute. The budget is counted per API key, or per client address when the endpoint needs no key, and a request over the limit gets a 429 with `Retry-After`. Zero means no limit.

**The gateway is its own authorization server.** You do not need an identity provider. Set `JUNCTIO_BASE_URL`, switch an endpoint to OAuth, and a browser client can connect: the gateway publishes RFC 8414 metadata, accepts RFC 7591 dynamic client registration, runs authorization code with PKCE and issues its own tokens. This is what claude.ai and Claude Desktop connectors need, because they cannot send an API key header.

Every authorization stops at a consent screen that requires the admin password. Registering a client grants nothing on its own. Access tokens live one hour, refresh tokens thirty days and rotate on every use, and a client secret never expires. Revoke a client from Settings and its tokens die with it.

If you already run Keycloak, Authentik, Auth0 or similar, set `JUNCTIO_OAUTH_ISSUER` instead. The gateway then stops being an authorization server and validates your provider's JWTs against its JWKS, checking that the audience matches the endpoint URL.

Either way the discovery documents under `/.well-known/` are served **only** for endpoints whose auth mode includes OAuth, and for [the management server](management-mcp.md) when it is switched on; anything else returns 404. A 401 always carries a correct `WWW-Authenticate` header with the resource metadata URL.

## Protocol

Streamable HTTP, stateless: no `Mcp-Session-Id`, no session state to lose across restarts. The gateway speaks both protocol eras on the same URL. A `2026-07-28` client sends its version and capabilities in `_meta` on every request and never calls `initialize`; a `2025-11-25` or `2025-06-18` client gets the classic handshake, served per request. The check runs on the `initialize` body and on the `MCP-Protocol-Version` header.

Each endpoint declares the oldest revision it accepts, and a new one accepts **`2026-07-28` only**. That refuses the handshake era outright, which is what a modern-only client fleet wants; a client stuck on an older revision gets `-32022 Unsupported protocol version` naming the revisions the endpoint does accept. Every refusal is logged, and the endpoint page lists the revisions its clients actually spoke and warns when it is turning someone away, so lowering the minimum is an informed decision rather than a guess.

Upstreams are negotiated the same way. The gateway probes each server once with `server/discover`, talks `2026-07-28` to servers that answer, and falls back to `initialize` for everything else. A stdio server that dies on the probe is respawned and spoken to as legacy from then on; the verdict is cached for a day and dropped when the server config changes. The negotiated revision is shown on the server page and in the connection test.

Legacy SSE is never exposed; it is spoken only to upstreams configured as `sse`. `Origin` is checked on every POST. JSON-RPC batching is not supported, matching the specification.

## Client compatibility

Verified by hand before each release.

| Client | Version | Status |
|---|---|---|
| Claude Code | | pending |
| Codex | | pending |
| Cursor | | pending |
| claude.ai connector | | implemented, not yet verified against the live service |
