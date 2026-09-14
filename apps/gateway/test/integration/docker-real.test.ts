import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerDto } from "@junctio/schema";
import { startHarness } from "../helpers.ts";
import { DockerClient } from "../../src/upstream/docker/client.ts";
import { SERVER_LABEL } from "../../src/upstream/docker/launcher.ts";

const SOCKET = Bun.env.JUNCTIO_DOCKER_SOCKET ?? "/var/run/docker.sock";
const IMAGE = `oven/bun:${/ARG BUN_VERSION=([^\s]+)/.exec(readFileSync(resolve(import.meta.dir, "../../../../Dockerfile"), "utf8"))?.[1] ?? "1.4.2"}-slim`;
const REPO = resolve(import.meta.dir, "../../../..");

async function reachable(): Promise<boolean> {
  try {
    if (!statSync(SOCKET).isSocket()) return false;
    await new DockerClient(SOCKET).version();
    return true;
  } catch {
    return false;
  }
}

const available = await reachable();

describe.skipIf(!available)("a real docker daemon", () => {
  test("runs an mcp server inside a container and cleans up after it", async () => {
    const harness = await startHarness({ env: { JUNCTIO_DOCKER_SOCKET: SOCKET } });
    const client = new DockerClient(SOCKET);
    const { randomId } = await import("../../src/crypto.ts");
    const { servers } = await import("../../src/db/schema.ts");
    const id = randomId();
    harness.core.db
      .insert(servers)
      .values({
        id,
        name: `real-${id.slice(0, 6)}`,
        transport: "stdio",
        runtime: "docker",
        args: [
          "run",
          "-i",
          "--rm",
          "-e",
          "MOCK_NAME",
          "-v",
          `${REPO}:/repo:ro`,
          "-w",
          "/repo",
          IMAGE,
          "bun",
          "/repo/apps/gateway/test/fixtures/mock-stdio-server.ts"
        ],
        env: { MOCK_NAME: "in-a-container" },
        cwd: null,
        url: null,
        headersEnc: null,
        authMode: "none",
        oauthScope: null,
        enabled: true,
        warm: false,
        idleTimeoutSec: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      .run();

    try {
      const catalog = await harness.core.pool.catalog(id);
      expect(catalog.tools.map((tool) => tool.name)).toContain("echo");

      const info = harness.core.supervisor.getInfo(id);
      expect(info.state).toBe("running");
      expect(info.containerId).not.toBeNull();

      const client30 = await harness.core.pool.acquire(id);
      const result = await client30.callTool({ name: "echo", arguments: { message: "hello" } });
      expect(JSON.stringify(result)).toContain("in-a-container: hello");

      await harness.core.pool.invalidate(id, "test over");
      await harness.core.supervisor.stop(id);

      const left = await client.list(`${SERVER_LABEL}=${id}`);
      expect(left).toEqual([]);
    } finally {
      await harness.stop();
      for (const container of await client.list(`${SERVER_LABEL}=${id}`).catch(() => [])) {
        await client.remove(container.id).catch(() => undefined);
      }
    }
  }, 180_000);
});
