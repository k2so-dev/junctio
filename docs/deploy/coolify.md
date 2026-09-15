# Coolify

**Coolify attaches the service to its proxy network on its own; what it needs from you is the container port.** Write the domain as `https://mcp.example.com:3000` and the port is the one inside the container, not one published on the host.

Add a resource of type Docker Compose Empty and paste this:

```yaml
services:
  junctio:
    image: ghcr.io/k2so-dev/junctio:latest
    restart: unless-stopped
    expose:
      - "3000"
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

volumes:
  junctio-data:
  junctio-cache:
```

Fill in the Environment Variables tab:

```
JUNCTIO_SECRET=
JUNCTIO_BASE_URL=https://mcp.example.com
```

Generate the secret with `openssl rand -hex 32`. It encrypts every stored token, so losing it means losing the database; keep a copy somewhere other than the server.

Set the domain on the `junctio` service to `https://mcp.example.com:3000` and deploy. Coolify requests the certificate itself.

If you would rather let Coolify generate the hostname, add `SERVICE_FQDN_JUNCTIO_3000` to the environment instead of typing a domain. Coolify fills it in and it is a usable value for `JUNCTIO_BASE_URL`.

## Base URL

`JUNCTIO_BASE_URL` must be exactly the domain clients type, with `https://` and no trailing slash, and without the `:3000` suffix that only Coolify's domain field wants. Redirect URIs for upstream authorization, the audience the gateway expects in incoming JWTs and the resource metadata documents are all derived from it, and a mismatch produces authorization failures that look like client bugs.

`JUNCTIO_TRUST_PROXY` is `true` here because Coolify's proxy sets `X-Forwarded-For`. The login rate limiter reads it to tell clients apart. Leave it `false` whenever nothing in front of the gateway rewrites that header, otherwise the limit is trivial to bypass.

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

`DOCKER_GID` comes from `stat -c %g /var/run/docker.sock` on the host and goes into the environment variables like the rest. Reaching that socket is equivalent to root on the machine, so mount it only if you actually run container servers, and read [SECURITY.md](../../.github/SECURITY.md) first.
