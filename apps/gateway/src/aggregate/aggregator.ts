import { and, eq } from "drizzle-orm";
import type {
  CallToolResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  ResourceTemplateType,
  Tool
} from "@modelcontextprotocol/client";
import type { Db } from "../db/index.ts";
import { namespaceServers, namespaces, servers, toolOverrides } from "../db/schema.ts";
import type { ToolOverrideRow } from "../db/schema.ts";
import { getSetting } from "../db/settings.ts";
import type { Logger } from "../log.ts";
import type { UpstreamPool } from "../upstream/pool.ts";
import { UpstreamError } from "../upstream/types.ts";
import {
  assertUniquePrefixes,
  assertUniqueToolNames,
  exposedToolName,
  exposedUri,
  splitToolName,
  splitUri,
  uriPrefix
} from "./naming.ts";

export type NamespaceMember = {
  serverId: string;
  serverName: string;
  prefix: string;
  enabled: boolean;
};

export type AggregatedTool = {
  tool: Tool;
  serverId: string;
  originalName: string;
};

export class Aggregator {
  constructor(
    private readonly db: Db,
    private readonly pool: UpstreamPool,
    private readonly logger: Logger
  ) {}

  get separator(): string {
    return getSetting(this.db, "tool_separator");
  }

  members(namespaceId: string, onlyEnabled = true): NamespaceMember[] {
    const rows = this.db
      .select({
        serverId: servers.id,
        serverName: servers.name,
        prefix: namespaceServers.prefix,
        enabled: namespaceServers.enabled,
        serverEnabled: servers.enabled
      })
      .from(namespaceServers)
      .innerJoin(servers, eq(servers.id, namespaceServers.serverId))
      .where(eq(namespaceServers.namespaceId, namespaceId))
      .all();
    return rows
      .filter((row) => (onlyEnabled ? row.enabled && row.serverEnabled : true))
      .map((row) => ({
        serverId: row.serverId,
        serverName: row.serverName,
        prefix: row.prefix ?? row.serverName,
        enabled: row.enabled && row.serverEnabled
      }));
  }

  overrides(namespaceId: string): Map<string, ToolOverrideRow> {
    const rows = this.db.select().from(toolOverrides).where(eq(toolOverrides.namespaceId, namespaceId)).all();
    const map = new Map<string, ToolOverrideRow>();
    for (const row of rows) map.set(`${row.serverId} ${row.toolName}`, row);
    return map;
  }

  namespaceIdByName(name: string): string | null {
    const row = this.db.select().from(namespaces).where(eq(namespaces.name, name)).get();
    return row?.id ?? null;
  }

  private applyOverride(tool: Tool, override: ToolOverrideRow | undefined, exposed: string): Tool | null {
    if (override && !override.enabled) return null;
    const next: Tool = { ...tool, name: exposed };
    if (override?.displayName) next.title = override.displayName;
    if (override?.description) next.description = override.description;
    if (override?.annotations) next.annotations = { ...(tool.annotations ?? {}), ...override.annotations };
    return next;
  }

  private async catalogs(namespaceId: string) {
    const members = this.members(namespaceId);
    return Promise.all(
      members.map(async (member) => ({ member, catalog: await this.pool.safeCatalog(member.serverId) }))
    );
  }

  async listTools(namespaceId: string): Promise<AggregatedTool[]> {
    const overrides = this.overrides(namespaceId);
    const separator = this.separator;
    const entries = await this.catalogs(namespaceId);
    const out: AggregatedTool[] = [];
    const seen = new Set<string>();
    for (const { member, catalog } of entries) {
      for (const tool of catalog.tools) {
        const exposed = exposedToolName(member.prefix, tool.name, separator);
        if (seen.has(exposed)) {
          this.logger.warn("duplicate exposed tool name skipped", { tool: exposed, server: member.serverName });
          continue;
        }
        const mapped = this.applyOverride(tool, overrides.get(`${member.serverId} ${tool.name}`), exposed);
        if (!mapped) continue;
        seen.add(exposed);
        out.push({ tool: mapped, serverId: member.serverId, originalName: tool.name });
      }
    }
    return out;
  }

