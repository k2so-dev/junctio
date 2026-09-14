# junctio

Self-hosted MCP gateway for one developer or a small team. One container, one volume, one endpoint per client.

The promise: **auth does not go stale.** Not between your client and the gateway, and not between the gateway and its upstreams.

- **No telemetry.** Nothing leaves your machine. There is no phone-home, no analytics, no update ping.
- **One endpoint per client.** Point Claude Code, Codex or Cursor at a single URL and manage the servers behind it from a web UI.
- **Upstream OAuth that survives.** Tokens are refreshed proactively on a schedule, not after a request already failed.

## Status

Early. The gateway, aggregation, API key auth, OAuth resource server mode, upstream OAuth and the REST API are implemented and tested. The web UI and the Docker image are in progress.

## Quickstart

```bash
JUNCTIO_SECRET=$(openssl rand -hex 32) JUNCTIO_DATA_DIR=./data bun run start
```

Open `http://localhost:3000`, set an admin password, then:

1. Add a server. For a package on npm pick the `npx` runtime and type the package name. The form previews the exact command.
2. Create a namespace and put the server in it.
3. Create an endpoint pointing at that namespace and issue an API key.
4. Paste the snippet into your client.

```bash
claude mcp add --transport http junctio https://mcp.example.com/mcp/main \
  --header "Authorization: Bearer jn_..."
```

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `JUNCTIO_SECRET` | yes | Key used to encrypt stored tokens and headers. The process refuses to start without it. |
| `JUNCTIO_BASE_URL` | for OAuth | Public URL of the gateway. Redirect URIs and resource identifiers are built from it. |
| `JUNCTIO_ADMIN_TOKEN` | no | Bearer token for headless admin access, as an alternative to the password login. |
| `JUNCTIO_OAUTH_ISSUER` | no | Issuer URL of your identity provider. Enables OAuth resource server mode. |
| `JUNCTIO_OAUTH_AUDIENCE` | no | Override the expected audience. Defaults to the endpoint URL. |
| `JUNCTIO_DATA_DIR` | no | Where `junctio.db` lives. Defaults to `/data`. |
| `PORT` / `HOST` | no | Listener. Defaults to `3000` and `0.0.0.0`. |
| `LOG_LEVEL` | no | `debug`, `info`, `warn` or `error`. Defaults to `info`. |

**OAuth does not work without TLS.** Browsers and MCP clients will refuse the redirects. Terminate TLS in front of the gateway. See `docs/caddy.md`.

## Upstream servers

A server is either `stdio` or `http`.

For stdio the `runtime` field decides how the command is assembled:

| Runtime | Resulting command |
|---|---|
| `npx` | `npx -y <package> <args>` |
| `bunx` | `bunx <package> <args>` |
| `uvx` | `uvx <package> <args>` |
| `node` | `node <script> <args>` |
| `uv` | `uv run <args>` |
| `custom` | `<command> <args>` |

There is no aliasing between runtimes. The environment handed to a child process is built explicitly: the `PATH` from settings, `HOME`, and the variables you configured. Nothing else is inherited, and `JUNCTIO_*` variables are never passed down.

For HTTP the gateway speaks Streamable HTTP. The auth mode is `none`, `header` for a static token, or `oauth` for the full client flow.

## Aggregation

Tools from an upstream are exposed as `<prefix>__<tool>`. The prefix defaults to the server name and is set per namespace membership; the separator is global. Name collisions are rejected when you save the configuration, not at request time. Per namespace you can hide a tool, rename it, rewrite its description or add annotations.

Resources are prefixed in the URI scheme, so `mock://readme` from a server prefixed `alpha` becomes `alpha+mock://readme`.

A dead upstream does not take the rest down. `tools/list` queries every server in parallel with a five second per-server timeout and returns what it has.

## Auth, downstream

An endpoint accepts `none`, `api_key`, `oauth` or `any`.

API keys are sent as `Authorization: Bearer jn_...` or `X-API-Key`. Only an argon2id hash is stored and the key is shown once. A key can be bound to a single endpoint. The query parameter form is off unless you enable it for clients that cannot send headers.

In OAuth resource server mode the gateway validates JWTs against your identity provider's JWKS and checks that the audience matches the endpoint URL. The discovery documents under `/.well-known/` are served **only** for endpoints whose auth mode includes OAuth; anything else returns 404. A 401 always carries a correct `WWW-Authenticate` header with the resource metadata URL.

## Auth, upstream

This is the other half of the promise. For an upstream with `auth_mode: oauth` the gateway runs the full client flow: RFC 9728 discovery, RFC 8414 metadata, dynamic client registration when there is no client ID, PKCE, and a callback on `/oauth/upstream/callback/:server_id`. The `resource` parameter is sent on both the authorize and the token request.

After that:

- **Proactive refresh.** A scheduler checks every minute and refreshes before expiry. The window is one fifth of the token lifetime, and at least five minutes for tokens that live longer than ten minutes.
- **Reactive refresh.** A 401 from an upstream triggers one refresh and one retry. A second 401 sets the server to `needs_reauth` instead of looping.
- **Single flight.** Concurrent requests that find an expiring token wait on one shared refresh. Twenty parallel calls produce exactly one request to the token endpoint.
- **Atomic rotation.** The new access and refresh tokens are written in one transaction.
- **No refresh token?** The server is marked `no_refresh` and the UI warns you that a manual re-login is coming.

## Protocol

Streamable HTTP, stateless by default: no `Mcp-Session-Id`, no session state to lose across restarts. Protocol versions follow the pinned SDK, currently `2025-06-18` and `2025-11-25`. Legacy SSE is not exposed; it is only tolerated when reading from an old upstream. `Origin` is checked on every POST. JSON-RPC batching is not supported, matching the specification.

## Development

```bash
bun install
bun test            # unit and integration suites
bun run typecheck
bun run dev         # gateway with watch mode
bun run db:generate # regenerate drizzle migrations after a schema change
```

The test suite covers the things the product claims: upstream refresh under a five second token lifetime with a hundred calls and zero client-visible failures, single-flight collapsing, refresh token rotation, fifty stdio restart cycles with no zombie processes, and 404 on the discovery documents of an API-key-only endpoint.

## Client compatibility

Verified by hand before each release.

| Client | Version | Status |
|---|---|---|
| Claude Code | | pending |
| Codex | | pending |
| Cursor | | pending |
| claude.ai connector | | needs the built-in authorization server |

## Security

The gateway runs arbitrary packages and holds tokens for every integration you connect. Read [SECURITY.md](.github/SECURITY.md) before exposing it to anyone but yourself.

## License

MIT
