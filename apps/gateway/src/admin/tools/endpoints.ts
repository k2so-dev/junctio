import type { McpServer } from "@modelcontextprotocol/server";
import { EndpointInput, EndpointPatch } from "@junctio/schema";
import { z } from "zod";
import { callApi } from "../call.ts";
import { DESTROYS, MUTATES, READ_ONLY, UPDATES, defineTool, type AdminDeps } from "./kit.ts";

const Id = z.object({ id: z.string().min(1).describe("endpoint id, as returned by list_endpoints") });

export function registerEndpointTools(server: McpServer, deps: AdminDeps): void {
  const api = deps.apis.endpoints;

  defineTool(
    server,
    deps,
    "list_endpoints",
    {
      title: "List endpoints",
      description: "Every endpoint clients connect to, with its url, namespace and auth mode.",
      annotations: READ_ONLY
    },
    async () => callApi(api, { method: "GET", path: "/" })
  );

  defineTool(
    server,
    deps,
    "get_endpoint",
    {
      title: "Get an endpoint",
      description: "One endpoint in full.",
      inputSchema: Id,
      annotations: READ_ONLY
    },
    async (input) => callApi(api, { method: "GET", path: `/${input.id}` })
  );

  defineTool(
    server,
    deps,
    "create_endpoint",
    {
      title: "Create an endpoint",
      description:
        "Publish a namespace at a url. The slug becomes the path. Auth mode api_key needs a key, which only a human can issue from the web ui. protocolMin defaults to the newest revision, which refuses older clients.",
      inputSchema: EndpointInput,
      annotations: MUTATES
    },
    async (input) => callApi(api, { method: "POST", path: "/", body: input })
  );

  defineTool(
    server,
    deps,
    "update_endpoint",
    {
      title: "Update an endpoint",
      description: "Change the slug, namespace, auth mode, protocol floor or rate limit of an endpoint.",
      inputSchema: EndpointPatch.extend(Id.shape),
      annotations: UPDATES
    },
    async ({ id, ...patch }) => callApi(api, { method: "PATCH", path: `/${id}`, body: patch })
  );

  defineTool(
    server,
    deps,
    "delete_endpoint",
    {
      title: "Delete an endpoint",
      description: "Remove an endpoint. Clients pointed at it stop working immediately.",
      inputSchema: Id,
      annotations: DESTROYS
    },
    async (input) => callApi(api, { method: "DELETE", path: `/${input.id}` })
  );

  defineTool(
    server,
    deps,
    "get_endpoint_protocols",
    {
      title: "See which protocol revisions clients spoke",
      description:
        "What the clients of this endpoint actually negotiated, and how many were turned away for speaking below the minimum.",
      inputSchema: Id,
      annotations: READ_ONLY
    },
    async (input) => callApi(api, { method: "GET", path: `/${input.id}/protocols` })
  );
}
