# TLS with Caddy

**OAuth does not work over plain HTTP.** MCP clients and browsers refuse to follow authorization redirects to an insecure origin, and an authorization server will reject a non-HTTPS redirect URI. If you plan to use any OAuth flow, put the gateway behind TLS first. This is not something the gateway can work around.

A whole Caddyfile:

```caddyfile
mcp.example.com {
	reverse_proxy localhost:3000
}
```

Caddy obtains and renews the certificate on its own. Then start the gateway with a matching base URL:

```bash
JUNCTIO_BASE_URL=https://mcp.example.com
```

The base URL must match what clients actually type. Redirect URIs for upstream authorization, the audience the gateway expects in incoming JWTs, and the resource metadata documents are all derived from it. A mismatch produces authorization failures that look like client bugs.

## Streaming responses

The gateway keeps SSE streams open for live server logs. Caddy handles this correctly by default. If you use nginx instead, disable response buffering on the proxied location, otherwise the log view will appear frozen.

## Behind another proxy

If something upstream of Caddy already terminates TLS, make sure `X-Forwarded-For` reaches the gateway. The login rate limiter reads it to identify clients.
