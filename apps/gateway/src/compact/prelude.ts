export const PRELUDE = String.raw`"use strict";
(() => {
  const data = JSON.parse(globalThis.__catalog);
  const limits = JSON.parse(globalThis.__limits);
  const hostLog = globalThis.__log;
  const hostCall = typeof globalThis.__call === "function" ? globalThis.__call : null;
  for (const name of ["__catalog", "__limits", "__log", "__call", "__mode"]) delete globalThis[name];

  const plain = (key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Error) return { name: value.name, message: value.message };
    if (value instanceof Map) return Object.fromEntries(value);
    if (value instanceof Set) return [...value];
    return value;
  };

  const show = (value) => {
    if (typeof value === "string") return value;
    try {
      const text = JSON.stringify(value, plain);
      return text === undefined ? String(value) : text;
    } catch {
      return String(value);
    }
  };

  let lines = 0;
  let chars = 0;
  let cut = false;
  const emit = (level, args) => {
    if (cut) return;
    const line = (level === "log" ? "" : "[" + level + "] ") + args.map(show).join(" ");
    if (lines >= limits.logLines || chars + line.length > limits.logChars) {
      cut = true;
      hostLog("[console output truncated]");
      return;
    }
    lines += 1;
    chars += line.length;
    hostLog(line);
  };
  globalThis.console = Object.freeze({
    log: (...args) => emit("log", args),
    info: (...args) => emit("info", args),
    warn: (...args) => emit("warn", args),
    error: (...args) => emit("error", args),
    debug: (...args) => emit("debug", args)
  });

  const catalog = data.tools;
  const servers = data.servers;
  globalThis.catalog = catalog;
  globalThis.servers = servers;

  const words = (text) =>
    String(text ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== "");

  let indexed = null;
  const index = () =>
    (indexed ??= catalog.map((tool, position) => {
      const [name, title, server, description] = data.words[position].map((text) =>
        text === "" ? [] : text.split(" ")
      );
      return { tool, name, title, server, description };
    }));

  const weigh = (term, tokens, weight) => {
    let best = 0;
    for (const token of tokens) {
      if (token === term) return weight;
      if (term.length >= 3 && (token.startsWith(term) || (token.length >= 4 && term.startsWith(token)))) {
        best = Math.max(best, weight * 0.6);
      }
    }
    return best;
  };

  globalThis.find = (query, limit = 10) => {
    const terms = words(query);
    const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    if (terms.length === 0) return catalog.slice(0, max);
    const phrase = String(query).toLowerCase().trim();
    const scored = [];
    for (const entry of index()) {
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const best = Math.max(
          weigh(term, entry.name, 3),
          weigh(term, entry.title, 2),
          weigh(term, entry.server, 2),
          weigh(term, entry.description, 1)
        );
        if (best > 0) matched += 1;
        score += best;
      }
      if (score === 0) continue;
      if (matched === terms.length) score *= 1.5;
      if (entry.tool.name.toLowerCase().includes(phrase)) score += 2;
      scored.push({ tool: entry.tool, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map((entry) => entry.tool);
  };

  globalThis.__serialize = (value) => {
    const text = JSON.stringify(value === undefined ? null : value, plain);
    return text === undefined ? "null" : text;
  };

  if (!hostCall) return;

  const invoke = async (name, input) => {
    const args = input === undefined ? {} : input;
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      throw new TypeError(name + " takes a single object argument");
    }
    return JSON.parse(await hostCall(name, JSON.stringify(args, plain)));
  };

  const distance = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  };

  const nearest = (name) => {
    const wanted = name.toLowerCase();
    const close = catalog
      .map((tool) => ({ name: tool.name, score: distance(wanted, tool.name.toLowerCase()) }))
      .filter((entry) => entry.score <= Math.max(2, Math.floor(wanted.length / 4)))
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map((entry) => entry.name);
    return close.length > 0 ? close : globalThis.find(name, 3).map((tool) => tool.name);
  };

  const table = {};
  for (const tool of catalog) {
    Object.defineProperty(table, tool.name, { value: (input) => invoke(tool.name, input), enumerable: true });
  }
  Object.freeze(table);

  globalThis.tools = new Proxy(table, {
    get(target, property) {
      if (typeof property !== "string" || property in target || property === "then" || property === "toJSON") {
        return target[property];
      }
      const near = nearest(property);
      const hint = near.length > 0 ? ", did you mean " + near.join(", ") + "?" : ", search the catalog for the right name";
      throw new TypeError("no tool named " + JSON.stringify(property) + hint);
    }
  });
})();
`;

export function stripFences(code: string): string {
  const trimmed = code.trim();
  const fenced = trimmed.match(/^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/);
  return (fenced?.[1] ?? trimmed).trim();
}

export function sourceCandidates(code: string): { source: string; offset: number }[] {
  const body = stripFences(code);
  if (body === "") return [];
  const expressions = new Set([body.replace(/;\s*$/, ""), body.replace(/;\s*\/\/[^\n]*$/, "")]);
  return [
    ...[...expressions].map((expression) => ({
      source: `(async () => {\nconst __fn = (\n${expression}\n);\nreturn typeof __fn === "function" ? await __fn() : await __fn;\n})()`,
      offset: 2
    })),
    { source: `(async () => {\n${body}\n})()`, offset: 1 }
  ];
}
