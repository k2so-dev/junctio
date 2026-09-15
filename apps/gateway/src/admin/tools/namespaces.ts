import type { McpServer } from "@modelcontextprotocol/server";
import { NamespaceInput, NamespacePatch, NamespaceServerInput, ToolOverrideInput } from "@junctio/schema";
import { z } from "zod";
import { callApi } from "../call.ts";
import { DESTROYS, MUTATES, READ_ONLY, UPDATES, defineTool, resourceId, type AdminDeps } from "./kit.ts";

const Id = z.object({ id: resourceId("namespace id, as returned by list_namespaces") });

export function registerNamespaceTools(server: McpServer, deps: AdminDeps): void {
  const api = deps.apis.namespaces;

  defineTool(
    server,
    deps,
    "list_namespaces",
    {
      title: "List namespaces",
      description: "Every namespace with the servers it aggregates.",
      annotations: READ_ONLY
    },
    async () => callApi(api, { method: "GET", path: "/" })
  );

  defineTool(
    server,
    deps,
    "get_namespace",
    {
      title: "Get a namespace",
      description: "One namespace with its members and their prefixes.",
      inputSchema: Id,
      annotations: READ_ONLY
    },
    async (input) => callApi(api, { method: "GET", path: `/${input.id}` })
  );

  defineTool(
    server,
    deps,
    "create_namespace",
    {
      title: "Create a namespace",
      description: "A namespace groups upstream servers so an endpoint can expose them as one server.",
      inputSchema: NamespaceInput,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: "/", body: input })
  );

  defineTool(
    server,
    deps,
    "update_namespace",
    {
      title: "Rename a namespace",
      description: "Change the name or description of a namespace.",
      inputSchema: NamespacePatch.extend(Id.shape),
      annotations: UPDATES
    },
    async ({ id, ...patch }) => callApi(api, { method: "PATCH", path: `/${id}`, body: patch })
  );

  defineTool(
    server,
    deps,
    "delete_namespace",
    {
      title: "Delete a namespace",
      description:
        "Remove a namespace along with its memberships and tool overrides. Endpoints pointing at it stop working. The servers themselves are kept.",
      inputSchema: Id,
      annotations: DESTROYS
    },
    async (input) => callApi(api, { method: "DELETE", path: `/${input.id}` })
  );

  defineTool(
    server,
    deps,
    "add_namespace_server",
    {
      title: "Put a server in a namespace",
      description:
        "Add a server to a namespace, or change its prefix there. Tools are exposed as prefix, separator and the original name. The prefix defaults to the server name and has to be unique within the namespace.",
      inputSchema: NamespaceServerInput.extend({ namespaceId: resourceId("namespace id") }),
      annotations: UPDATES
    },
    async ({ namespaceId, ...body }) => callApi(api, { method: "POST", path: `/${namespaceId}/servers`, body })
  );

  defineTool(
    server,
    deps,
    "remove_namespace_server",
    {
      title: "Take a server out of a namespace",
      description: "Drop one membership. The server itself is untouched.",
      inputSchema: z.object({ namespaceId: resourceId("namespace id"), serverId: resourceId("server id") }),
      annotations: DESTROYS
    },
    async (input) =>
      callApi(api, { method: "DELETE", path: `/${input.namespaceId}/servers/${input.serverId}` })
  );

  defineTool(
    server,
    deps,
    "list_namespace_tools",
    {
      title: "List the tools of a namespace",
      description:
        "Every tool the namespace exposes, with its exposed name and whatever override is in place. A server that cannot be reached contributes nothing instead of failing the call.",
      inputSchema: Id,
      annotations: READ_ONLY
    },
    async (input) => callApi(api, { method: "GET", path: `/${input.id}/tools` })
  );

  defineTool(
    server,
    deps,
    "set_tool_override",
    {
      title: "Override a tool",
      description:
        "Hide a tool, rename it, rewrite its description or add annotations, for this namespace only. The upstream server is not modified.",
      inputSchema: ToolOverrideInput.extend({ namespaceId: resourceId("namespace id") }),
      annotations: UPDATES
    },
    async ({ namespaceId, ...body }) => callApi(api, { method: "PUT", path: `/${namespaceId}/tools`, body })
  );

  defineTool(
    server,
    deps,
    "remove_tool_override",
    {
      title: "Drop a tool override",
      description: "Return a tool to whatever the upstream server calls it.",
      inputSchema: z.object({
        namespaceId: resourceId("namespace id"),
        serverId: resourceId("server id"),
        toolName: z.string().min(1).describe("the original name on the upstream, not the exposed one")
      }),
      annotations: DESTROYS
    },
    async (input) =>
      callApi(api, {
        method: "DELETE",
        path: `/${input.namespaceId}/tools/${input.serverId}/${encodeURIComponent(input.toolName)}`
      })
  );

  defineTool(
    server,
    deps,
    "validate_namespace",
    {
      title: "Check a namespace for collisions",
      description: "Report duplicate prefixes and tool names before a client runs into them.",
      inputSchema: Id,
      annotations: READ_ONLY
    },
    async (input) => callApi(api, { method: "POST", path: `/${input.id}/validate` })
  );
}
