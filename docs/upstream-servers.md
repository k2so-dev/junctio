# Upstream servers

A server is `stdio`, `http` or `sse`.

For stdio the `runtime` field is the launcher and everything else is yours: the arguments you type are passed through in order, one per line. `custom` takes the executable from the first argument.

| Runtime | Arguments | Resulting command |
|---|---|---|
| `npx` | `-y`, `@scope/pkg`, `/data` | `npx -y @scope/pkg /data` |
| `uv` | `run`, `main.py` | `uv run main.py` |
| `docker` | `run`, `-i`, `--rm`, `ghcr.io/x/y` | `docker run -i --rm ghcr.io/x/y` |
| `custom` | `/usr/local/bin/srv`, `--flag` | `/usr/local/bin/srv --flag` |

Nothing is added behind your back. The form seeds `-y` for `npx` and `run` for `uv` because those are what you almost always want, but they are ordinary text you can delete. The same goes for flags the gateway has no opinion about: `bunx` honours the package shebang and runs most CLIs under Node, so add `--bun` yourself if you want Bun to execute it.

The environment handed to a child process is built explicitly: the `PATH` from settings, `HOME`, `TMPDIR` and the variables you configured. Nothing else is inherited, and `JUNCTIO_*` variables are never passed down. That `PATH` defaults to the directories where the gateway found `bun`, `node` and `uv` at first start, plus the system ones; change it in Settings if a runtime lives elsewhere.

`TMPDIR` matters more than it looks: `bunx` unpacks and executes packages there, so a temporary directory mounted `noexec` makes it exit with status 1 and no output at all. The image points `TMPDIR` at `/cache/tmp` for that reason, and the gateway warns at startup if the directory it ends up with is `noexec`.

## Remote servers

`http` is Streamable HTTP, the transport every current server should be on: the url is the endpoint, and each request is an ordinary POST. `sse` is the HTTP+SSE transport deprecated in the 2025-03-26 revision, still the only thing a good number of hosted servers speak. There the url is the stream: the gateway opens a GET, reads the `endpoint` event the server answers with, and POSTs its requests there. One stream is held per connection, and when the server drops it the connection is discarded and reopened on the next call rather than resumed, because the server has forgotten the session either way.

Pick the transport the server documents. The gateway does not probe a url to find out which one it is, since the two expect different addresses and a wrong guess reads as an auth failure. Both transports take a static header or the OAuth flow, and both are terminated at the gateway: **what your own clients speak is always Streamable HTTP**, whatever the upstream turned out to be.

For HTTP the gateway speaks Streamable HTTP. The auth mode is `none`, `header` for a static token, or `oauth` for the full client flow.

## Servers that ship as an image

Some servers are published only as a container. The `docker` runtime takes the `docker run` line those projects print, minus the word `docker`, and runs it over the Docker Engine API. The image ships no docker client: the gateway talks to the daemon socket itself, so a stop is a stop rather than a signal sent to a wrapper process.

Mount the socket and join its group:

```yaml
services:
  junctio:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    group_add:
      - "${DOCKER_GID}"
```

`DOCKER_GID` comes from `stat -c %g /var/run/docker.sock`. The repository carries this as `compose.docker.yml`:

```bash
DOCKER_GID=$(stat -c %g /var/run/docker.sock) \
  docker compose -f compose.yml -f compose.docker.yml up -d
```

**Handing over that socket is handing over the host.** Anything that reaches it can start a privileged container and read every file on the machine. Mount it only if you actually run container servers, and read [SECURITY.md](../.github/SECURITY.md) first.

The gateway reads the flags it can carry over to the API — `-e`, `-v`, `--mount`, `--network`, `-w`, `-u`, `--entrypoint`, `--init`, `--pull`, `--label` — ignores `-t`, `--name` and `--platform` with a note, and refuses everything else by name when you save, rather than dropping it quietly. `-d`, `-p` and `--privileged` are refused on purpose: the container has to stay attached to the gateway's stdio, an stdio server publishes no port, and a privileged container is not something a config paste should be able to ask for.

The container's environment is the Environment you filled in plus any `-e KEY=value` in the arguments; a bare `-e KEY` takes its value from that same list, the way docker takes it from your shell. `JUNCTIO_*` variables are never passed down. A `-v` path is resolved by the daemon, so it is a path on the host, not inside the gateway container.

Containers are named `junctio-<server>-<gateway>` and carry `junctio.gateway` and `junctio.server` labels. Stopping removes them, and a gateway that comes back from a crash sweeps whatever its own last run left behind. The gateway id is generated once and kept in the database, so several gateways can share one daemon without clearing each other's containers. One wrinkle worth knowing: a process running as PID 1 in a container ignores `SIGTERM` unless it installs a handler, so a stop waits out the five second grace and then kills it. Add `--init` to the arguments and it shuts down at once.

## OAuth

For an upstream with `auth_mode: oauth` the gateway runs the full client flow: RFC 9728 discovery, RFC 8414 metadata, dynamic client registration when there is no client ID, PKCE, and a callback on `/oauth/upstream/callback/:server_id`. The `resource` parameter is sent on both the authorize and the token request.

After that:

- **Proactive refresh.** A scheduler checks every minute and refreshes before expiry. The window is one fifth of the token lifetime, and at least five minutes for tokens that live longer than ten minutes.
- **Reactive refresh.** A 401 from an upstream triggers one refresh and one retry. A second 401 sets the server to `needs_reauth` instead of looping.
- **Single flight.** Concurrent requests that find an expiring token wait on one shared refresh. Twenty parallel calls produce exactly one request to the token endpoint.
- **Atomic rotation.** The new access and refresh tokens are written in one transaction.
- **No refresh token?** The server is marked `no_refresh` and the UI warns you that a manual re-login is coming.
