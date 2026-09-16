<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.png">
    <img src=".github/assets/logo-light.png" width="120" alt="Junctio">
  </picture>
</p>

# Junctio

Self-hosted MCP gateway for one developer or a small team. One container, one volume, one endpoint per client.

[![ci](https://github.com/k2so-dev/junctio/actions/workflows/ci.yml/badge.svg)](https://github.com/k2so-dev/junctio/actions/workflows/ci.yml)
[![codeql](https://github.com/k2so-dev/junctio/actions/workflows/codeql.yml/badge.svg)](https://github.com/k2so-dev/junctio/actions/workflows/codeql.yml)
[![trivy](https://github.com/k2so-dev/junctio/actions/workflows/scan.yml/badge.svg)](https://github.com/k2so-dev/junctio/actions/workflows/scan.yml)
[![ghcr.io](https://img.shields.io/github/v/tag/k2so-dev/junctio?sort=semver&label=ghcr.io)](https://github.com/k2so-dev/junctio/pkgs/container/junctio)
[![license](https://img.shields.io/github/license/k2so-dev/junctio)](LICENSE)

The promise: **auth does not go stale.** Not between your client and the gateway, and not between the gateway and its upstreams.

- **No telemetry.** Nothing leaves your machine. There is no phone-home, no analytics, no update ping. The one outbound call the UI ever makes is to the public MCP registry, on the Explore page, and only while you are looking at it. Switch on the security audit and there is a second one, described in [docs/security-audit.md](docs/security-audit.md), carrying package names and versions and nothing else.
- **One endpoint per client.** Point Claude Code, Codex or Cursor at a single URL and manage the servers behind it from a web UI.
- **Upstream OAuth that survives.** Tokens are refreshed proactively on a schedule, not after a request already failed.

## Status

Early, but the whole path works: gateway, aggregation, API key auth, a built-in OAuth authorization server, upstream OAuth, REST API, web UI, registry browsing, import from a pasted client config, a management MCP server and a multi-arch image on GHCR. Expect breaking changes before 1.0; [CHANGELOG.md](CHANGELOG.md) says when a release needs a fresh database.

## Screenshots

<!-- Drag an image into the GitHub editor and paste the URL it returns into the empty cell above its caption. -->

<table>
  <tr>
    <td width="50%"><!-- Explore --></td>
    <td width="50%"><!-- Explore - other --></td>
  </tr>
  <tr>
    <td align="center">Explore</td>
    <td align="center">Explore - other</td>
  </tr>
</table>

<details>
<summary><b>More screenshots</b></summary>
<br>

<table>
  <tr>
    <td width="50%"><!-- Servers --></td>
    <td width="50%"><!-- Endpoints --></td>
  </tr>
  <tr>
    <td align="center">Servers</td>
    <td align="center">Endpoints</td>
  </tr>
  <tr>
    <td width="50%"><!-- Security --></td>
    <td width="50%"><!-- Request log --></td>
  </tr>
  <tr>
    <td align="center">Security</td>
    <td align="center">Request log</td>
  </tr>
</table>

</details>

## Quickstart

The image is `ghcr.io/k2so-dev/junctio`, built for amd64 and arm64. `latest` is the last release, `edge` follows `main`.

```bash
mkdir junctio && cd junctio
curl -fsSLO https://raw.githubusercontent.com/k2so-dev/junctio/main/compose.yml
curl -fsSL https://raw.githubusercontent.com/k2so-dev/junctio/main/.env.example -o .env
```

Set `JUNCTIO_SECRET` in `.env` to the output of `openssl rand -hex 32`, then start it:

```bash
docker compose up -d
```

Or run it straight from the source tree:

```bash
bun install
bun run build:web
JUNCTIO_SECRET=$(openssl rand -hex 32) bun run start
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

Behind a domain, set `JUNCTIO_BASE_URL` and `JUNCTIO_TRUST_PROXY=true` and terminate TLS in front of the gateway. The guides under [Documentation](#documentation) do this for you.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `JUNCTIO_SECRET` | yes | Key used to encrypt stored tokens and headers. At least 32 characters; generate one with `openssl rand -hex 32`. The process refuses to start without it. |
| `JUNCTIO_BASE_URL` | for OAuth | Public URL of the gateway. Redirect URIs and resource identifiers are built from it. |
| `JUNCTIO_ADMIN_TOKEN` | no | Bearer token for headless admin access, as an alternative to the password login. Also the key to the management MCP server. When set, it is also required to choose the admin password on first start. |
| `JUNCTIO_OAUTH_ISSUER` | no | Issuer URL of an external identity provider. Leave it empty to use the gateway's own authorization server. |
| `JUNCTIO_OAUTH_AUDIENCE` | no | Override the expected audience of an external provider. Defaults to the endpoint URL. |
| `JUNCTIO_DATA_DIR` | no | Where `junctio.db` lives. Defaults to `./data`. The image sets it to `/data`, which is a volume. |
| `JUNCTIO_DOCKER_SOCKET` | no | Socket of the daemon that runs `docker` servers. Defaults to `/var/run/docker.sock`. |
| `JUNCTIO_PUBLIC_DIR` | no | Directory of the built UI. Defaults to `./public`, then `./apps/web/dist`. |
| `JUNCTIO_TRUST_PROXY` | no | `true` reads the client address from `x-forwarded-for`. Only enable it behind a proxy that rewrites that header, otherwise rate limits can be bypassed. |
| `PORT` / `HOST` | no | Listener. Defaults to `3000` and `0.0.0.0`. |
| `LOG_LEVEL` | no | `debug`, `info`, `warn` or `error`. Defaults to `info`. |

**OAuth does not work without TLS.** Browsers and MCP clients will refuse the redirects. Terminate TLS in front of the gateway. See [docs/caddy.md](docs/caddy.md).

## Documentation

- [Upstream servers](docs/upstream-servers.md): stdio runtimes, remote transports, servers that ship as an image, upstream OAuth
- [Endpoints](docs/endpoints.md): aggregation, downstream auth, protocol negotiation, client compatibility
- [Management MCP](docs/management-mcp.md): let an agent configure the gateway instead of clicking through the UI
- [Explore](docs/explore.md): the registry, the catalog of other sources, import from a pasted config
- [Security audit](docs/security-audit.md): scheduled vulnerability checks and what a finding does

Deploy: [Caddy on a VPS](docs/caddy.md), [Dokploy](docs/deploy/dokploy.md), [Coolify](docs/deploy/coolify.md), [Portainer](docs/deploy/portainer.md).

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

`make help` lists the same commands run in a throwaway toolchain container, plus `make up`, which builds `junctio:local` from the source tree and starts the stack through `compose.build.yml`.

## Security

The gateway runs arbitrary packages and holds tokens for every integration you connect. Read [SECURITY.md](.github/SECURITY.md) before exposing it to anyone but yourself.

## License

MIT

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the setup, the checks a pull request has to pass, and the repository layout. Report a vulnerability privately as described in [SECURITY.md](.github/SECURITY.md).
