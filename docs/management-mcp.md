# Management MCP

The gateway can publish an MCP server of its own, at `/mcp/_admin`, so an agent configures it instead of you clicking through the UI. It is **off by default**; the switch is in Settings, and while it is off both the route and its discovery documents answer 404.

Two ways in, no new credentials either way:

- **`JUNCTIO_ADMIN_TOKEN`** as a bearer token, for Claude Code, Codex, Cursor and anything else that sends headers.
- **The built-in OAuth server**, for claude.ai and Claude Desktop, which cannot. Every authorization still stops at the consent screen that asks for the admin password, so a client only gets in because a human let it. This is unavailable when `JUNCTIO_OAUTH_ISSUER` points at someone else's provider: that provider has no way to ask for your admin password, so the token is the only route left.

API keys of ordinary endpoints are refused here, and a token minted for another endpoint is refused too.

```bash
claude mcp add --transport http junctio-admin https://mcp.example.com/mcp/_admin \
  --header "Authorization: Bearer $JUNCTIO_ADMIN_TOKEN"
```

Forty-three tools, one per action, over the same REST API the web UI uses, so validation and behaviour cannot drift apart: servers (create, edit, start, stop, test, logs, upstream OAuth), namespaces (membership, prefixes, tool overrides, collision checks), endpoints, registry search and install, settings, request log and health. The current state is also readable as resources like `junctio://servers`, which costs an agent less context than a tool call. Destructive tools are annotated as such, so a client can ask before running them.

Three things are deliberately absent. **API keys cannot be issued or revoked**, only listed. **OAuth clients cannot be revoked and consent cannot be granted**, since an agent approving its own authorization would defeat the consent screen. **The management server cannot switch itself off**, or on: passing that field is rejected by the schema.

Every call is written to the request log with no endpoint, so what the agent did is visible next to what your clients did.

**This hands an agent the ability to run arbitrary commands on the host**, because that is what adding a stdio server does. Treat the token like shell access.
