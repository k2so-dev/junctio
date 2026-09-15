import { McpServer } from "@modelcontextprotocol/server";
import type { Core } from "../core.ts";
import { VERSION } from "../config.ts";
import { createServersApi } from "../api/servers.ts";
import { createNamespacesApi } from "../api/namespaces.ts";
import { createEndpointsApi } from "../api/endpoints.ts";
import { createApiKeysApi } from "../api/apikeys.ts";
import { createOAuthApi } from "../api/oauth.ts";
import { createRegistryApi } from "../api/registry.ts";
import { createSettingsApi } from "../api/settings.ts";
import { createRequestLogApi } from "../api/requestlog.ts";
import { createAuditApi } from "../api/audit.ts";
import { buildHealth } from "../server/app.ts";
import { readApi } from "./call.ts";
import type { AdminApis, AdminDeps } from "./tools/kit.ts";
import { registerServerTools } from "./tools/servers.ts";
import { registerNamespaceTools } from "./tools/namespaces.ts";
import { registerEndpointTools } from "./tools/endpoints.ts";
import { registerRegistryTools } from "./tools/registry.ts";
import { registerMiscTools } from "./tools/misc.ts";

const INSTRUCTIONS = `This is the management interface of Junctio, a self-hosted MCP gateway.

An upstream server is added once, put into one or more namespaces, and published through an endpoint that clients connect to. Tools are exposed as the namespace prefix, the separator and the original tool name.

Two things are deliberately missing: api keys cannot be issued or revoked here, and this management server cannot switch itself off. Both are done by a human in the web ui.

The security audit checks the packages every stdio server runs against public vulnerability databases. You can read its results and start a run, but switching it on, changing what a severity does, ignoring an advisory and lifting a quarantine are all reserved for a human.

Creating a stdio server makes the gateway run that command on its host. Read the command back with preview_server_command before saving something you did not write yourself.`;

function apis(core: Core): AdminApis {
  return {
    servers: createServersApi(core),
    namespaces: createNamespacesApi(core),
    endpoints: createEndpointsApi(core),
    apiKeys: createApiKeysApi(core),
    oauth: createOAuthApi(core),
    registry: createRegistryApi(core),
    settings: createSettingsApi(core, { agent: true }),
    requestLog: createRequestLogApi(core),
    audit: createAuditApi(core)
  };
}

function registerResources(server: McpServer, deps: AdminDeps): void {
  const json = (uri: string, payload: unknown) => ({
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }]
  });

  const fromApi = (name: string, uri: string, title: string, description: string, app: () => Promise<unknown>) => {
    server.registerResource(name, uri, { title, description, mimeType: "application/json" }, async () =>
      json(uri, await app())
    );
  };

  fromApi("servers", "junctio://servers", "Servers", "Every upstream server, as list_servers returns it", async () => {
    const result = await readApi<unknown>(deps.apis.servers, { method: "GET", path: "/" });
    return result.ok ? result.payload : [];
  });

  fromApi(
    "namespaces",
    "junctio://namespaces",
    "Namespaces",
    "Every namespace with its members",
    async () => {
      const result = await readApi<unknown>(deps.apis.namespaces, { method: "GET", path: "/" });
      return result.ok ? result.payload : [];
    }
  );

  fromApi("endpoints", "junctio://endpoints", "Endpoints", "Every endpoint clients connect to", async () => {
    const result = await readApi<unknown>(deps.apis.endpoints, { method: "GET", path: "/" });
    return result.ok ? result.payload : [];
  });

  fromApi("settings", "junctio://settings", "Settings", "Gateway settings", async () => {
    const result = await readApi<unknown>(deps.apis.settings, { method: "GET", path: "/" });
    return result.ok ? result.payload : {};
  });

  fromApi("audit", "junctio://audit", "Security audit", "The latest audit result for every server", async () => {
    const result = await readApi<unknown>(deps.apis.audit, { method: "GET", path: "/" });
    return result.ok ? result.payload : {};
  });

  fromApi("health", "junctio://health", "Health", "Version, uptime and server counts", async () =>
    buildHealth(deps.core)
  );
}

export function buildAdminServer(core: Core): McpServer {
  const server = new McpServer(
    { name: "junctio-admin", version: VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS }
  );
  const deps: AdminDeps = { core, apis: apis(core) };

  registerServerTools(server, deps);
  registerNamespaceTools(server, deps);
  registerEndpointTools(server, deps);
  registerRegistryTools(server, deps);
  registerMiscTools(server, deps);
  registerResources(server, deps);

  return server;
}
