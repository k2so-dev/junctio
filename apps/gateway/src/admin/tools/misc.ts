import type { McpServer } from "@modelcontextprotocol/server";
import { AgentSettingsPatch, RequestLogQuery } from "@junctio/schema";
import { callApi, text } from "../call.ts";
import { buildHealth } from "../../server/app.ts";
import { dockerStatus } from "../../api/docker.ts";
import { READ_ONLY, UPDATES, defineTool, type AdminDeps } from "./kit.ts";

export function registerMiscTools(server: McpServer, deps: AdminDeps): void {
  defineTool(
    server,
    deps,
    "get_health",
    {
      title: "Gateway health",
      description: "Version, uptime and how many servers are running, failed or waiting for a new login.",
      annotations: READ_ONLY
    },
    async () => text(buildHealth(deps.core))
  );

  defineTool(
    server,
    deps,
    "get_docker_status",
    {
      title: "Docker status",
      description:
        "Whether the docker daemon answers on the socket, and which version. A server with the docker runtime cannot start without it.",
      annotations: READ_ONLY
    },
    async () => text(await dockerStatus(deps.core))
  );

  defineTool(
    server,
    deps,
    "get_settings",
    {
      title: "Get the settings",
      description: "Gateway settings, including the values that come from the environment and cannot be changed here.",
      annotations: READ_ONLY
    },
    async () => callApi(deps.apis.settings, { method: "GET", path: "/" })
  );

  defineTool(
    server,
    deps,
    "update_settings",
    {
      title: "Update the settings",
      description:
        "Change the tool separator, the PATH given to child processes, the api key query parameter or the request log retention. The management server cannot switch itself off; that is done by a human in the web ui.",
      inputSchema: AgentSettingsPatch,
      annotations: UPDATES
    },
    async (input) => callApi(deps.apis.settings, { method: "PATCH", path: "/", body: input })
  );

  defineTool(
    server,
    deps,
    "query_request_log",
    {
      title: "Query the request log",
      description:
        "Recent calls through the gateway, newest first. Filter by endpoint, server or status. Calls to this management server are logged here too, without an endpoint.",
      inputSchema: RequestLogQuery,
      annotations: READ_ONLY
    },
    async (input) =>
      callApi(deps.apis.requestLog, {
        method: "GET",
        path: "/",
        query: {
          limit: input.limit,
          endpointId: input.endpointId,
          serverId: input.serverId,
          status: input.status,
          before: input.before
        }
      })
  );

  defineTool(
    server,
    deps,
    "list_api_keys",
    {
      title: "List api keys",
      description:
        "The api keys that exist, with their prefix and last use. The secrets are not stored and cannot be read. Issuing and revoking keys is deliberately left to a human in the web ui.",
      annotations: READ_ONLY
    },
    async () => callApi(deps.apis.apiKeys, { method: "GET", path: "/" })
  );

  defineTool(
    server,
    deps,
    "list_oauth_clients",
    {
      title: "List oauth clients",
      description:
        "Clients registered against the built-in authorization server. Revoking one is left to a human in the web ui.",
      annotations: READ_ONLY
    },
    async () => callApi(deps.apis.oauth, { method: "GET", path: "/clients" })
  );
}
