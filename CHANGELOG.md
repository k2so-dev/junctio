# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **An endpoint now hands its clients `instructions`.** Until now the prose an upstream server announces about itself was read and thrown away, so a well-documented server arrived as a bare list of tools. The gateway composes one text per namespace: the namespace description first, then a `## <prefix>` section per enabled server. Servers that announce nothing, and quarantined ones, contribute nothing, and an endpoint with nothing to say omits the field as before.
- **What a server contributes can be rewritten per namespace.** The Servers table in Namespaces gained an Instructions column that shows the upstream wording and takes your own instead, with the same revert button the tool descriptions have. The management MCP takes it as the `description` field of `add_namespace_server`: leave it out to keep what is stored, pass null to go back to the upstream text. Existing databases gain the `namespace_servers.description` column at startup, with no manual step.
- **The composed text can be read before a client sees it**, through `GET /v1/namespaces/:id/instructions`, the new `preview_namespace_instructions` tool, or one button on the Namespaces page.
- The sidebar links to the repository, and the version in the status menu links to its releases.

### Fixed

- The audit indicator in the servers table sat below the status as a bare shield icon. It now sits next to it, and advisories, a failed audit and a quarantine read as a compact pill rather than an icon you have to hover to understand.
- The prefix field in Namespaces was the only inline field on the page drawn as a boxed input; it now looks like every other one, borderless until you point at it.

## [0.2.0] - 2026-09-16

### Changed

- The image no longer ships `README.md` and `SECURITY.md` under `/app`; `LICENSE` stays. Documentation-only commits on `main` no longer rebuild the `edge` tag or run the test and image checks.

### Security

- The image ships uv 0.12.15 instead of 0.11.7, which closes an arbitrary file write through entry point names ([GHSA-4gg8-gxpx-9rph](https://github.com/advisories/GHSA-4gg8-gxpx-9rph)) and several denial-of-service bugs in its dependencies. uv 0.12 also rejects wheels that could replace the interpreter and unsupported archive formats.
- The image upgrades npm to 12 instead of keeping the 10.9 bundled with Node 22, and applies Debian security updates at build time. Every image on ghcr is now scanned with Trivy after publishing and weekly; findings land in the repository's Security tab.
- A registry entry can no longer make the install page link to npm or PyPI by putting `npmjs.org` or `pypi.org` somewhere inside a custom registry URL; the host is compared, not the string.

## [0.1.0] - 2026-09-16

First public release.

### Changed

- `JUNCTIO_DATA_DIR` defaults to `./data` instead of `/data`, so a source-tree run no longer tries to write to the filesystem root. The image still sets it to `/data`, which is where the named volume is mounted, so a container deployment is unaffected.

### Security

- `POST /v1/session/setup` now requires `JUNCTIO_ADMIN_TOKEN` when one is configured. A headless deployment that relied on the token no longer leaves the first-run password endpoint open to anyone who can reach it.
- OAuth tokens issued by the built-in authorization server are bound to a resource. `resource` is now required at `/oauth/authorize` per RFC 8707, and the verifier rejects a token whose audience does not match the endpoint. A token minted for one endpoint no longer works on another, nor on the management server.
- Management MCP tools validate every identifier as a UUID, so a tool argument can no longer smuggle a path segment into the REST router and reach an operation the management server does not expose, such as lifting a quarantine.
- The origin check no longer falls back to echoing the `Host` header, which closes a DNS rebinding path to every endpoint with `authMode: "none"`. With `JUNCTIO_BASE_URL` unset only loopback origins matching the host are accepted.
- Every response carries `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`; API responses are marked `no-store`.
- The session cookie is marked `Secure` behind a TLS-terminating proxy when `JUNCTIO_TRUST_PROXY` is on, not only when `JUNCTIO_BASE_URL` is https.
- `/oauth/authorize` and `/oauth/token` are rate limited. The login limiter dropped its global bucket, which an attacker could use to lock out the real operator.
- With `JUNCTIO_TRUST_PROXY` on, the client address is taken from the right-most `x-forwarded-for` entry, the one the fronting proxy appends, instead of the client-supplied left-most one.
- Refresh token rotation keeps the original grant time, so the 30-day lifetime is now absolute rather than sliding indefinitely.
- Agents can no longer change `runtimePath` or `auditIntervalHours` through the management server, and the settings handler enforces the agent schema rather than trusting the tool definition.
- Encryption keys are derived with scrypt from `JUNCTIO_SECRET` and a random per-database salt instead of a single unsalted SHA-256. The minimum secret length is now 32 characters.
- Links coming from the public registry and from advisory data are rendered only when they are `http:` or `https:`, closing a `javascript:` injection into the admin UI.
- The `enabled` flag can no longer be flipped back on for a server the audit disabled until a fresh audit comes back clean, and editing a server in the UI no longer silently re-enables it.

### Added

- A launch gate: with the audit enabled, a server whose packages have never been checked, or whose last check failed, refuses to start and queues an audit instead of launching unverified code. The gate covers the pool, warm start, crash restart and the test button.
- CVSS v3 vectors from OSV are scored instead of being discarded, so a PyPI advisory carrying only a vector no longer collapses to `unknown`. An unknown severity now ranks as high rather than moderate.
- Biome for linting and formatting, wired into CI.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, and Dependabot.

### Fixed

- `uvx` and `uv` work on a read-only root filesystem. The image sets `UV_PYTHON_INSTALL_DIR` and `XDG_DATA_HOME` inside `/cache`, without which the PyPI audit engine and every `uvx` server failed in the published configuration.
- A stop and an acquire in flight no longer overlap, which could leave a second process or container running behind the first.
- A server whose transport was closed, typically after a slow handshake, is replaced instead of being handed the same dead transport forever.
- The audit no longer resolves one set of packages while the server runs another: environment variables that redirect package resolution are dropped for audited runtimes.
- A failed lookup against osv.dev is no longer cached for a day as "no vulnerability", and a non-zero `bun audit` exit or an error payload is treated as a failure.
- The quarantine reason is refreshed when the findings change, and lifted quarantines are counted in the run summary.
- Renaming a server checks namespace prefix collisions, and a name containing the tool separator is rejected.
- PyPI and OCI installs from the registry pin the version the registry entry names.
- An unwritable `TMPDIR` is reported as an error at startup instead of passing silently.
- The admin UI handles an expired session, a failed request and a missing clipboard API instead of failing silently; the request log colours slow requests correctly; live server logs keep following past 500 lines.

### Removed

- The plaintext `servers.env` column and its backfill. Server environments have been stored encrypted for several releases.

[Unreleased]: https://github.com/k2so-dev/junctio/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/k2so-dev/junctio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/k2so-dev/junctio/releases/tag/v0.1.0
