import type { McpServer } from "@modelcontextprotocol/server";
import { ServerInput, ServerPatch } from "@junctio/schema";
import { z } from "zod";
import { callApi } from "../call.ts";
import { DESTROYS, MUTATES, READ_ONLY, UPDATES, defineTool, type AdminDeps } from "./kit.ts";

const Id = z.object({ id: z.string().min(1).describe("server id, as returned by list_servers") });

export function registerServerTools(server: McpServer, deps: AdminDeps): void {
  const api = deps.apis.servers;

  defineTool(
    server,
    deps,
    "list_servers",
    {
      title: "List servers",
      description: "Every upstream server the gateway knows, with its transport, status and oauth state.",
      annotations: READ_ONLY
    },
    async () => callApi(api, { method: "GET", path: "/" })
  );

  defineTool(
    server,
    deps,
    "get_server",
    {
      title: "Get a server",
      description: "One upstream server in full, including its arguments and masked headers.",
      inputSchema: Id,
      annotations: READ_ONLY
    },
    async (input) => callApi(api, { method: "GET", path: `/${input.id}` })
  );

  defineTool(
    server,
    deps,
    "create_server",
    {
      title: "Create a server",
      description:
        "Add an upstream server. For stdio pick a runtime and pass every argument separately, in order: npx wants -y and the package name. For http set transport to http, a url, and authMode header with an Authorization header, or oauth to run the client flow later. Nothing is added to the arguments behind your back.",
      inputSchema: ServerInput,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: "/", body: input })
  );

  defineTool(
    server,
    deps,
    "update_server",
    {
      title: "Update a server",
      description:
        "Change an existing server. Only the fields you pass are touched. Editing anything that affects the connection stops the running process so the next call reconnects.",
      inputSchema: ServerPatch.extend(Id.shape),
      annotations: UPDATES
    },
    async ({ id, ...patch }) => callApi(api, { method: "PATCH", path: `/${id}`, body: patch })
  );

  defineTool(
    server,
    deps,
    "delete_server",
    {
      title: "Delete a server",
      description: "Remove a server, stop its process and drop it from every namespace. This cannot be undone.",
      inputSchema: Id,
      annotations: DESTROYS
    },
    async (input) => callApi(api, { method: "DELETE", path: `/${input.id}` })
  );

  defineTool(
    server,
    deps,
    "preview_server_command",
    {
      title: "Preview the command",
      description: "Show the exact argv a stdio server would run, without saving anything.",
      inputSchema: ServerInput,
      annotations: READ_ONLY
    },
    async (input) => callApi(api, { method: "POST", path: "/preview", body: input })
  );

  defineTool(
    server,
    deps,
    "start_server",
    {
      title: "Start a server",
      description: "Connect to a server now instead of waiting for the first call.",
      inputSchema: Id,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: `/${input.id}/start` })
  );

  defineTool(
    server,
    deps,
    "stop_server",
    {
      title: "Stop a server",
      description: "Close the connection and stop the child process. The server stays configured and enabled.",
      inputSchema: Id,
      annotations: DESTROYS
    },
    async (input) => callApi(api, { method: "POST", path: `/${input.id}/stop` })
  );

  defineTool(
    server,
    deps,
    "restart_server",
    {
      title: "Restart a server",
      description: "Stop the server, clear its failure count and connect again.",
      inputSchema: Id,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: `/${input.id}/restart` })
  );

  defineTool(
    server,
    deps,
    "reset_server",
    {
      title: "Reset the restart count",
      description: "Clear the backoff of a server that failed too often, without restarting it.",
      inputSchema: Id,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: `/${input.id}/reset` })
  );

  defineTool(
    server,
    deps,
    "test_server",
    {
      title: "Test the connection",
      description:
        "Connect, negotiate the protocol and count the tools. Answers with the failure instead of throwing when the server does not come up.",
      inputSchema: Id,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: `/${input.id}/test` })
  );

  defineTool(
    server,
    deps,
    "list_server_tools",
    {
      title: "List what a server offers",
      description: "The tools, resources and prompts of one upstream, as the gateway last saw them.",
      inputSchema: Id.extend({
        refresh: z.boolean().default(false).describe("ask the server again instead of using the cached catalog")
      }),
      annotations: READ_ONLY
    },
    async (input) =>
      callApi(api, { method: "GET", path: `/${input.id}/tools`, query: { refresh: input.refresh ? "1" : undefined } })
  );

  defineTool(
    server,
    deps,
    "get_server_logs",
    {
      title: "Read server logs",
      description: "The tail of what a stdio server wrote to stdout and stderr, newest last.",
      inputSchema: Id.extend({ tail: z.number().int().min(1).max(1000).default(200) }),
      annotations: READ_ONLY
    },
    async (input) => callApi(api, { method: "GET", path: `/${input.id}/logs`, query: { tail: input.tail } })
  );

  defineTool(
    server,
    deps,
    "start_server_oauth",
    {
      title: "Start the upstream oauth flow",
      description:
        "Begin the oauth client flow for a server with authMode oauth. Answers with an authorization url that a human has to open in a browser; the gateway stores the tokens when they come back.",
      inputSchema: Id,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: `/${input.id}/oauth/start` })
  );

  defineTool(
    server,
    deps,
    "refresh_server_oauth",
    {
      title: "Refresh an upstream token",
      description: "Force a token refresh for an oauth server instead of waiting for the scheduler.",
      inputSchema: Id,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: `/${input.id}/oauth/refresh` })
  );

  defineTool(
    server,
    deps,
    "disconnect_server_oauth",
    {
      title: "Forget upstream tokens",
      description: "Delete the stored access and refresh tokens of a server. It will need a fresh login.",
      inputSchema: Id,
      annotations: DESTROYS
    },
    async (input) => callApi(api, { method: "DELETE", path: `/${input.id}/oauth` })
  );
}
