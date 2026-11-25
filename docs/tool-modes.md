# Tool modes

An endpoint hands its tools to a client in one of two modes.

- **Full** lists every tool of every server in the namespace, as an MCP server normally does. The client puts all of them, with their descriptions and input schemas, into the model's context.
- **Compact** lists two tools, `search` and `execute`. The model looks tools up in the catalog and calls them from a short piece of JavaScript, so the catalog stays on the gateway and only what the model asked for reaches its context.

Compact mode is the pattern Cloudflare calls [Code Mode](https://blog.cloudflare.com/code-mode-mcp/) and uses for its own [API server](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/). Junctio applies it to whatever servers you put behind an endpoint.

## Why compact

In full mode every tool costs its name, its description and its input schema, on every turn, whether the model uses it or not. A handful of busy servers adds up to tens of thousands of tokens before the conversation starts, and a long tool list also makes the model worse at picking the right one.

In compact mode the cost is the two tool definitions, about a thousand tokens, plus one line per server. It stays there whether the servers behind the endpoint have ten tools or five hundred.

The second gain is fewer round trips. A model that needs three lookups and a write makes four tool calls in full mode, each passing its whole result through the context. In compact mode it writes one function that makes the four calls, filters the results and returns only what it needs.

## Choosing the mode

**New installations start in compact mode.** Every endpoint you create gets the default from Settings → General → *Tools of new endpoints*, which is compact on a fresh database.

**Upgrades keep full mode.** When a gateway that already has data is upgraded, every existing endpoint is set to full and the default for new endpoints is set to full too, so nothing changes for the clients you already have. Switch an endpoint on its page, or change the default in Settings, when you are ready.

Per endpoint, the *Tools* card on the endpoint page switches between the two. Through the API it is the `toolMode` field of an endpoint (`"compact"` or `"full"`) and `defaultToolMode` in the settings; the [management server](management-mcp.md) takes the same fields.

Per client, add `?tools=compact` or `?tools=full` to the endpoint URL. The parameter overrides the endpoint's mode for that client only, so one endpoint can serve a client that wants compact and one that wants full. Any other value is refused with a 400.

```
https://mcp.example.com/mcp/main?tools=full
```

Full mode is the better choice when:

- the client already defers or searches tools on its own, or runs its own code mode and wants plain tools to call from it;
- the namespace has a handful of small tools, where the saving is small;
- you rely on the client asking for approval per tool (see [Approvals](#approvals) below);
- the model is a small one that writes JavaScript poorly.

## How compact mode works

### search

`search` takes one argument, `code`: an async arrow function that runs against the catalog and returns whatever the model wants to see. Nothing is called; it only reads.

The tool description carries the list of servers behind the endpoint, each with its tool count and the first paragraph of its instructions, the types of the catalog, and examples. Inside the code these are available:

```ts
interface Tool {
  name: string;          // the name to call in execute
  server: string;        // the server prefix
  title?: string;
  description: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  inputSchema: object;
  outputSchema?: object;
  signature: string;     // TypeScript declaration with every description
}

interface Server {
  name: string;
  summary: string | null;
  instructions: string | null;
  tools: number;
  quarantined: boolean;
}

declare const catalog: Tool[];
declare const servers: Server[];
declare function find(query: string, limit?: number): Tool[];
```

`find` ranks tools by how well the words of the query match their name, title, server and description, so most lookups are one line:

```js
async () => find("open issues").map((tool) => tool.signature)
```

### Descriptions travel as TypeScript

A JSON Schema is a poor way to show a model what a tool takes. Each catalog entry therefore carries a `signature`: the tool rendered as a TypeScript declaration, with the description, the property descriptions, defaults, formats and limits as doc comments, and the output type when the tool declares an output schema.

```ts
/**
 * Counts the words of a text
 * Read-only.
 */
mock__stats(input: {
  /** Text to count */
  text: string;
}): Promise<{
  words: number;
  chars: number;
}>;
```

Local `$ref`s are followed, recursive schemas stop at `unknown`, enums become unions of literals and names that are not identifiers are quoted. Everything you set in the namespace applies before the catalog is built: a hidden tool is not in it, a renamed tool has its new title, a rewritten description or added annotations show up in the signature.

### execute

`execute` also takes `code`, and inside it every tool is a function on `tools`:

```js
async () => {
  const [issues, pulls] = await Promise.all([
    tools.github__list_issues({ repo: "acme/api", state: "open" }),
    tools.github__list_pull_requests({ repo: "acme/api" })
  ]);
  return {
    issues: issues.map((issue) => issue.title),
    pulls: pulls.length
  };
}
```

Names that are not plain identifiers are reached with brackets, `tools["docs__search-pages"]({ query })`. `catalog`, `servers` and `find` from search are available here too. The code may also be a bare function body that ends with `return`.

What a tool call returns inside the code:

| The tool returned | The code gets |
| --- | --- |
| `structuredContent` (a tool with an output schema) | that object |
| text only | the text, parsed as JSON when it is JSON |
| text with images, audio or resources | `{ content: [...] }`, binary parts replaced by placeholders |
| nothing | `null` |
| `isError: true` | a thrown `ToolError` carrying the tool's message |

A refusal from the gateway itself, a quarantined server or an expired upstream login for example, is thrown as a `GatewayError`. An unknown name throws a `TypeError` that suggests the closest names.

**Binary content.** An image is passed to the code as `{ type: "image", mimeType, attachment: "attachment-1" }` instead of its base64 data. If the value the code returns contains a placeholder, the gateway attaches the real image to the result, so the model sees it; placeholders the code drops cost nothing. Up to ten attachments and 8 MiB per run.

**The result.** Whatever the function returns goes back as text: a string as it is, anything else as JSON. `console.log`, `info`, `warn` and `error` lines come back in a second block. A result longer than about 6,000 tokens is cut while staying valid JSON, long arrays keep their first items and long strings are clipped, and a note asks the model to return less.

**Errors.** When the code throws, the result is an error that names the exception, the line when the error came from the code itself, and lists the tool calls that ran before it with their outcome. Calls that succeeded have taken effect, and the message says so, so a model does not blindly repeat a write.

**Calls still running when the function returns are cancelled.** When the client disconnects, the whole run stops and the calls it was waiting on are cancelled with it.

### Instructions

The endpoint's instructions start with a short paragraph explaining search and execute, followed by the usual composed instructions: the namespace description and one section per server. Tool names mentioned there are catalog names, which is what the code calls.

### What does not change

- Resources and prompts are listed and read exactly as in full mode.
- A tool can still be called directly by its catalog name, `github__list_issues`, even though it is not listed. A client that cached a full tool list keeps working after you switch an endpoint to compact.
- Hidden tools stay hidden: they are not in the catalog and calling them fails, from the code or directly.
- The [security audit](security-audit.md) gate applies to every call the code makes, the same way it does to a direct call.

## The sandbox

The code a model writes is untrusted, so it never runs inside the gateway process.

Every run starts a fresh child process that evaluates the code in [QuickJS](https://github.com/quickjs-ng/quickjs) compiled to WebAssembly. The interpreter has no network, no file system, no timers, no environment and no module loader. The only way out is the `tools` functions, which send a message to the gateway, and those reach exactly the tools a full-mode client of the same endpoint could call. Upstream credentials stay in the gateway; the code never sees a token or a header.

| Limit | Value |
| --- | --- |
| Wall clock per execute run | 120 s, then the process is killed |
| Wall clock per search run | 10 s |
| Tool calls per run | 100 |
| Tool calls in flight at once | 8 |
| Memory | 64 MiB |
| Stack | 1 MiB |
| Code size | 100,000 characters |
| Console output | 200 lines, 8,000 characters |
| Result | about 6,000 tokens |
| Runs at once, gateway-wide | 8, with up to 32 waiting |

A loop that never ends is interrupted inside the interpreter and the process is killed at the deadline, so it costs one core for at most the time limit and never blocks the gateway. A run that would wait behind 32 others is refused straight away with a message to retry.

## Approvals

Clients that ask before a tool runs see `execute`, not the individual tools the code calls. Approving `execute` once approves whatever the code does. Its annotations are derived from the catalog: `readOnlyHint` only when every tool behind the endpoint is read-only, `destructiveHint` as soon as one tool might be destructive. A client that auto-approves read-only tools will therefore auto-approve `execute` only on an endpoint where nothing can write.

If per-tool approval matters for some tools, hide them from the namespace, put them behind a separate endpoint in full mode, or give that client `?tools=full`.

## Request log

A compact run writes one row for the `search` or `execute` call and one row per tool the code called, with the server and the outcome, so per-server statistics look the same as in full mode. A failed run carries one of these codes:

| Code | Meaning |
| --- | --- |
| `code_error` | the code threw, including a tool error it did not catch |
| `code_timeout` | the run hit its time limit |
| `code_cancelled` | the client cancelled the request |
| `sandbox_crashed` | the interpreter process died, usually out of memory |
| `sandbox_busy` | too many runs were waiting |
