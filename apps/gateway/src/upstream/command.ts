import type { RuntimeKind } from "@junctio/schema";

export type CommandSpec = {
  runtime: RuntimeKind;
  command: string;
  args: string[];
};

export function buildArgv(spec: CommandSpec): string[] {
  const command = spec.command.trim();
  const args = spec.args;
  switch (spec.runtime) {
    case "npx":
      return ["npx", "-y", command, ...args];
    case "bunx":
      return ["bunx", command, ...args];
    case "uvx":
      return ["uvx", command, ...args];
    case "node":
      return ["node", command, ...args];
    case "uv":
      return ["uv", "run", ...args];
    case "custom":
      return [command, ...args];
  }
}

function quote(part: string): string {
  if (part === "") return '""';
  return /[^A-Za-z0-9_@%+=:,./-]/.test(part) ? `'${part.replaceAll("'", `'\\''`)}'` : part;
}

export function previewCommand(spec: CommandSpec): string {
  return buildArgv(spec).filter((part) => part !== "").map(quote).join(" ");
}

export type ChildEnvOptions = {
  env: Record<string, string>;
  path: string;
  home: string;
};

export function buildChildEnv(options: ChildEnvOptions): Record<string, string> {
  const base: Record<string, string> = {
    PATH: options.path,
    HOME: options.home,
    LANG: "C.UTF-8",
    NODE_ENV: "production"
  };
  const passthrough = ["NPM_CONFIG_CACHE", "BUN_INSTALL_CACHE_DIR", "UV_CACHE_DIR", "UV_PYTHON_INSTALL_DIR", "TMPDIR"];
  for (const key of passthrough) {
    const value = Bun.env[key];
    if (value) base[key] = value;
  }
  for (const [key, value] of Object.entries(options.env)) {
    if (key.startsWith("JUNCTIO_")) continue;
    base[key] = value;
  }
  return base;
}
