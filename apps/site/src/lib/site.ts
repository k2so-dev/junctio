export const SITE = {
  name: "Junctio",
  tagline: "Self-hosted MCP gateway for one developer or a small team",
  description:
    "One endpoint for Claude Code, Cursor, Codex and claude.ai. Upstream OAuth tokens refreshed before they expire, no telemetry, one container.",
  gettingStarted:
    "Run the Junctio MCP gateway with Docker Compose, add an upstream server, and point Claude Code or Cursor at one endpoint.",
  repo: "https://github.com/k2so-dev/junctio",
  image: "ghcr.io/k2so-dev/junctio",
  composeUrl: "https://raw.githubusercontent.com/k2so-dev/junctio/main/compose.yml",
  envUrl: "https://raw.githubusercontent.com/k2so-dev/junctio/main/.env.example"
} as const;

export const DOCS_NAV: { label: string; items: { slug: string; title: string }[] }[] = [
  {
    label: "Guide",
    items: [
      { slug: "", title: "Getting started" },
      { slug: "upstream-servers", title: "Upstream servers" },
      { slug: "endpoints", title: "Endpoints" },
      { slug: "management-mcp", title: "Management MCP" },
      { slug: "explore", title: "Explore" },
      { slug: "security-audit", title: "Security audit" }
    ]
  },
  {
    label: "Deploy",
    items: [
      { slug: "caddy", title: "TLS with Caddy" },
      { slug: "deploy/dokploy", title: "Dokploy" },
      { slug: "deploy/coolify", title: "Coolify" },
      { slug: "deploy/portainer", title: "Portainer" }
    ]
  }
];
