import type { McpServer } from "@modelcontextprotocol/server";
import { RegistryQuery, type RegistryDetailDto, type ServerInput } from "@junctio/schema";
import { z } from "zod";
import { callApi, failure, readApi } from "../call.ts";
import { MUTATES, READ_ONLY, defineTool, type AdminDeps } from "./kit.ts";

const InstallInput = z.object({
  name: z.string().min(1).describe("full registry name, for example io.github.owner/repo"),
  optionId: z.string().min(1).describe("id of the install option, from get_registry_server"),
  serverName: z.string().min(1).max(64).optional().describe("overrides the name the gateway suggests"),
  args: z.array(z.string()).optional().describe("replaces the whole argument list of the draft"),
  env: z.record(z.string(), z.string()).default({}).describe("merged into the environment of the draft"),
  headers: z.record(z.string(), z.string()).default({}).describe("merged into the headers of a remote draft")
});

export function registerRegistryTools(server: McpServer, deps: AdminDeps): void {
  const api = deps.apis.registry;

  defineTool(
    server,
    deps,
    "search_registry",
    {
      title: "Search the public registry",
      description:
        "Look through the official MCP registry at registry.modelcontextprotocol.io. It matches on the name only and publishes no total, so page with the cursor from the previous answer. Answers are cached for an hour.",
      inputSchema: RegistryQuery,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async (input) =>
      callApi(api, {
        method: "GET",
        path: "/servers",
        query: {
          limit: input.limit,
          search: input.search,
          cursor: input.cursor,
          refresh: input.refresh ? "1" : undefined
        }
      })
  );

  defineTool(
    server,
    deps,
    "get_registry_server",
    {
      title: "Inspect a registry entry",
      description:
        "One registry entry with every way it can be installed. Each option carries an id for install_registry_server, whether the gateway supports it, and the inputs you still have to supply.",
      inputSchema: z.object({ name: z.string().min(1), refresh: z.boolean().default(false) }),
      annotations: { ...READ_ONLY, openWorldHint: true }
    },
    async (input) =>
      callApi(api, {
        method: "GET",
        path: "/server",
        query: { name: input.name, refresh: input.refresh ? "1" : undefined }
      })
  );

  defineTool(
    server,
    deps,
    "install_registry_server",
    {
      title: "Install from the registry",
      description:
        "Create a server from a registry entry. Call get_registry_server first and read the inputs of the option you pick: arguments the registry leaves open arrive as placeholders in angle brackets and required environment variables arrive empty. Replace them through args and env, otherwise the server is saved with the placeholders and will not run.",
      inputSchema: InstallInput,
      annotations: MUTATES
    },
    async (input) => {
      const detail = await readApi<RegistryDetailDto>(api, {
        method: "GET",
        path: "/server",
        query: { name: input.name }
      });
      if (!detail.ok) return detail.error;

      const option = detail.payload.options.find((item) => item.id === input.optionId);
      if (!option) {
        const known = detail.payload.options.map((item) => `${item.id} (${item.label})`).join(", ");
        return failure(`no install option ${input.optionId} for ${input.name}. Known options: ${known || "none"}`);
      }
      if (!option.supported || !option.draft) {
        return failure(
          `option ${option.id} cannot be installed: ${option.reason ?? "the gateway does not support it"}`
        );
      }

      const draft: ServerInput = {
        ...option.draft,
        ...(input.serverName ? { name: input.serverName } : {}),
        ...(input.args ? { args: input.args } : {}),
        env: { ...option.draft.env, ...input.env },
        headers: { ...option.draft.headers, ...input.headers }
      };

      return callApi(deps.apis.servers, { method: "POST", path: "/", body: draft });
    }
  );
}
