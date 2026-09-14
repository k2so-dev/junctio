# junctio

Self-hosted MCP gateway for one developer or a small team. One container, one volume, one endpoint per client.

The promise: **auth does not go stale.** Not between your client and the gateway, and not between the gateway and its upstreams.

- **No telemetry.** Nothing leaves your machine. There is no phone-home, no analytics, no update ping.
- **One endpoint per client.** Point Claude Code, Codex or Cursor at a single URL and manage the servers behind it from a web UI.
- **Upstream OAuth that survives.** Tokens are refreshed proactively on a schedule, not after a request already failed.

## Status

Early, but the whole path works: gateway, aggregation, API key auth, a built-in OAuth authorization server, upstream OAuth, REST API, web UI and container image. Not published to a registry yet — build it yourself.

## Quickstart

```bash
docker compose up --build
```

`JUNCTIO_SECRET` is required; generate one with `openssl rand -hex 32`. Or run it straight from the source tree:

```bash
bun install
bun run build:web
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
| `JUNCTIO_OAUTH_ISSUER` | no | Issuer URL of an external identity provider. Leave it empty to use the gateway's own authorization server. |
| `JUNCTIO_OAUTH_AUDIENCE` | no | Override the expected audience of an external provider. Defaults to the endpoint URL. |
| `JUNCTIO_DATA_DIR` | no | Where `junctio.db` lives. Defaults to `/data`. |
| `JUNCTIO_PUBLIC_DIR` | no | Directory of the built UI. Defaults to `./public`, then `./apps/web/dist`. |
| `PORT` / `HOST` | no | Listener. Defaults to `3000` and `0.0.0.0`. |
| `LOG_LEVEL` | no | `debug`, `info`, `warn` or `error`. Defaults to `info`. |

**OAuth does not work without TLS.** Browsers and MCP clients will refuse the redirects. Terminate TLS in front of the gateway. See `docs/caddy.md`.

## Upstream servers

A server is either `stdio` or `http`.

For stdio the `runtime` field is the launcher and everything else is yours: the arguments you type are passed through in order, one per line. `custom` takes the executable from the first argument.

| Runtime | Arguments | Resulting command |
|---|---|---|
| `npx` | `-y`, `@scope/pkg`, `/data` | `npx -y @scope/pkg /data` |
| `uv` | `run`, `main.py` | `uv run main.py` |
| `custom` | `/usr/local/bin/srv`, `--flag` | `/usr/local/bin/srv --flag` |

Nothing is added behind your back. The form seeds `-y` for `npx` and `run` for `uv` because those are what you almost always want, but they are ordinary text you can delete. The same goes for flags the gateway has no opinion about: `bunx` honours the package shebang and runs most CLIs under Node, so add `--bun` yourself if you want Bun to execute it.

The environment handed to a child process is built explicitly: the `PATH` from settings, `HOME`, `TMPDIR` and the variables you configured. Nothing else is inherited, and `JUNCTIO_*` variables are never passed down. That `PATH` defaults to the directories where the gateway found `bun`, `node` and `uv` at first start, plus the system ones; change it in Settings if a runtime lives elsewhere.

`TMPDIR` matters more than it looks: `bunx` unpacks and executes packages there, so a temporary directory mounted `noexec` makes it exit with status 1 and no output at all. The image points `TMPDIR` at `/cache/tmp` for that reason, and the gateway warns at startup if the directory it ends up with is `noexec`.

For HTTP the gateway speaks Streamable HTTP. The auth mode is `none`, `header` for a static token, or `oauth` for the full client flow.

## Aggregation

Tools from an upstream are exposed as `<prefix>__<tool>`. The prefix defaults to the server name and is set per namespace membership; the separator is global. Name collisions are rejected when you save the configuration, not at request time. Per namespace you can hide a tool, rename it, rewrite its description or add annotations.

Resources are prefixed in the URI scheme, so `mock://readme` from a server prefixed `alpha` becomes `alpha+mock://readme`.

A dead upstream does not take the rest down. `tools/list` queries every server in parallel with a five second per-server timeout and returns what it has.

## Auth, downstream

An endpoint accepts `none`, `api_key`, `oauth` or `any`.

