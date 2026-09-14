import type { RuntimeKind, ServerInput } from "./server.ts";

export type ParsedServer = {
  key: string;
  draft: ServerInput | null;
  summary: string;
  notes: string[];
};

export type ParsedConfig = {
  servers: ParsedServer[];
  error: string | null;
};

type RawServer = Record<string, unknown>;

const RUNTIMES: RuntimeKind[] = ["npx", "bunx", "uvx", "uv", "node"];

const NO_RUNTIME: Record<string, string> = {
  docker: "the gateway image ships no docker, run the server directly instead",
  podman: "the gateway image ships no podman, run the server directly instead",
  dotnet: "the gateway image ships no dotnet toolchain",
  deno: "the gateway image ships no deno runtime"
};

function baseDraft(name: string): ServerInput {
  return {
    name,
    transport: "stdio",
    runtime: "custom",
    args: [],
    env: {},
    cwd: null,
    url: null,
    headers: {},
    authMode: "none",
    oauthScope: null,
    enabled: true,
    warm: false,
    idleTimeoutSec: 900
  };
}

function cleanName(value: string): string {
  const tail = value.includes("/") ? (value.split("/").pop() ?? value) : value;
  const cleaned = tail
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
  return cleaned === "" ? "server" : cleaned;
}

function quote(part: string): string {
  if (part === "") return '""';
  return /[^A-Za-z0-9_@%+=:,./-]/.test(part) ? `'${part.replaceAll("'", `'\\''`)}'` : part;
}

function isObject(value: unknown): value is RawServer {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stringMap(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") out[key] = String(item);
  }
  return out;
}

function templated(value: string): boolean {
  return value.includes("${") || /^<[^>]+>$/.test(value);
}

function looksLikeServer(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.command === "string" ||
    typeof value.url === "string" ||
    typeof value.serverUrl === "string" ||
    typeof value.httpUrl === "string"
  );
}

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z0-9]*\n?/g, "").replace(/```/g, "");
}

function balanced(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (quoted) escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function decodeBase64(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return atob(normalized);
  } catch {
    return null;
  }
}

function fromVsCodeLink(text: string): unknown | null {
  const match = /^vscode(?:-insiders)?:mcp\/install\?(.+)$/s.exec(text);
  if (!match?.[1]) return null;
  const payload = decodeURIComponent(match[1]);
  const parsed = parseJson(payload);
  if (!isObject(parsed)) return null;
  const name = typeof parsed.name === "string" ? parsed.name : "server";
  const { name: _ignored, ...rest } = parsed;
  return { mcpServers: { [name]: rest } };
}

function fromCursorLink(text: string): unknown | null {
  const match = /^cursor:\/\/[^?]*\?(.+)$/s.exec(text);
  if (!match?.[1]) return null;
  const params = new URLSearchParams(match[1]);
  const config = params.get("config");
  if (config === null) return null;
  const decoded = decodeBase64(config) ?? config;
  const parsed = parseJson(decoded);
  if (!isObject(parsed)) return null;
  const name = params.get("name") ?? "server";
  if (looksLikeServer(parsed)) return { mcpServers: { [name]: parsed } };
  return { mcpServers: parsed };
}

function entriesOf(root: unknown): [string, unknown][] | null {
  if (!isObject(root)) return null;
  const wrapper = isObject(root.mcpServers) ? root.mcpServers : isObject(root.servers) ? root.servers : null;
  if (wrapper) return Object.entries(wrapper);
  if (looksLikeServer(root)) {
    const name = typeof root.name === "string" ? root.name : "server";
    return [[name, root]];
  }
  const entries = Object.entries(root);
  if (entries.length > 0 && entries.every(([, value]) => looksLikeServer(value))) return entries;
  return null;
}

function httpDraft(key: string, raw: RawServer, url: string, notes: string[]): ServerInput {
  const headers = stringMap(raw.headers);
  for (const [name, value] of Object.entries(headers)) {
    if (templated(value)) {
      headers[name] = "";
      notes.push(`fill in the ${name} header`);
    }
  }
  const authorization = Object.keys(headers).find((name) => name.toLowerCase() === "authorization");
  return {
    ...baseDraft(cleanName(key)),
    transport: "http",
    url,
    headers,
    authMode: authorization ? "header" : "none"
  };
}

function stdioDraft(key: string, raw: RawServer, command: string, notes: string[]): ServerInput {
  const args = stringList(raw.args);
  const known = RUNTIMES.find((runtime) => runtime === command);
  const env = stringMap(raw.env);
  for (const [name, value] of Object.entries(env)) {
    if (templated(value)) {
      env[name] = "";
      notes.push(`fill in ${name}`);
    }
  }
  if (args.some(templated)) notes.push("replace the placeholders in the arguments");
  if (args.length === 0) notes.push("no arguments given, add what this server needs");
  const blocked = NO_RUNTIME[command];
  if (blocked) notes.push(blocked);
  const cwd = typeof raw.cwd === "string" && raw.cwd !== "" ? raw.cwd : null;
  return {
    ...baseDraft(cleanName(key)),
    runtime: known ?? "custom",
    args: known ? args : [command, ...args],
    env,
    cwd
  };
}

function summarize(draft: ServerInput): string {
  if (draft.transport === "http") return draft.url ?? "";
  const argv = draft.runtime === "custom" ? draft.args : [draft.runtime, ...draft.args];
  return argv.map(quote).join(" ");
}

function refused(key: string, summary: string, note: string): ParsedServer {
  return { key, draft: null, summary, notes: [note] };
}

function convert(key: string, value: unknown): ParsedServer {
  if (!isObject(value)) return refused(key, "", "this entry is not an object");

  const type = typeof value.type === "string" ? value.type.toLowerCase() : null;
  const transport = typeof value.transport === "string" ? value.transport.toLowerCase() : null;
  const url =
    typeof value.url === "string"
      ? value.url
      : typeof value.httpUrl === "string"
        ? value.httpUrl
        : typeof value.serverUrl === "string"
          ? value.serverUrl
          : null;

  if (type === "sse" || transport === "sse") {
    return refused(key, url ?? "", "legacy SSE is not proxied, the gateway speaks streamable http only");
  }

  if (url !== null) {
    const notes: string[] = [];
    if (templated(url)) return refused(key, url, "the url is a placeholder, fill it in by hand");
    const draft = httpDraft(key, value, url, notes);
    return { key, draft, summary: summarize(draft), notes };
  }

  const command = typeof value.command === "string" ? value.command.trim() : "";
  if (command === "") return refused(key, "", "this entry has neither a command nor a url");

  const notes: string[] = [];
  const draft = stdioDraft(key, value, command, notes);
  return { key, draft, summary: summarize(draft), notes };
}

export function parseMcpConfig(text: string): ParsedConfig {
  const trimmed = text.trim();
  if (trimmed === "") return { servers: [], error: null };

  const root =
    fromVsCodeLink(trimmed) ??
    fromCursorLink(trimmed) ??
    (() => {
      const block = balanced(stripFences(trimmed));
      return block === null ? null : parseJson(block);
    })();

  if (root === null) {
    if (/^\w+:\/\//.test(trimmed) || trimmed.startsWith("vscode:")) {
      return { servers: [], error: "this link carries no config the gateway can read" };
    }
    return { servers: [], error: "that is not valid JSON, paste the object the site shows you" };
  }

  const entries = entriesOf(root);
  if (entries === null || entries.length === 0) {
    return { servers: [], error: "no server found, the snippet usually starts with mcpServers or servers" };
  }

  return { servers: entries.map(([key, value]) => convert(key, value)), error: null };
}
