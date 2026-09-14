# junctio

Self-hosted MCP gateway for one developer or a small team. One container, one volume, one endpoint per client.

The promise: **auth does not go stale.** Not between your client and the gateway, and not between the gateway and its upstreams.

- **No telemetry.** Nothing leaves your machine. There is no phone-home, no analytics, no update ping. The one outbound call the UI ever makes is to the public MCP registry, on the Explore page, and only while you are looking at it.
- **One endpoint per client.** Point Claude Code, Codex or Cursor at a single URL and manage the servers behind it from a web UI.
- **Upstream OAuth that survives.** Tokens are refreshed proactively on a schedule, not after a request already failed.

## Status

Early, but the whole path works: gateway, aggregation, API key auth, a built-in OAuth authorization server, upstream OAuth, REST API, web UI, registry browsing, a management MCP server and a container image. Not published to a registry yet — build it yourself.

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
| `JUNCTIO_ADMIN_TOKEN` | no | Bearer token for headless admin access, as an alternative to the password login. Also the key to the management MCP server. |
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

## Explore

The Explore page lists what other people have published to the official MCP registry at `registry.modelcontextprotocol.io`, so you can add a server without hunting for its package name.

The browser never talks to the registry. The gateway does, over its public read-only endpoints, with no key and no account. It asks only when you open the page, type a search or press refresh, and it sends nothing but your search term and the name of an entry you opened. Every answer is stored in `junctio.db` for an hour, so paging back and forth costs nothing, and entries older than a day are swept away.

If the registry is slow or down, a request gives up after ten seconds and the page falls back to the cached copy, saying how old it is and what went wrong. With nothing cached you get an error and a retry button instead of an empty table.

The registry searches by name only and has no filters, so the page offers search, paging and nothing it cannot honour. Paging is by cursor: the registry publishes no total, and counting more than twenty thousand entries by hand would cost hundreds of requests, so there are no page numbers to render. Every row is the latest version of that server.

Each row links out to whatever the entry declares, in a new tab: the repository, the project website, the npm or PyPI page of the package, and the raw registry entry itself.

| Published as | What the gateway does |
|---|---|
| npm package, stdio | Prefills an `npx` server with the pinned version, its arguments and its environment |
| PyPI package, stdio | Prefills a `uvx` server |
| Remote Streamable HTTP | Prefills an HTTP server, with the `Authorization` header when the entry declares one |
| Remote SSE | Refused: the gateway proxies Streamable HTTP only |
| Container image, NuGet, bundle | Refused: the image ships no docker or dotnet toolchain |

Install opens the ordinary Add server form with the fields already filled in, including placeholders like `<allowed_directory>` where the registry says an argument is needed. Nothing is written to the database until you press save, so secrets and paths are yours to fill in first, with the exact command shown next to the form.

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

Either way the discovery documents under `/.well-known/` are served **only** for endpoints whose auth mode includes OAuth, and for the management server below when it is switched on; anything else returns 404. A 401 always carries a correct `WWW-Authenticate` header with the resource metadata URL.

## Management MCP

The gateway can publish an MCP server of its own, at `/mcp/_admin`, so an agent configures it instead of you clicking through the UI. It is **off by default**; the switch is in Settings, and while it is off both the route and its discovery documents answer 404.

Two ways in, no new credentials either way:

- **`JUNCTIO_ADMIN_TOKEN`** as a bearer token, for Claude Code, Codex, Cursor and anything else that sends headers.
- **The built-in OAuth server**, for claude.ai and Claude Desktop, which cannot. Every authorization still stops at the consent screen that asks for the admin password, so a client only gets in because a human let it. This is unavailable when `JUNCTIO_OAUTH_ISSUER` points at someone else's provider: that provider has no way to ask for your admin password, so the token is the only route left.

API keys of ordinary endpoints are refused here, and a token minted for another endpoint is refused too.

```bash
claude mcp add --transport http junctio-admin https://mcp.example.com/mcp/_admin \
  --header "Authorization: Bearer $JUNCTIO_ADMIN_TOKEN"
```

Forty-two tools, one per action, over the same REST API the web UI uses, so validation and behaviour cannot drift apart: servers (create, edit, start, stop, test, logs, upstream OAuth), namespaces (membership, prefixes, tool overrides, collision checks), endpoints, registry search and install, settings, request log and health. The current state is also readable as resources like `junctio://servers`, which costs an agent less context than a tool call. Destructive tools are annotated as such, so a client can ask before running them.

Three things are deliberately absent. **API keys cannot be issued or revoked**, only listed. **OAuth clients cannot be revoked and consent cannot be granted**, since an agent approving its own authorization would defeat the consent screen. **The management server cannot switch itself off**, or on: passing that field is rejected by the schema.

Every call is written to the request log with no endpoint, so what the agent did is visible next to what your clients did.

**This hands an agent the ability to run arbitrary commands on the host**, because that is what adding a stdio server does. Treat the token like shell access.

## Auth, upstream

This is the other half of the promise. For an upstream with `auth_mode: oauth` the gateway runs the full client flow: RFC 9728 discovery, RFC 8414 metadata, dynamic client registration when there is no client ID, PKCE, and a callback on `/oauth/upstream/callback/:server_id`. The `resource` parameter is sent on both the authorize and the token request.

After that:

- **Proactive refresh.** A scheduler checks every minute and refreshes before expiry. The window is one fifth of the token lifetime, and at least five minutes for tokens that live longer than ten minutes.
- **Reactive refresh.** A 401 from an upstream triggers one refresh and one retry. A second 401 sets the server to `needs_reauth` instead of looping.
- **Single flight.** Concurrent requests that find an expiring token wait on one shared refresh. Twenty parallel calls produce exactly one request to the token endpoint.
- **Atomic rotation.** The new access and refresh tokens are written in one transaction.
- **No refresh token?** The server is marked `no_refresh` and the UI warns you that a manual re-login is coming.

## Protocol

Streamable HTTP, stateless: no `Mcp-Session-Id`, no session state to lose across restarts. The gateway speaks both protocol eras on the same URL. A `2026-07-28` client sends its version and capabilities in `_meta` on every request and never calls `initialize`; a `2025-11-25` or `2025-06-18` client gets the classic handshake, served per request. The check runs on the `initialize` body and on the `MCP-Protocol-Version` header.

Each endpoint declares the oldest revision it accepts, and a new one accepts **`2026-07-28` only**. That refuses the handshake era outright, which is what a modern-only client fleet wants; a client stuck on an older revision gets `-32022 Unsupported protocol version` naming the revisions the endpoint does accept. Every refusal is logged, and the endpoint page lists the revisions its clients actually spoke and warns when it is turning someone away, so lowering the minimum is an informed decision rather than a guess.

Upstreams are negotiated the same way. The gateway probes each server once with `server/discover`, talks `2026-07-28` to servers that answer, and falls back to `initialize` for everything else. A stdio server that dies on the probe is respawned and spoken to as legacy from then on; the verdict is cached for a day and dropped when the server config changes. The negotiated revision is shown on the server page and in the connection test.

Legacy SSE is not exposed; it is only tolerated when reading from an old upstream. `Origin` is checked on every POST. JSON-RPC batching is not supported, matching the specification.

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
