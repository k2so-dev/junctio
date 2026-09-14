import { Hono } from "hono";
import type { DockerStatusDto } from "@junctio/schema";
import type { Core } from "../core.ts";

export async function dockerStatus(core: Core): Promise<DockerStatusDto> {
  try {
    const version = await core.docker.version();
    return {
      socket: core.docker.socket,
      available: true,
      version: version.version,
      apiVersion: version.apiVersion,
      error: null
    };
  } catch (error) {
    return {
      socket: core.docker.socket,
      available: false,
      version: null,
      apiVersion: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function createDockerApi(core: Core): Hono {
  const app = new Hono();
  app.get("/", async (c) => c.json(await dockerStatus(core)));
  return app;
}
