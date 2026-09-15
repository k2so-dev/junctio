import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeKind, TransportKind } from "@junctio/schema";
import type { AuditTarget, Unsupported } from "./types.ts";

const REMOTE_PREFIXES = [
  "git+",
  "git:",
  "github:",
  "gitlab:",
  "bitbucket:",
  "gist:",
  "http://",
  "https://",
  "file:",
  "ssh://",
  "./",
  "../",
  "~/",
  "/"
];

const ARCHIVE_SUFFIXES = [".tgz", ".tar.gz", ".zip", ".whl"];

export function isRemoteSpec(spec: string): boolean {
  if (spec === "") return true;
  if (REMOTE_PREFIXES.some((prefix) => spec.startsWith(prefix))) return true;
  if (ARCHIVE_SUFFIXES.some((suffix) => spec.endsWith(suffix))) return true;
  return spec.includes("@git+") || spec.includes("@github:");
}

export function splitNpmSpec(spec: string): { name: string; range: string | null } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec, range: null };
  return { name: spec.slice(0, at), range: spec.slice(at + 1) || null };
}

export function normalizePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

export function splitPypiRequirement(requirement: string): { name: string; version: string | null } {
  const stripped = requirement.split(";")[0]!.trim();
  const match = /^([A-Za-z0-9._-]+)(\[[^\]]*\])?\s*(?:(==|===)\s*([^\s,]+))?/.exec(stripped);
  if (!match) return { name: normalizePypiName(stripped), version: null };
  return { name: normalizePypiName(match[1] ?? stripped), version: match[4] ?? null };
}

type OptionSpec = {
  value: Set<string>;
  boolean: Set<string>;
  blocked: Map<string, string>;
};

type Parsed = {
  collected: Map<string, string[]>;
  positionals: string[];
  blocked: string | null;
};

function parseOptions(args: string[], spec: OptionSpec): Parsed {
  const collected = new Map<string, string[]>();
  const positionals: string[] = [];
  let blocked: string | null = null;
  let terminated = false;

  const push = (flag: string, value: string): void => {
    const list = collected.get(flag) ?? [];
    list.push(value);
    collected.set(flag, list);
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (terminated) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      terminated = true;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const blockedReason = spec.blocked.get(flag);
    if (blockedReason && blocked === null) blocked = blockedReason;
    if (spec.value.has(flag)) {
      if (inline !== null) {
        push(flag, inline);
        continue;
      }
      const next = args[i + 1];
      if (next === undefined) continue;
      push(flag, next);
      i += 1;
      continue;
    }
    if (spec.boolean.has(flag)) continue;
    if (inline !== null) continue;
    const next = args[i + 1];
    if (next !== undefined && next.startsWith("-")) continue;
  }
  return { collected, positionals, blocked };
}

function values(parsed: Parsed, ...flags: string[]): string[] {
  const out: string[] = [];
  for (const flag of flags) out.push(...(parsed.collected.get(flag) ?? []));
  return out;
}

function unsupported(reason: string): Unsupported {
  return { kind: "unsupported", reason };
}

function npmSpecs(specs: string[]): AuditTarget | Unsupported {
  const cleaned = specs.map((spec) => spec.trim()).filter((spec) => spec !== "");
  if (cleaned.length === 0) return unsupported("no package name in the arguments");
  const remote = cleaned.find((spec) => isRemoteSpec(spec));
  if (remote) return unsupported(`"${remote}" is not a registry package`);
  return { kind: "npm", specs: cleaned };
}

const NPX_OPTIONS: OptionSpec = {
  value: new Set(["-p", "--package", "-c", "--call", "--userconfig", "--loglevel", "--node-options", "--shell"]),
  boolean: new Set([
    "-y",
    "--yes",
    "--no",
    "-q",
    "--quiet",
    "--silent",
    "--no-install",
    "--ignore-existing",
    "--prefer-online",
    "--prefer-offline",
    "--offline",
    "--shell-auto-fallback"
  ]),
  blocked: new Map([
    ["--registry", "a custom npm registry is not audited"],
    ["--userconfig", "a custom npm config is not audited"]
  ])
};

export function parseNpxArgs(args: string[]): AuditTarget | Unsupported {
  const parsed = parseOptions(args, NPX_OPTIONS);
  if (parsed.blocked) return unsupported(parsed.blocked);
  const packages = values(parsed, "-p", "--package");
  const called = values(parsed, "-c", "--call").length > 0;
  if (packages.length > 0) return npmSpecs(packages);
  if (called) return unsupported("npx --call without --package names no auditable package");
  const first = parsed.positionals[0];
  if (first === undefined) return unsupported("no package name in the arguments");
  return npmSpecs([first]);
}

