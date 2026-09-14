export const DEFAULT_SEPARATOR = "__";

export function exposedToolName(prefix: string, toolName: string, separator: string): string {
  return `${prefix}${separator}${toolName}`;
}

export function splitToolName(exposed: string, separator: string): { prefix: string; tool: string } | null {
  const index = exposed.indexOf(separator);
  if (index <= 0) return null;
  const prefix = exposed.slice(0, index);
  const tool = exposed.slice(index + separator.length);
  if (tool === "") return null;
  return { prefix, tool };
}

export function uriPrefix(prefix: string): string {
  return prefix.replaceAll("_", "-").toLowerCase();
}

export function exposedUri(prefix: string, uri: string): string {
  return `${uriPrefix(prefix)}+${uri}`;
}

export function splitUri(exposed: string): { prefix: string; uri: string } | null {
  const index = exposed.indexOf("+");
  if (index <= 0) return null;
  return { prefix: exposed.slice(0, index), uri: exposed.slice(index + 1) };
}

export type PrefixEntry = { serverId: string; serverName: string; prefix: string };

export class CollisionError extends Error {
  constructor(
    message: string,
    readonly conflicts: string[]
  ) {
    super(message);
    this.name = "CollisionError";
  }
}

export function assertUniquePrefixes(entries: PrefixEntry[]): void {
  const conflicts: string[] = [];
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const existing = seen.get(entry.prefix);
    if (existing) conflicts.push(`prefix "${entry.prefix}" is used by both ${existing} and ${entry.serverName}`);
    else seen.set(entry.prefix, entry.serverName);
  }
  const seenUri = new Map<string, string>();
  for (const entry of entries) {
    const key = uriPrefix(entry.prefix);
    const existing = seenUri.get(key);
    if (existing && existing !== entry.serverName) {
      conflicts.push(`prefixes of ${existing} and ${entry.serverName} collide in resource uris as "${key}"`);
    } else seenUri.set(key, entry.serverName);
  }
  if (conflicts.length > 0) throw new CollisionError(conflicts.join("; "), conflicts);
}

export function assertUniqueToolNames(names: { exposed: string; serverName: string }[]): void {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const item of names) {
    const existing = seen.get(item.exposed);
    if (existing) conflicts.push(`tool "${item.exposed}" is exposed by both ${existing} and ${item.serverName}`);
    else seen.set(item.exposed, item.serverName);
  }
  if (conflicts.length > 0) throw new CollisionError(conflicts.join("; "), conflicts);
}
