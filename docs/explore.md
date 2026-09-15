# Explore

The Explore page has two tabs. The first lists what other people have published to the official MCP registry at `registry.modelcontextprotocol.io`, so you can add a server without hunting for its package name. The second points at every other place servers are published, and takes their config back.

The browser never talks to the registry. The gateway does, over its public read-only endpoints, with no key and no account. It asks only when you open the page, type a search or press refresh, and it sends nothing but your search term and the name of an entry you opened. Every answer is stored in `junctio.db` for an hour, so paging back and forth costs nothing, and entries older than a day are swept away.

If the registry is slow or down, a request gives up after ten seconds and the page falls back to the cached copy, saying how old it is and what went wrong. With nothing cached you get an error and a retry button instead of an empty table.

The registry searches by name only and has no filters, so the page offers search, paging and nothing it cannot honour. Paging is by cursor: the registry publishes no total, and counting more than twenty thousand entries by hand would cost hundreds of requests, so there are no page numbers to render. Every row is the latest version of that server.

Each row links out to whatever the entry declares, in a new tab: the repository, the project website, the npm or PyPI page of the package, and the raw registry entry itself.

| Published as | What the gateway does |
|---|---|
| npm package, stdio | Prefills an `npx` server with the pinned version, its arguments and its environment |
| PyPI package, stdio | Prefills a `uvx` server |
| Remote Streamable HTTP | Prefills an HTTP server, with the `Authorization` header when the entry declares one |
| Remote SSE | Prefills an `sse` server with the stream url and its declared headers |
| Container image, stdio | Prefills a `docker` server with `run -i --rm`, the declared mounts and the image |
| NuGet, bundle | Refused: the image ships no dotnet toolchain, and bundles are a desktop client's job |

Install opens the ordinary Add server form with the fields already filled in, including placeholders like `<allowed_directory>` where the registry says an argument is needed. Nothing is written to the database until you press save, so secrets and paths are yours to fill in first, with the exact command shown next to the form.

## Other sources

The official registry is not where most servers live. The second tab is a catalog of the places that are: the canonical lists, the large indexes, the hand-kept directories, the vendor stores and the Chinese markets, which carry a different set of servers altogether. Entries that publish a machine-readable listing wear an `API` badge; the rest are for reading with your own eyes. Vendors sit in their own group because a vendor page is one company's integrations, not a general catalog, and clicking one expecting a directory is a waste of a tab.

Nothing on that tab talks to those sites. The list lives in `apps/web/src/data/sources.json` and the icons are files in `apps/web/public/sources`, so the page renders without a single outbound request, exactly like the first tab. Add a source with a pull request against that file plus its icon. A scheduled job walks every URL once a week and opens an issue when one dies, because a catalog of broken links is worse than no catalog.

Sending you away without a way back would be pointless, so the tab starts with a box you paste a config into. Every site in the world shows the same snippet:

```json
{ "mcpServers": { "foo": { "command": "npx", "args": ["-y", "@x/foo"] } } }
```

Paste it and each server in it turns into a row with the command it would run and an Add button. The `mcpServers` wrapper is read, so is the VS Code `servers` wrapper with `type: http`, so is a bare server object, and so are the `vscode:mcp/install` and `cursor://` links a site hands to your editor. A fenced snippet with prose around it is fine, the object is dug out. An `npx`, `bunx`, `uvx`, `uv` or `node` command becomes that runtime, `docker` and `podman` become the docker runtime with their `run` line intact, and anything else becomes a custom command. Placeholders like `${input:token}` are blanked and listed as things to fill in, and a `type: sse` entry becomes an `sse` server with a note saying so.

The parsing happens in your browser. Nothing is sent to the gateway and nothing is written until you press save on the Add server form, which matters because these snippets often carry a token.
