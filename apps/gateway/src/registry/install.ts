import type {
  RegistryInputDto,
  RegistryInstallOptionDto,
  RegistryPackageKind,
  RegistryServerDto,
  ServerInput
} from "@junctio/schema";
import type { RegistryArgument, RegistryEntry, RegistryKeyValue, RegistryPackage, RegistryTransport } from "./types.ts";
import { officialMeta } from "./types.ts";

const STDIO_RUNTIMES: Record<string, "npx" | "uvx"> = { npm: "npx", pypi: "uvx" };

const UNSUPPORTED_PACKAGE: Record<string, string> = {
  oci: "container images need a runtime the gateway image does not ship",
  nuget: "nuget packages need the dotnet toolchain, which the gateway image does not ship",
  mcpb: "bundles are installed by a desktop client, not by a gateway"
};

export function serverName(name: string): string {
  const tail = name.includes("/") ? (name.split("/").pop() ?? name) : name;
  const cleaned = tail
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
  return cleaned === "" ? "server" : cleaned;
}

export function uniqueName(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const next = `${candidate.slice(0, 60)}-${suffix}`;
    if (!taken.has(next)) return next;
  }
  return candidate;
}

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function packageKind(entry: RegistryPackage): RegistryPackageKind {
  const type = entry.registryType ?? "";
  if (type === "npm") return "npm";
  if (type === "pypi") return "pypi";
  return "other";
}

function templated(value: string): boolean {
  return /\{[^}]+\}/.test(value);
}

function argumentValues(args: RegistryArgument[] | undefined): string[] {
  const out: string[] = [];
  for (const arg of args ?? []) {
    const value = arg.value ?? arg.default ?? "";
    if (arg.type === "named") {
      if (!arg.name) continue;
      if (value !== "") {
        out.push(arg.name, value);
        continue;
      }
      if (!arg.isRequired) continue;
      out.push(arg.name);
      if (arg.format !== "boolean") out.push(`<${arg.valueHint ?? "value"}>`);
      continue;
    }
    out.push(value === "" ? `<${arg.valueHint ?? arg.name ?? "value"}>` : value);
  }
  return out;
}

function environment(vars: RegistryKeyValue[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const variable of vars ?? []) {
    if (!variable.name) continue;
    env[variable.name] = variable.value ?? variable.default ?? "";
  }
  return env;
}

function inputsFrom(vars: RegistryKeyValue[] | undefined): RegistryInputDto[] {
  const inputs: RegistryInputDto[] = [];
  for (const variable of vars ?? []) {
    if (!variable.name) continue;
    const value = variable.value ?? variable.default ?? "";
    if (value !== "" && !templated(value)) continue;
    inputs.push({
      name: variable.name,
      description: variable.description ?? null,
      required: variable.isRequired ?? false,
      secret: variable.isSecret ?? false
    });
  }
  return inputs;
}

function packageIdentifier(entry: RegistryPackage): string {
  const identifier = entry.identifier ?? "";
  if (entry.registryType !== "npm") return identifier;
  return entry.version ? `${identifier}@${entry.version}` : identifier;
}

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

function packageOption(entry: RegistryPackage, index: number, name: string): RegistryInstallOptionDto {
  const kind = packageKind(entry);
  const identifier = entry.identifier ?? "unknown";
  const transport = entry.transport?.type ?? "stdio";
  const id = `package:${index}`;
  const label = `${entry.registryType ?? "package"} · ${identifier}`;
  const detail = entry.version ? `${identifier} ${entry.version}` : identifier;

  const unsupported = (reason: string): RegistryInstallOptionDto => ({
    id,
    kind,
    label,
    detail,
    supported: false,
    reason,
    draft: null,
    inputs: []
  });

  const blocked = UNSUPPORTED_PACKAGE[entry.registryType ?? ""];
  if (blocked) return unsupported(blocked);

  const runtime = STDIO_RUNTIMES[entry.registryType ?? ""];
  if (!runtime) return unsupported(`${entry.registryType ?? "this"} packages are not supported yet`);
  if (transport !== "stdio") {
    return unsupported("this package serves http itself, and the gateway launches stdio servers only");
  }

  const seed = runtime === "npx" ? ["-y"] : [];
  const args = [
    ...seed,
    ...argumentValues(entry.runtimeArguments),
    packageIdentifier(entry),
    ...argumentValues(entry.packageArguments)
  ].filter((part) => part !== "");

  return {
    id,
    kind,
    label,
    detail,
    supported: true,
    reason: null,
    draft: { ...baseDraft(name), runtime, args, env: environment(entry.environmentVariables) },
    inputs: inputsFrom(entry.environmentVariables)
  };
}

function remoteOption(remote: RegistryTransport, index: number, name: string): RegistryInstallOptionDto {
  const url = remote.url ?? "";
  const id = `remote:${index}`;
  const label = `remote · ${remote.type ?? "unknown"}`;
  const detail = url;

  if (remote.type !== "streamable-http") {
    return {
      id,
      kind: "remote",
      label,
      detail,
      supported: false,
      reason: "the gateway speaks streamable http only, legacy sse endpoints are not proxied",
      draft: null,
      inputs: []
    };
  }

  const headers = environment(remote.headers);
  const authorization = Object.keys(headers).find((key) => key.toLowerCase() === "authorization");

  return {
    id,
    kind: "remote",
    label,
    detail,
    supported: url !== "",
    reason: url === "" ? "the registry entry has no url" : null,
    draft:
      url === ""
        ? null
        : {
            ...baseDraft(name),
            transport: "http",
            url,
            authMode: authorization ? "header" : "none",
            headers: authorization ? { Authorization: headers[authorization] ?? "" } : {}
          },
    inputs: inputsFrom(remote.headers)
  };
}

export function installOptions(entry: RegistryEntry, name: string): RegistryInstallOptionDto[] {
  const packages = (entry.server.packages ?? []).map((item, index) => packageOption(item, index, name));
  const remotes = (entry.server.remotes ?? []).map((item, index) => remoteOption(item, index, name));
  return [...remotes, ...packages];
}

export function serverKinds(entry: RegistryEntry): RegistryPackageKind[] {
  const kinds = new Set<RegistryPackageKind>();
  for (const item of entry.server.remotes ?? []) if (item.url) kinds.add("remote");
  for (const item of entry.server.packages ?? []) kinds.add(packageKind(item));
  return [...kinds];
}

export function summarize(entry: RegistryEntry, installed: boolean): RegistryServerDto {
  const meta = officialMeta(entry);
  const options = installOptions(entry, "preview");
  return {
    name: entry.server.name,
    title: entry.server.title ?? null,
    description: entry.server.description ?? "",
    version: entry.server.version ?? "",
    repositoryUrl: entry.server.repository?.url ?? null,
    websiteUrl: entry.server.websiteUrl ?? null,
    publishedAt: timestamp(meta.publishedAt),
    updatedAt: timestamp(meta.updatedAt),
    status: meta.status ?? "unknown",
    kinds: serverKinds(entry),
    installable: options.some((option) => option.supported),
    installed
  };
}