const BUNX_OPTIONS: OptionSpec = {
  value: new Set(["-p", "--package"]),
  boolean: new Set(["--bun", "-b", "--no-install", "--verbose", "--silent", "-y", "--yes", "--shell"]),
  blocked: new Map([["--registry", "a custom npm registry is not audited"]])
};

export function parseBunxArgs(args: string[]): AuditTarget | Unsupported {
  const parsed = parseOptions(args, BUNX_OPTIONS);
  if (parsed.blocked) return unsupported(parsed.blocked);
  const packages = values(parsed, "-p", "--package");
  if (packages.length > 0) return npmSpecs(packages);
  const first = parsed.positionals[0];
  if (first === undefined) return unsupported("no package name in the arguments");
  return npmSpecs([first]);
}

const UVX_OPTIONS: OptionSpec = {
  value: new Set([
    "--from",
    "--with",
    "--with-editable",
    "--with-requirements",
    "--constraints",
    "-c",
    "--python",
    "-p",
    "--index",
    "--index-url",
    "--extra-index-url",
    "--index-strategy",
    "--python-preference",
    "--cache-dir",
    "--refresh-package",
    "--find-links",
    "-f"
  ]),
  boolean: new Set([
    "-q",
    "--quiet",
    "-v",
    "--verbose",
    "-n",
    "--no-cache",
    "--native-tls",
    "--offline",
    "--refresh",
    "--isolated",
    "--preview",
    "--no-progress",
    "--system",
    "--reinstall",
    "--upgrade",
    "-U",
    "--no-config",
    "--managed-python",
    "--no-managed-python"
  ]),
  blocked: new Map([
    ["--index", "a custom python index is not audited"],
    ["--index-url", "a custom python index is not audited"],
    ["--extra-index-url", "a custom python index is not audited"],
    ["--find-links", "a custom python index is not audited"],
    ["-f", "a custom python index is not audited"],
    ["--with-requirements", "a requirements file is not audited"],
    ["--with-editable", "an editable install is not audited"],
    ["--constraints", "a constraints file is not audited"]
  ])
};

function pypiRequirements(requirements: string[]): AuditTarget | Unsupported {
  const cleaned = requirements.map((item) => item.trim()).filter((item) => item !== "");
  if (cleaned.length === 0) return unsupported("no package name in the arguments");
  const remote = cleaned.find((item) => isRemoteSpec(item));
  if (remote) return unsupported(`"${remote}" is not a registry package`);
  return { kind: "pypi", requirements: cleaned };
}

export function parseUvxArgs(args: string[]): AuditTarget | Unsupported {
  const parsed = parseOptions(args, UVX_OPTIONS);
  if (parsed.blocked) return unsupported(parsed.blocked);
  const from = values(parsed, "--from");
  const withs = values(parsed, "--with");
  if (from.length > 0) return pypiRequirements([...from, ...withs]);
  const first = parsed.positionals[0];
  if (first === undefined) return pypiRequirements(withs);
  return pypiRequirements([first, ...withs]);
}

export function parseUvArgs(args: string[]): AuditTarget | Unsupported {
  const cleaned = args.map((arg) => arg.trim()).filter((arg) => arg !== "");
  if (cleaned[0] === "tool" && cleaned[1] === "run") return parseUvxArgs(cleaned.slice(2));
  if (cleaned[0] === "run") {
    const parsed = parseOptions(cleaned.slice(1), UVX_OPTIONS);
    if (parsed.blocked) return unsupported(parsed.blocked);
    const withs = values(parsed, "--with");
    if (withs.length === 0) return unsupported("uv run without --with points at a project, not a package");
    return pypiRequirements(withs);
  }
  return unsupported("only uv run and uv tool run are audited");
}

export type AuditableRow = {
  transport: TransportKind;
  runtime: RuntimeKind;
  args: string[];
  cwd: string | null;
};

export function auditTarget(row: AuditableRow): AuditTarget | Unsupported {
  if (row.transport !== "stdio") return unsupported("remote servers run code the gateway cannot inspect");
  const args = row.args.map((arg) => arg.trim()).filter((arg) => arg !== "");
  if (row.runtime === "npx") return parseNpxArgs(args);
  if (row.runtime === "bunx") return parseBunxArgs(args);
  if (row.runtime === "uvx") return parseUvxArgs(args);
  if (row.runtime === "uv") return parseUvArgs(args);
  if (row.runtime === "docker") return unsupported("container images are not audited");
  if (row.runtime === "node") {
    if (!row.cwd) return unsupported("set a working directory with package.json and bun.lock to audit this server");
    if (!existsSync(join(row.cwd, "package.json"))) return unsupported("no package.json in the working directory");
    if (!existsSync(join(row.cwd, "bun.lock"))) {
      return unsupported("no bun.lock in the working directory; run bun install --lockfile-only there");
    }
    return { kind: "node-project", cwd: row.cwd };
  }
  return unsupported("the gateway cannot tell what a custom command installs");
}