API keys are sent as `Authorization: Bearer jn_...` or `X-API-Key`. Only an argon2id hash is stored and the key is shown once. A key can be bound to a single endpoint. The query parameter form is off unless you enable it for clients that cannot send headers.

An endpoint can cap requests per minute. The budget is counted per API key, or per client address when the endpoint needs no key, and a request over the limit gets a 429 with `Retry-After`. Zero means no limit.

**The gateway is its own authorization server.** You do not need an identity provider. Set `JUNCTIO_BASE_URL`, switch an endpoint to OAuth, and a browser client can connect: the gateway publishes RFC 8414 metadata, accepts RFC 7591 dynamic client registration, runs authorization code with PKCE and issues its own tokens. This is what claude.ai and Claude Desktop connectors need, because they cannot send an API key header.

Every authorization stops at a consent screen that requires the admin password. Registering a client grants nothing on its own. Access tokens live one hour, refresh tokens thirty days and rotate on every use, and a client secret never expires. Revoke a client from Settings and its tokens die with it.

If you already run Keycloak, Authentik, Auth0 or similar, set `JUNCTIO_OAUTH_ISSUER` instead. The gateway then stops being an authorization server and validates your provider's JWTs against its JWKS, checking that the audience matches the endpoint URL.

Either way the discovery documents under `/.well-known/` are served **only** for endpoints whose auth mode includes OAuth; anything else returns 404. A 401 always carries a correct `WWW-Authenticate` header with the resource metadata URL.

## Auth, upstream

This is the other half of the promise. For an upstream with `auth_mode: oauth` the gateway runs the full client flow: RFC 9728 discovery, RFC 8414 metadata, dynamic client registration when there is no client ID, PKCE, and a callback on `/oauth/upstream/callback/:server_id`. The `resource` parameter is sent on both the authorize and the token request.

After that:

- **Proactive refresh.** A scheduler checks every minute and refreshes before expiry. The window is one fifth of the token lifetime, and at least five minutes for tokens that live longer than ten minutes.
- **Reactive refresh.** A 401 from an upstream triggers one refresh and one retry. A second 401 sets the server to `needs_reauth` instead of looping.
- **Single flight.** Concurrent requests that find an expiring token wait on one shared refresh. Twenty parallel calls produce exactly one request to the token endpoint.
- **Atomic rotation.** The new access and refresh tokens are written in one transaction.
- **No refresh token?** The server is marked `no_refresh` and the UI warns you that a manual re-login is coming.

## Protocol

Streamable HTTP, stateless by default: no `Mcp-Session-Id`, no session state to lose across restarts. Protocol versions follow the pinned SDK, currently `2025-06-18` and `2025-11-25`. Each endpoint declares the oldest version it accepts and refuses anything below it, on the `initialize` body and on the `MCP-Protocol-Version` header of later requests. Legacy SSE is not exposed; it is only tolerated when reading from an old upstream. `Origin` is checked on every POST. JSON-RPC batching is not supported, matching the specification.

## Development

```bash
bun install
bun test            # unit and integration suites
bun run typecheck   # tsc for the server, vue-tsc for the web
bun run dev         # gateway with watch mode
bun run dev:web     # vite dev server on 5173, proxies /api to 3000
bun run build:web   # SPA into apps/web/dist, served by the gateway
bun run db:generate # regenerate drizzle migrations after a schema change
```

The UI is Vue 3, Tailwind 4 and shadcn-vue, built as a static SPA. The gateway serves it from `apps/web/dist` unless `JUNCTIO_PUBLIC_DIR` says otherwise.

The test suite covers the things the product claims: upstream refresh under a five second token lifetime with a hundred calls and zero client-visible failures, single-flight collapsing, refresh token rotation, fifty stdio restart cycles with no zombie processes, and 404 on the discovery documents of an API-key-only endpoint.

## Client compatibility

Verified by hand before each release.

| Client | Version | Status |
|---|---|---|
| Claude Code | | pending |
| Codex | | pending |
| Cursor | | pending |
| claude.ai connector | | implemented, not yet verified against the live service |

## Security

The gateway runs arbitrary packages and holds tokens for every integration you connect. Read [SECURITY.md](.github/SECURITY.md) before exposing it to anyone but yourself.

## License

MIT
