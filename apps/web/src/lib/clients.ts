import { latestProtocolVersion } from "@junctio/schema";

const MODERN_PROTOCOL = latestProtocolVersion;

export type AuthKind = "key" | "oauth" | "none";

export type SnippetContext = {
  url: string;
  slug: string;
  kind: AuthKind;
  token: string;
  queryUrl: string | null;
  envKey?: string;
};

export type Snippet = { title: string; code: string };

export type ClientGuide = {
  blocks: Snippet[];
  steps: string[];
  notes: string[];
  link?: { label: string; href: string };
  blocker?: string;
};

export type ClientSpec = {
  value: string;
  label: string;
  hint: string;
  prefers?: AuthKind;
  build(ctx: SnippetContext): ClientGuide;
};

const DEFAULT_ENV_KEY = "JUNCTIO_API_KEY";

function envKey(ctx: SnippetContext): string {
  return ctx.envKey ?? DEFAULT_ENV_KEY;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function bearer(ctx: SnippetContext): string {
  return ctx.kind === "oauth" ? "Bearer <access-token>" : `Bearer ${ctx.token}`;
}

function headerEntry(ctx: SnippetContext, value: string = bearer(ctx)): { headers: { Authorization: string } } | {} {
  return ctx.kind === "key" ? { headers: { Authorization: value } } : {};
}

function connectorGuide(ctx: SnippetContext, product: string, steps: string[]): ClientGuide {
  if (ctx.kind === "key" && !ctx.queryUrl) {
    return {
      blocks: [],
      steps: [],
      notes: [],
      blocker: `${product} cannot send headers, so an API key does not fit. Switch the endpoint to OAuth or Either, or enable "API key in query string" in Settings to embed the key in the URL.`
    };
  }
  const url = ctx.kind === "key" ? (ctx.queryUrl as string) : ctx.url;
  const notes = [`The gateway must be reachable from the internet over HTTPS; ${product} cannot reach localhost or a LAN address.`];
  if (ctx.kind === "key") notes.push("The key is part of the URL, so anyone who can see the connector settings has it.");
  return { blocks: [{ title: "Remote MCP server URL", code: url }], steps, notes };
}

export const CLIENTS: ClientSpec[] = [
  {
    value: "claude-code",
    label: "Claude Code",
    hint: "CLI or .mcp.json",
    build(ctx) {
      const add = `claude mcp add --transport http ${ctx.slug} ${ctx.url}`;
      const terminal =
        ctx.kind === "key"
          ? `${add} \\\n  --header "Authorization: Bearer ${ctx.token}"`
          : ctx.kind === "oauth"
            ? `${add}\nclaude mcp login ${ctx.slug}`
            : add;
      const entry = {
        type: "http",
        url: ctx.url,
        ...headerEntry(ctx, `Bearer \${${envKey(ctx)}}`)
      };
      const steps = [
        "Run the command, or put the JSON into .mcp.json at the project root (~/.claude.json for every project).",
        "Add --scope user to register the server for every project instead of only this one."
      ];
      if (ctx.kind === "oauth") steps.push("claude mcp login opens the browser; inside a session, /mcp does the same.");
      steps.push("claude mcp list, or /mcp inside a session, shows the connection status.");
      const notes =
        ctx.kind === "key"
          ? [`\${${envKey(ctx)}} in .mcp.json is expanded from the environment, so the key stays out of the file. A literal key works too.`]
          : [];
      return {
        blocks: [
          { title: "Terminal", code: terminal },
          { title: ".mcp.json", code: json({ mcpServers: { [ctx.slug]: entry } }) }
        ],
        steps,
        notes
      };
    }
  },
  {
    value: "claude-ai",
    label: "claude.ai / Claude Desktop",
    hint: "Custom connector",
    prefers: "oauth",
    build(ctx) {
      const steps = [
        "claude.ai: Customize → Connectors. Claude Desktop: Settings → Connectors.",
        "Click + → Add custom connector, paste the URL and click Add."
      ];
      if (ctx.kind === "oauth") {
        steps.push("Click Connect. The browser opens this gateway's sign-in page; approve once and the connector stays signed in.");
      }
      steps.push("Team and Enterprise: an owner adds the connector under Organization settings → Connectors first, then members click Connect.");
      return connectorGuide(ctx, "claude.ai", steps);
    }
  },
  {
    value: "chatgpt",
    label: "ChatGPT",
    hint: "Developer mode connector",
    prefers: "oauth",
    build(ctx) {
      const steps = [
        "Open Settings → Apps & Connectors → Advanced settings and enable Developer mode.",
        `Back in Apps & Connectors click Create, paste the URL and choose ${ctx.kind === "oauth" ? "OAuth" : "No authentication"}.`
      ];
      if (ctx.kind === "oauth") steps.push("Saving opens the browser sign-in; ChatGPT registers itself with the gateway automatically.");
      steps.push("Enable the connector in a chat under Tools → Developer mode.");
      return connectorGuide(ctx, "ChatGPT", steps);
    }
  },
  {
    value: "codex",
    label: "Codex CLI",
    hint: "CLI or config.toml",
    build(ctx) {
      const add = `codex mcp add ${ctx.slug} --url ${ctx.url}`;
      const terminal =
        ctx.kind === "key"
          ? `export ${envKey(ctx)}="${ctx.token}"\n${add} --bearer-token-env-var ${envKey(ctx)}`
          : ctx.kind === "oauth"
            ? `${add}\ncodex mcp login ${ctx.slug}`
            : add;
      const toml = [`[mcp_servers.${ctx.slug}]`, `url = "${ctx.url}"`];
      if (ctx.kind === "key") toml.push(`bearer_token_env_var = "${envKey(ctx)}"`);
      const steps = ["Run the command, or add the table to ~/.codex/config.toml."];
      if (ctx.kind === "key") {
        steps.push(`Export ${envKey(ctx)} in your shell profile; Codex reads it at startup and sends it as the Authorization header.`);
      }
      if (ctx.kind === "oauth") steps.push("codex mcp login opens the browser; Codex stores the tokens itself.");
      steps.push("codex mcp list shows the configured servers.");
      const notes = ctx.kind === "key" ? ['To inline the key instead, use http_headers = { Authorization = "Bearer …" } in the table.'] : [];
      return {
        blocks: [
          { title: "Terminal", code: terminal },
          { title: "~/.codex/config.toml", code: toml.join("\n") }
        ],
        steps,
        notes
      };
    }
  },
  {
    value: "cursor",
    label: "Cursor",
    hint: "mcp.json or deeplink",
    build(ctx) {
      const entry = { url: ctx.url, ...headerEntry(ctx) };
      const config = btoa(JSON.stringify(entry));
      const steps = ["Save as .cursor/mcp.json in the project, or ~/.cursor/mcp.json for every project — or click Add to Cursor."];
      if (ctx.kind === "oauth") steps.push("Cursor lists the server with Needs login; click it to sign in in the browser.");
      steps.push("Cursor Settings → MCP shows the tools once the server is connected.");
      const notes =
        ctx.kind === "key" ? [`Use \${env:${envKey(ctx)}} as the header value to read the key from the environment instead of the file.`] : [];
      return {
        blocks: [{ title: "mcp.json", code: json({ mcpServers: { [ctx.slug]: entry } }) }],
        steps,
        notes,
        link: {
          label: "Add to Cursor",
          href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(ctx.slug)}&config=${encodeURIComponent(config)}`
        }
      };
    }
  },
  {
    value: "vscode",
    label: "VS Code",
    hint: "mcp.json (Copilot)",
    build(ctx) {
      const inputId = "junctio-api-key";
      const entry = { type: "http", url: ctx.url, ...headerEntry(ctx, `Bearer \${input:${inputId}}`) };
      const file =
        ctx.kind === "key"
          ? { servers: { [ctx.slug]: entry }, inputs: [{ type: "promptString", id: inputId, description: "Junctio API key", password: true }] }
          : { servers: { [ctx.slug]: entry } };
      const blocks: Snippet[] = [{ title: ".vscode/mcp.json", code: json(file) }];
      if (ctx.kind !== "key") {
        blocks.push({ title: "Terminal", code: `code --add-mcp '${JSON.stringify({ name: ctx.slug, ...entry })}'` });
      }
      const steps = ["Save as .vscode/mcp.json in the workspace, or run MCP: Open User Configuration from the Command Palette for all workspaces."];
      if (ctx.kind === "key") steps.push("VS Code prompts for the key the first time the server starts and keeps it in its secret storage.");
      if (ctx.kind === "oauth") steps.push("VS Code opens the browser for the sign-in on the first connection.");
      steps.push("MCP: List Servers shows the status; Chat → Tools lists what the server exposes.");
      return {
        blocks,
        steps,
        notes: [],
        link: { label: "Add to VS Code", href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: ctx.slug, ...entry }))}` }
      };
    }
  },
  {
    value: "gemini",
    label: "Gemini CLI",
    hint: "CLI or settings.json",
    build(ctx) {
      const add = `gemini mcp add --transport http ${ctx.slug} ${ctx.url}`;
      const terminal = ctx.kind === "key" ? `${add} \\\n  --header "Authorization: Bearer ${ctx.token}"` : add;
      const entry = { httpUrl: ctx.url, ...headerEntry(ctx, `Bearer $${envKey(ctx)}`) };
      const steps = ["Run the command, or add the entry to ~/.gemini/settings.json (.gemini/settings.json with --scope project for one project)."];
      if (ctx.kind === "oauth") steps.push(`Type /mcp auth ${ctx.slug} inside Gemini CLI to sign in; tokens are refreshed automatically.`);
      steps.push("/mcp lists the servers and their tools.");
      const notes = ctx.kind === "key" ? [`$${envKey(ctx)} in settings.json reads the key from the environment.`] : [];
      return {
        blocks: [
          { title: "Terminal", code: terminal },
          { title: "~/.gemini/settings.json", code: json({ mcpServers: { [ctx.slug]: entry } }) }
        ],
        steps,
        notes
      };
    }
  },
  {
    value: "windsurf",
    label: "Windsurf",
    hint: "mcp_config.json",
    build(ctx) {
      const entry = { serverUrl: ctx.url, ...headerEntry(ctx) };
      const steps = ["Add the entry to ~/.codeium/windsurf/mcp_config.json, or open Windsurf Settings → Cascade → MCP servers."];
      if (ctx.kind === "oauth") steps.push("Windsurf prompts to sign in when the server is enabled.");
      steps.push("Refresh the MCP list in Cascade to load the tools.");
      const notes = ctx.kind === "key" ? [`\${env:${envKey(ctx)}} in the header value reads the key from the environment.`] : [];
      return { blocks: [{ title: "mcp_config.json", code: json({ mcpServers: { [ctx.slug]: entry } }) }], steps, notes };
    }
  },
  {
    value: "zed",
    label: "Zed",
    hint: "settings.json",
    build(ctx) {
      const entry = { url: ctx.url, ...headerEntry(ctx) };
      const steps = ["Add the entry to Zed settings (zed: open settings)."];
      if (ctx.kind === "oauth") steps.push("Without an Authorization header Zed starts the MCP OAuth flow and opens the browser.");
      steps.push("Agent panel → Settings shows the server status and its tools.");
      return { blocks: [{ title: "settings.json", code: json({ context_servers: { [ctx.slug]: entry } }) }], steps, notes: [] };
    }
  },
  {
    value: "mcp-remote",
    label: "Other (stdio via mcp-remote)",
    hint: "Clients that only launch commands",
    build(ctx) {
      const args = ["-y", "mcp-remote", ctx.url, "--transport", "http-only"];
      if (ctx.kind === "key") args.push("--header", "Authorization:${AUTH_HEADER}");
      const entry = { command: "npx", args, ...(ctx.kind === "key" ? { env: { AUTH_HEADER: `Bearer ${ctx.token}` } } : {}) };
      const steps = [
        "For clients that only launch stdio servers: the Claude Desktop config file, older editors and plugins. Paste the entry into the client's mcpServers config."
      ];
      if (ctx.kind === "oauth") steps.push("mcp-remote opens the browser on the first start and stores the tokens under ~/.mcp-auth.");
      steps.push("Needs Node 18+ on the client machine.");
      const notes =
        ctx.kind === "key"
          ? ["Authorization:${AUTH_HEADER} has no space on purpose: some clients mangle spaces inside args, so the value comes from the env block."]
          : [];
      return { blocks: [{ title: "mcpServers entry", code: json({ mcpServers: { [ctx.slug]: entry } }) }], steps, notes };
    }
  },
  {
    value: "curl",
    label: "curl",
    hint: "Raw request for a quick check",
    build(ctx) {
      const envelope = {
        "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL,
        "io.modelcontextprotocol/clientInfo": { name: "curl", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {}
      };
      const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: envelope } };
      const lines = [`curl -sS ${ctx.url} \\`];
      if (ctx.kind !== "none") lines.push(`  -H "Authorization: ${bearer(ctx)}" \\`);
      lines.push(
        '  -H "Content-Type: application/json" \\',
        '  -H "Accept: application/json, text/event-stream" \\',
        `  -H "MCP-Protocol-Version: ${MODERN_PROTOCOL}" \\`,
        '  -H "Mcp-Method: tools/list" \\',
        `  -d '${JSON.stringify(body)}'`
      );
      const notes = [
        "The gateway is stateless: no initialize call or session id is needed.",
        "Mcp-Method must name the same method as the body, and the _meta envelope replaces the old handshake.",
        `Drop both the header and params._meta to talk to the endpoint the 2025 way, if its minimum protocol is below ${MODERN_PROTOCOL}.`
      ];
      if (ctx.kind === "key") notes.push("X-API-Key: <key> works as an alternative to the Authorization header.");
      if (ctx.kind === "oauth") notes.push("OAuth endpoints need an access token from the sign-in flow; for a quick check switch the endpoint to Either and use an API key.");
      return {
        blocks: [{ title: "Terminal", code: lines.join("\n") }],
        steps: ["Lists the tools the endpoint exposes. Swap the body for tools/call with params.name and params.arguments to invoke one."],
        notes
      };
    }
  }
];
