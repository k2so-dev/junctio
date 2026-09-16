# Junctio site

The landing page and the rendered documentation at junctio.pages.dev, built with Astro, Tailwind 4 and Vue islands.

The documentation pages are generated from `../../docs/*.md` at build time; nothing under `src/content` duplicates them. Use-case pages live in `src/content/use-cases` and are the only prose authored here.

```bash
bun run dev:site     # astro dev server on 4321
bun run build:site   # static output in apps/site/dist
```

Cloudflare Pages settings: root directory `apps/site`, build command `bun run build`, output directory `dist`. Set `SITE_URL` once the site has its own domain so canonical URLs and the sitemap follow it.
