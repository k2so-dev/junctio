# Security

## Threat model

Junctio is a single-tenant gateway for one developer or a small trusted team. Two facts define everything below.

**It executes arbitrary code.** Adding a stdio server means the gateway will download and run a package from npm or PyPI with the arguments and environment you supply. Whoever can add a server has the same power as whoever can run shell commands as the gateway user.

**It holds the keys to every integration.** Access and refresh tokens for each connected upstream sit in the database. Someone who reads that database and the encryption secret can act as you against every service you connected.

There is no isolation between upstream servers. They share a process namespace, a filesystem and a cache volume. A malicious MCP server can read the tokens of every other one. Do not add a server you would not run locally.

**The docker socket, if you mount it, is root on the host.** The `docker` runtime needs `/var/run/docker.sock`, and anything that reaches that socket can start a privileged container, mount `/` into it and read or change every file on the machine — including the gateway's own data volume and `JUNCTIO_SECRET`. Mounting it therefore raises the stakes of everything above: whoever can add a server, and any agent holding the management token, gains that reach. Mount it only if you run container servers, and leave it out otherwise. The gateway refuses `--privileged`, `--cap-add`, `--device` and `--pid` in the arguments of a server, but that is a guard rail on the config form, not a boundary: the socket itself has no such notion. Nor does a container isolate the gateway from the server it runs — it only limits that server to the paths you handed it with `-v`.

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
- Upstream packages can be audited against the npm advisory database and OSV.dev on a schedule, and a finding can stop a server automatically. This is off by default and is advisory data, not analysis: it reports what is publicly known about a version, it cannot tell you what a package does, and a package compromised an hour ago looks clean until someone files an advisory. Read the audit section in `README.md` for what it covers.
- Dynamic client registration is open, because browser clients such as claude.ai register themselves before any human is involved. Registration alone grants nothing: every authorization stops at a consent screen that requires the admin password, and a token is bound to the endpoint named in the `resource` parameter, so it is rejected on any other endpoint.

## What is not protected

- No sandboxing of upstream processes. Use a dedicated container or VM if you need it.
- No restriction on what a container server may mount. A `-v /:/host` in the arguments is accepted, because the gateway cannot tell an intentional mount from a careless one.
- No role-based access control. Admin access is all or nothing, and an approved OAuth client reaches every tool in the namespace behind its endpoint.
- No audit log beyond the request log and the structured application log.
- The package audit does not cover container images, custom commands or remote servers, and it does not check whether a version is too new to have been reviewed by anyone.
- `JUNCTIO_SECRET` is read from the environment. Anyone who can read the process environment can decrypt the database.
- The database file is not encrypted at rest beyond the individual secret columns. Table contents such as server names, URLs and request history are plain text.

## Deployment advice

The image already runs as a non-root user and the bundled `compose.yml` mounts the root filesystem read-only, writable only at `/data`, `/cache` and `/tmp`. Keep it that way. `/tmp` stays `noexec`; package runtimes execute from `/cache/tmp` instead, which is a volume rather than a tmpfs. That is not a sandbox — a stdio upstream is code you chose to run — it only keeps the blast radius of a dropped file smaller. Put it behind TLS; OAuth will not work otherwise. Do not expose the admin UI to the public internet if you can avoid it. Back up `/data` and store `JUNCTIO_SECRET` somewhere you can recover it, because without it the stored tokens are unrecoverable and every upstream will need a fresh login.

## Reporting

Open a private security advisory on the repository. Please do not file a public issue for anything that lets someone read tokens or execute code.
