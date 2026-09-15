import type { RuntimeKind } from "@junctio/schema";

export type CommandSpec = {
  runtime: RuntimeKind;
  args: string[];
};

export function buildArgv(spec: CommandSpec): string[] {
  const args = spec.args.map((part) => part.trim()).filter((part) => part !== "");
  if (spec.runtime === "custom") return args;
  return [spec.runtime, ...args];
}

function quote(part: string): string {
  if (part === "") return '""';
  return /[^A-Za-z0-9_@%+=:,./-]/.test(part) ? `'${part.replaceAll("'", `'\\''`)}'` : part;
}

export function previewCommand(spec: CommandSpec): string {
  return buildArgv(spec).map(quote).join(" ");
}

export type ChildEnvOptions = {
  env: Record<string, string>;
  path: string;
  home: string;
  runtime?: RuntimeKind;
};

const AUDITED_RUNTIMES = new Set<RuntimeKind>(["npx", "bunx", "uvx", "uv"]);

const REDIRECTING_ENV = new Set([
  "bun_config_registry",
  "node_options",
  "npm_config_userconfig",
  "npm_config_globalconfig",
  "pip_config_file",
  "pip_extra_index_url",
  "pip_index_url",
  "uv_config_file",
  "uv_default_index",
  "uv_extra_index_url",
  "uv_find_links",
  "uv_index",
  "uv_index_url"
]);

function redirectsResolution(key: string): boolean {
  const lowered = key.toLowerCase();
  return REDIRECTING_ENV.has(lowered) || lowered.startsWith("npm_config_registry");
}

export function buildChildEnv(options: ChildEnvOptions): Record<string, string> {
  const base: Record<string, string> = {
    PATH: options.path,
    HOME: options.home,
    LANG: "C.UTF-8",
    NODE_ENV: "production"
  };
  const passthrough = [
    "NPM_CONFIG_CACHE",
    "BUN_INSTALL_CACHE_DIR",
    "UV_CACHE_DIR",
    "UV_PYTHON_INSTALL_DIR",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "TMPDIR"
  ];
  for (const key of passthrough) {
    const value = Bun.env[key];
    if (value) base[key] = value;
  }
  const audited = options.runtime !== undefined && AUDITED_RUNTIMES.has(options.runtime);
  for (const [key, value] of Object.entries(options.env)) {
    if (key.startsWith("JUNCTIO_")) continue;
    if (audited && redirectsResolution(key)) continue;
    base[key] = value;
  }
  return base;
}