  private resolveTool(namespaceId: string, exposed: string): { serverId: string; toolName: string } {
    const split = splitToolName(exposed, this.separator);
    if (!split) throw new UpstreamError(`unknown tool: ${exposed}`, "unknown_tool", "");
    const member = this.members(namespaceId).find((m) => m.prefix === split.prefix);
    if (!member) throw new UpstreamError(`unknown tool: ${exposed}`, "unknown_tool", "");
    const override = this.db
      .select()
      .from(toolOverrides)
      .where(
        and(
          eq(toolOverrides.namespaceId, namespaceId),
          eq(toolOverrides.serverId, member.serverId),
          eq(toolOverrides.toolName, split.tool)
        )
      )
      .get();
    if (override && !override.enabled) {
      throw new UpstreamError(`unknown tool: ${exposed}`, "unknown_tool", member.serverId);
    }
    return { serverId: member.serverId, toolName: split.tool };
  }

  async callTool(
    namespaceId: string,
    exposed: string,
    args: Record<string, unknown> | undefined
  ): Promise<{ result: CallToolResult; serverId: string; toolName: string }> {
    const { serverId, toolName } = this.resolveTool(namespaceId, exposed);
    const result = await this.pool.withClient(serverId, (client) =>
      client.callTool({ name: toolName, arguments: args }, { timeout: this.pool.callTimeoutMs })
    );
    return { result, serverId, toolName };
  }

  async listResources(namespaceId: string): Promise<Resource[]> {
    const entries = await this.catalogs(namespaceId);
    const out: Resource[] = [];
    for (const { member, catalog } of entries) {
      for (const resource of catalog.resources) {
        out.push({
          ...resource,
          uri: exposedUri(member.prefix, resource.uri),
          name: `${member.prefix}/${resource.name}`
        });
      }
    }
    return out;
  }

  async listResourceTemplates(_namespaceId: string): Promise<ResourceTemplateType[]> {
    return [];
  }

  private resolveUri(namespaceId: string, exposed: string): { serverId: string; uri: string } {
    const split = splitUri(exposed);
    if (!split) throw new UpstreamError(`unknown resource: ${exposed}`, "unknown_resource", "");
    const member = this.members(namespaceId).find((m) => uriPrefix(m.prefix) === split.prefix);
    if (!member) throw new UpstreamError(`unknown resource: ${exposed}`, "unknown_resource", "");
    return { serverId: member.serverId, uri: split.uri };
  }

  async readResource(namespaceId: string, exposed: string): Promise<{ result: ReadResourceResult; serverId: string }> {
    const { serverId, uri } = this.resolveUri(namespaceId, exposed);
    const result = await this.pool.withClient(serverId, (client) =>
      client.readResource({ uri }, { timeout: this.pool.callTimeoutMs })
    );
    return { result, serverId };
  }

  async listPrompts(namespaceId: string): Promise<Prompt[]> {
    const separator = this.separator;
    const entries = await this.catalogs(namespaceId);
    const out: Prompt[] = [];
    for (const { member, catalog } of entries) {
      for (const prompt of catalog.prompts) {
        out.push({ ...prompt, name: exposedToolName(member.prefix, prompt.name, separator) });
      }
    }
    return out;
  }

  async getPrompt(
    namespaceId: string,
    exposed: string,
    args: Record<string, string> | undefined
  ): Promise<{ result: GetPromptResult; serverId: string }> {
    const split = splitToolName(exposed, this.separator);
    if (!split) throw new UpstreamError(`unknown prompt: ${exposed}`, "unknown_prompt", "");
    const member = this.members(namespaceId).find((m) => m.prefix === split.prefix);
    if (!member) throw new UpstreamError(`unknown prompt: ${exposed}`, "unknown_prompt", "");
    const result = await this.pool.withClient(member.serverId, (client) =>
      client.getPrompt({ name: split.tool, arguments: args }, { timeout: this.pool.callTimeoutMs })
    );
    return { result, serverId: member.serverId };
  }

  validate(namespaceId: string): void {
    const members = this.members(namespaceId, false);
    assertUniquePrefixes(members.map((m) => ({ serverId: m.serverId, serverName: m.serverName, prefix: m.prefix })));
    const separator = this.separator;
    const names: { exposed: string; serverName: string }[] = [];
    for (const member of members) {
      const catalog = this.pool.cachedCatalog(member.serverId);
      if (!catalog) continue;
      for (const tool of catalog.tools) {
        names.push({ exposed: exposedToolName(member.prefix, tool.name, separator), serverName: member.serverName });
      }
    }
    assertUniqueToolNames(names);
  }
}
