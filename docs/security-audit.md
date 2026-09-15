# Security audit

The gateway runs packages you did not write. It can check them for known vulnerabilities on a schedule and act on what it finds. The feature is off by default, because it is the only part of the gateway that talks to anything but your own upstreams.

Turned on in Settings, a background job resolves the dependency tree of every stdio server and looks it up:

| Runtime | How it is resolved | Where the advisories come from |
| --- | --- | --- |
| `npx`, `bunx` | a synthesized manifest and `bun install --lockfile-only` | `bun audit`, which reads the npm advisory database |
| `node` | the `bun.lock` in the server's working directory | `bun audit` |
| `uvx`, `uv` | `uv pip compile` | OSV.dev |
| the gateway itself | its own `bun.lock` | `bun audit`, report only |

Container images, custom commands and remote servers are marked "not audited" with the reason, because the gateway cannot tell which packages they contain.

What a finding does is yours to decide, per severity:

| Action | Effect |
| --- | --- |
| `ignore` | the finding is listed and nothing else happens |
| `report` | a badge on the server, `degraded` on `/health`, a line in the log |
| `quarantine` | the process is stopped and new calls are refused until a later audit comes back clean |
| `disable` | the server is switched off and stays off until a human switches it back on |

The defaults quarantine a critical finding, report high and moderate, and ignore low. A quarantine lifts itself as soon as an audit no longer finds anything at that level; you can also lift it by hand, or add an advisory to a per-server ignore list when you have read it and decided it does not apply. An advisory published without a severity counts as moderate and is displayed as unknown.

A run happens on the interval you set (a day by default), right after a server is created or its command changes, and whenever you press the button. A failed run — no network, a registry that will not answer — is recorded as an error and changes no sanctions, so an outage never takes your servers down.

One caveat worth knowing: `npx some-server` without a version is audited at the version that resolves while the audit runs, which is not necessarily the one that will be spawned later. Pin the version if that matters to you.

The management MCP server can read audit results and start a run. Switching the audit on, changing what a severity does, ignoring an advisory and lifting a quarantine are reserved for a human in the web UI.
