# Dokploy

**Dokploy routes traffic through its own Traefik, so the service publishes no ports and has to join `dokploy-network`.** A published port would expose the gateway next to the proxy instead of behind it, and a service outside that network is unreachable no matter what domain you attach.

Create a project, add a service of type Compose, choose the Raw provider and paste this:

```yaml
services:
  junctio:
    image: ghcr.io/k2so-dev/junctio:latest
    pull_policy: always
    restart: unless-stopped
    environment:
      JUNCTIO_SECRET: ${JUNCTIO_SECRET:?set JUNCTIO_SECRET, e.g. openssl rand -hex 32}
      JUNCTIO_BASE_URL: ${JUNCTIO_BASE_URL:?set JUNCTIO_BASE_URL, e.g. https://mcp.example.com}
      JUNCTIO_TRUST_PROXY: "true"
      JUNCTIO_ADMIN_TOKEN: ${JUNCTIO_ADMIN_TOKEN:-}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    volumes:
      - junctio-data:/data
      - junctio-cache:/cache
    tmpfs:
      - /tmp
    read_only: true
    networks:
      - dokploy-network

networks:
  dokploy-network:
    external: true

volumes:
  junctio-data:
  junctio-cache:
```

The Environment tab takes the values:

```
JUNCTIO_SECRET=
JUNCTIO_BASE_URL=https://mcp.example.com
```

Generate the secret with `openssl rand -hex 32`. It encrypts every stored token, so losing it means losing the database; keep a copy somewhere other than the server.

On the Domains tab add the host, point it at the `junctio` service on container port `3000`, and switch on HTTPS with Let's Encrypt. Then deploy.

## Base URL

`JUNCTIO_BASE_URL` must be exactly the domain you attached, with `https://` and no trailing slash. Redirect URIs for upstream authorization, the audience the gateway expects in incoming JWTs and the resource metadata documents are all derived from it, and a mismatch produces authorization failures that look like client bugs.

`JUNCTIO_TRUST_PROXY` is `true` here because Traefik sets `X-Forwarded-For`. The login rate limiter reads it to tell clients apart. Leave it `false` whenever nothing in front of the gateway rewrites that header, otherwise the limit is trivial to bypass.

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

`DOCKER_GID` comes from `stat -c %g /var/run/docker.sock` on the host and goes into the Environment tab like the rest. Reaching that socket is equivalent to root on the machine, so mount it only if you actually run container servers, and read [SECURITY.md](../../.github/SECURITY.md) first.
