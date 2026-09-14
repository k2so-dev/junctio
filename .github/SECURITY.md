# Security

## Threat model

Junctio is a single-tenant gateway for one developer or a small trusted team. Two facts define everything below.

**It executes arbitrary code.** Adding a stdio server means the gateway will download and run a package from npm or PyPI with the arguments and environment you supply. Whoever can add a server has the same power as whoever can run shell commands as the gateway user.

**It holds the keys to every integration.** Access and refresh tokens for each connected upstream sit in the database. Someone who reads that database and the encryption secret can act as you against every service you connected.

There is no isolation between upstream servers. They share a process namespace, a filesystem and a cache volume. A malicious MCP server can read the tokens of every other one. Do not add a server you would not run locally.

## What is protected

- Access tokens, refresh tokens, upstream client secrets and static headers are encrypted with AES-GCM using a key derived from `JUNCTIO_SECRET`. The process refuses to start without that variable.
- API keys are stored as argon2id hashes and displayed exactly once.
- The admin password is stored as an argon2id hash.
- Child processes receive an explicitly constructed environment. The gateway's own variables, including `JUNCTIO_SECRET`, are never inherited by an upstream.
- The logger masks bearer tokens, Junctio API keys, JWTs and common provider token formats, and redacts values of sensitive keys such as `authorization` and `refresh_token`.
- `Origin` is validated on every state-changing request to both the MCP endpoints and the admin API.
- The login endpoint is rate limited to ten attempts per minute per client address.
- Discovery documents under `/.well-known/` are served only for endpoints that actually accept OAuth. An API-key-only endpoint returns 404, so a client is never sent down an authorization flow that cannot work.
- The built-in authorization server stores access, refresh and authorization codes as SHA-256 hashes, and client secrets encrypted with `JUNCTIO_SECRET`. Authorization codes are single use and expire in a minute. Refresh tokens rotate on every exchange, and replaying a spent one fails.
- Dynamic client registration is open, because browser clients such as claude.ai register themselves before any human is involved. Registration alone grants nothing: every authorization stops at a consent screen that requires the admin password, and a token is bound to the endpoint named in the `resource` parameter, so it is rejected on any other endpoint.

## What is not protected

- No sandboxing of upstream processes. Use a dedicated container or VM if you need it.
- No role-based access control. Admin access is all or nothing, and an approved OAuth client reaches every tool in the namespace behind its endpoint.
- No audit log beyond the request log and the structured application log.
- `JUNCTIO_SECRET` is read from the environment. Anyone who can read the process environment can decrypt the database.
- The database file is not encrypted at rest beyond the individual secret columns. Table contents such as server names, URLs and request history are plain text.

## Deployment advice

The image already runs as a non-root user and the bundled `compose.yml` mounts the root filesystem read-only, writable only at `/data`, `/cache` and `/tmp`. Keep it that way. Put it behind TLS; OAuth will not work otherwise. Do not expose the admin UI to the public internet if you can avoid it. Back up `/data` and store `JUNCTIO_SECRET` somewhere you can recover it, because without it the stored tokens are unrecoverable and every upstream will need a fresh login.

## Reporting

Open a private security advisory on the repository. Please do not file a public issue for anything that lets someone read tokens or execute code.
