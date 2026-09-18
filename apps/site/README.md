# Junctio site

The landing page and the rendered documentation at junctio.org, built with Astro, Tailwind 4 and Vue islands.

The documentation pages are generated from `../../docs/*.md` at build time; nothing under `src/content` duplicates them. Use-case pages live in `src/content/use-cases` and are the only prose authored here.

```bash
bun run dev:site     # astro dev server on 4321
bun run build:site   # static output in apps/site/dist
```

## Cloudflare Pages

The repository is a bun workspace, so dependencies have to be installed at its root with bun. Pointing Pages at this directory makes it fall back to npm, which cannot read the `workspace:*` ranges in the gateway and web manifests and fails with `EUNSUPPORTEDPROTOCOL`. Install explicitly instead:

| Setting | Value |
|---|---|
| Root directory | empty, the repository root |
| Build command | `bun install --frozen-lockfile && bun run build:site` |
| Build output directory | `apps/site/dist` |
| Build watch paths | `apps/site/*`, `docs/*`, `bun.lock` |

Two environment variables, both for the production and the preview environment:

| Variable | Value | Why |
|---|---|---|
| `SKIP_DEPENDENCY_INSTALL` | `1` | Stops Pages from running `npm install` before the build command |
| `BUN_VERSION` | `1.4.2` | Matches the version CI uses |

`SITE_URL` is optional and defaults to `https://junctio.org`; canonical URLs, the sitemap and the link to it in `robots.txt` all follow it.
