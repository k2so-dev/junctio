# Contributing

Thanks for taking the time. This document covers what you need to build the gateway, run its checks, and get a change merged.

## Setup

You need [Bun](https://bun.sh) 1.4.2 or newer. Docker is optional and only needed for the container runtime and its tests.

```sh
bun install
JUNCTIO_SECRET=$(openssl rand -hex 32) JUNCTIO_DATA_DIR=./data bun run dev
```

The admin UI is served from `apps/web/dist`. During development run `bun run dev:web` alongside the gateway for hot reloading.

## Checks

Every pull request must pass the same three commands CI runs:

```sh
bun run check      # biome lint and format
bun run typecheck  # tsc and vue-tsc
bun test           # the whole suite, about a minute
```

`bun run format` applies the formatting and the safe lint fixes for you.

Tests that need a Docker daemon skip themselves when the socket is missing, so a full run works without one.

## Layout

| Path | What lives there |
|---|---|
| `apps/gateway/` | The gateway: HTTP routes, MCP proxy, upstream supervisor, audit engine |
| `apps/gateway/test/unit/` | Pure functions, no I/O |
| `apps/gateway/test/integration/` | A real HTTP server on a real socket, driven end to end |
| `apps/web/` | The admin UI, Vue 3 with shadcn-vue components |
| `apps/web/scripts/` | Maintenance for the source catalog, run from CI |
| `apps/site/` | The landing page and rendered documentation, Astro with Vue islands, deployed to Cloudflare Pages |
| `packages/schema/` | Zod schemas and DTO types shared by the gateway and the UI |
| `docs/` | Reference pages and deployment guides linked from the README |
| `.github/` | CI workflows, issue and pull request templates, and the community health files |

## Conventions

- Commit subjects follow `<type>(<scope>): <subject>`, in the imperative, under 50 characters.
- Code and comments are written in English.
- Prefer a test that fails without your change over one that only describes it.
- Do not add a comment that restates the line below it. Name things so the comment is unnecessary.
- Changes that touch authentication, the audit policy or the upstream lifecycle want a regression test.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) explains how to report one privately and what the threat model already assumes.
