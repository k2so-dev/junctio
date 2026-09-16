# Portainer

**Portainer does not terminate TLS, and OAuth does not work over plain HTTP.** Publish the port on the loopback address and put a proxy in front of it; [TLS with Caddy](../caddy.md) is four lines of configuration. Without that, API keys still work but every OAuth flow fails.

Go to Stacks, add a stack, pick the web editor and paste this:

```yaml
services:
  junctio:
    image: ghcr.io/k2so-dev/junctio:latest
    pull_policy: always
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      JUNCTIO_SECRET: ${JUNCTIO_SECRET:?set JUNCTIO_SECRET, e.g. openssl rand -hex 32}
      JUNCTIO_BASE_URL: ${JUNCTIO_BASE_URL:-}
      JUNCTIO_TRUST_PROXY: ${JUNCTIO_TRUST_PROXY:-false}
      JUNCTIO_ADMIN_TOKEN: ${JUNCTIO_ADMIN_TOKEN:-}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    volumes:
      - junctio-data:/data
      - junctio-cache:/cache
    tmpfs:
      - /tmp
    read_only: true

volumes:
  junctio-data:
  junctio-cache:
```

Add the environment variables below the editor, either by hand or with "Load variables from .env file":

```
JUNCTIO_SECRET=
JUNCTIO_BASE_URL=https://mcp.example.com
JUNCTIO_TRUST_PROXY=true
```

Generate the secret with `openssl rand -hex 32`. It encrypts every stored token, so losing it means losing the database; keep a copy somewhere other than the server.

Deploy the stack, then point your proxy at `127.0.0.1:3000`.

The published port is bound to the loopback address on purpose. `0.0.0.0:3000` puts the admin UI on the public internet next to the proxy that was supposed to protect it.

## Base URL

`JUNCTIO_BASE_URL` must be exactly the domain clients type, with `https://` and no trailing slash. Redirect URIs for upstream authorization, the audience the gateway expects in incoming JWTs and the resource metadata documents are all derived from it, and a mismatch produces authorization failures that look like client bugs.

Set `JUNCTIO_TRUST_PROXY=true` only once a proxy that rewrites `X-Forwarded-For` is actually in place. The login rate limiter reads that header to tell clients apart, so trusting it without a proxy lets anyone spoof an address and slip the limit.

## Volumes

`junctio-data` holds `junctio.db`, which is the whole configuration. `junctio-cache` holds the package caches for `npx`, `bunx` and `uvx`; it can be thrown away, but a cold cache makes the first start of every stdio server slow.

## Container servers

The `docker` runtime spawns upstreams as containers on the host daemon, which needs the socket:

```yaml
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    group_add:
      - "${DOCKER_GID}"
```

`DOCKER_GID` comes from `stat -c %g /var/run/docker.sock` on the host and is a stack environment variable like the rest. Reaching that socket is equivalent to root on the machine, so mount it only if you actually run container servers, and read [SECURITY.md](../../.github/SECURITY.md) first.
