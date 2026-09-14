import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DockerStatusDto, ServerDto } from "@junctio/schema";
import { startHarness, MOCK_STDIO, type Harness } from "../helpers.ts";
import { startMockDocker, type MockDocker } from "../fixtures/mock-docker.ts";
import { GATEWAY_LABEL, reapContainers, SERVER_LABEL } from "../../src/upstream/docker/launcher.ts";
import { gatewayId } from "../../src/db/settings.ts";
import { dockerStatus } from "../../src/api/docker.ts";

const IMAGE = "mcp/mock:latest";

let dir: string;
let docker: MockDocker;
let harness: Harness;
let cookie = "";

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${harness.url}/api${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0] ?? cookie;
  return response;
}

async function post(path: string, body?: unknown): Promise<Response> {
  return api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
}

async function get(path: string): Promise<Response> {
  return api(path);
}

async function createServer(args: string[], env: Record<string, string> = {}): Promise<ServerDto> {
  const response = await post("/v1/servers", {
    name: "mock-container",
    transport: "stdio",
    runtime: "docker",
    args,
    env,
    idleTimeoutSec: 0
  });
  expect(response.status).toBe(201);
  return (await response.json()) as ServerDto;
}

beforeEach(async () => {
  cookie = "";
  dir = mkdtempSync(join(tmpdir(), "junctio-docker-"));
  docker = await startMockDocker(join(dir, "docker.sock"));
  docker.seedImage(IMAGE);
  harness = await startHarness({ env: { JUNCTIO_DOCKER_SOCKET: docker.path } });
  await post("/v1/session/setup", { password: "supersecret" });
});

afterEach(async () => {
  await harness.stop();
  await docker.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("docker runtime", () => {
  test("runs a container and speaks to the server inside it", async () => {
    const server = await createServer(
      ["run", "-i", "--rm", "-e", "MOCK_NAME", IMAGE, "bun", MOCK_STDIO],
      { MOCK_NAME: "boxed" }
    );

    const started = (await (await post(`/v1/servers/${server.id}/start`)).json()) as ServerDto;
    expect(started.status).toBe("running");
    expect(started.containerId).not.toBeNull();
    expect(started.pid).toBeNull();

    const catalog = (await (await get(`/v1/servers/${server.id}/tools`)).json()) as { tools: { name: string }[] };
    expect(catalog.tools.map((tool) => tool.name)).toContain("echo");

    const own = gatewayId(harness.core.db);
    const running = docker.containers();
    expect(running).toHaveLength(1);
    expect(running[0]?.name).toBe(`junctio-mock-container-${own.slice(0, 6)}`);
    expect(running[0]?.labels[SERVER_LABEL]).toBe(server.id);
    expect(running[0]?.labels[GATEWAY_LABEL]).toBe(own);

    const logs = (await (await get(`/v1/servers/${server.id}/logs`)).json()) as { line: string }[];
    expect(logs.some((entry) => entry.line.includes("mock server boxed ready"))).toBe(true);
    expect(logs.some((entry) => entry.line.includes("container"))).toBe(true);

    const stopped = (await (await post(`/v1/servers/${server.id}/stop`)).json()) as ServerDto;
    expect(stopped.status).toBe("stopped");
    expect(stopped.containerId).toBeNull();
    expect(docker.containers()).toHaveLength(0);
  }, 20_000);

  test("restarts into a new container and deletes the last one", async () => {
    const server = await createServer(["run", "-i", "--rm", IMAGE, "bun", MOCK_STDIO]);
    await post(`/v1/servers/${server.id}/start`);
    const first = docker.containers()[0]?.id;

    const restarted = (await (await post(`/v1/servers/${server.id}/restart`)).json()) as ServerDto;
    expect(restarted.status).toBe("running");
    expect(docker.containers()).toHaveLength(1);
    expect(docker.containers()[0]?.id).not.toBe(first);

    await api(`/v1/servers/${server.id}`, { method: "DELETE" });
    expect(docker.containers()).toHaveLength(0);
  }, 20_000);

  test("pulls an image the daemon does not have", async () => {
    const server = await createServer(["run", "-i", "--rm", "mcp/fresh:1", "bun", MOCK_STDIO]);
    await post(`/v1/servers/${server.id}/start`);

    expect(docker.calls).toContain("POST /images/create");
    const logs = (await (await get(`/v1/servers/${server.id}/logs`)).json()) as { line: string }[];
    expect(logs.some((entry) => entry.line === "pulling mcp/fresh:1")).toBe(true);
    expect(logs.some((entry) => entry.line.includes("Downloading"))).toBe(false);
  }, 20_000);

  test("reports what the daemon says about an image that does not exist", async () => {
    const server = await createServer(["run", "-i", "--rm", "missing/nope", "bun", MOCK_STDIO]);
    const response = await post(`/v1/servers/${server.id}/start`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("pull access denied");

    const current = (await (await get(`/v1/servers/${server.id}`)).json()) as ServerDto;
    expect(current.lastError).toContain("pull access denied");
  }, 20_000);

  test("kills a container that ignores the stop signal", async () => {
    const server = await createServer(
      ["run", "-i", "--rm", "-e", "MOCK_IGNORE_SIGTERM", IMAGE, "bun", MOCK_STDIO],
      { MOCK_IGNORE_SIGTERM: "1" }
    );
    await post(`/v1/servers/${server.id}/start`);
    expect(docker.containers()).toHaveLength(1);

    const stopped = (await (await post(`/v1/servers/${server.id}/stop`)).json()) as ServerDto;
    expect(stopped.status).toBe("stopped");
    expect(docker.containers()).toHaveLength(0);
  }, 30_000);

  test("sweeps containers a previous run left behind", async () => {
    const own = gatewayId(harness.core.db);
    docker.seedContainer({ [GATEWAY_LABEL]: own, [SERVER_LABEL]: "gone" }, "junctio-orphan");
    await reapContainers(harness.core.docker, harness.core.logger, own);
    expect(docker.containers()).toHaveLength(0);
  });

  test("leaves the containers of another gateway alone", async () => {
    const own = gatewayId(harness.core.db);
    docker.seedContainer({ [GATEWAY_LABEL]: "somebody-else", [SERVER_LABEL]: "theirs" }, "junctio-theirs");
    await reapContainers(harness.core.docker, harness.core.logger, own);
    expect(docker.containers().map((container) => container.name)).toEqual(["junctio-theirs"]);

    const server = await createServer(["run", "-i", "--rm", IMAGE, "bun", MOCK_STDIO]);
    await post(`/v1/servers/${server.id}/start`);
    expect(docker.containers().map((container) => container.name)).toContain("junctio-theirs");
    expect(docker.containers()).toHaveLength(2);
  }, 20_000);

  test("answers what it knows about the daemon", async () => {
    const status = (await (await get("/v1/docker")).json()) as DockerStatusDto;
    expect(status.available).toBe(true);
    expect(status.version).toBe("27.0.0-mock");
    expect(status.socket).toBe(docker.path);
    expect(status.error).toBeNull();
  });

  test("refuses arguments the gateway cannot honour", async () => {
    const response = await post("/v1/servers", {
      name: "privileged",
      transport: "stdio",
      runtime: "docker",
      args: ["run", "--privileged", IMAGE]
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { details: { path: string; message: string }[] };
    expect(body.details[0]?.path).toBe("args");
    expect(body.details[0]?.message).toContain("--privileged");
  });
});

describe("docker runtime without a reachable daemon", () => {
  async function statusFor(socket: string): Promise<DockerStatusDto> {
    const away = await startHarness({ env: { JUNCTIO_DOCKER_SOCKET: socket } });
    try {
      return await dockerStatus(away.core);
    } finally {
      await away.stop();
    }
  }

  test("says where the socket should be", async () => {
    const status = await statusFor(join(dir, "absent.sock"));
    expect(status.available).toBe(false);
    expect(status.version).toBeNull();
    expect(status.error).toContain("socket not found");
    expect(status.error).toContain("mount it");
  });

  test("says how to get permission", async () => {
    chmodSync(docker.path, 0o000);
    try {
      const status = await statusFor(docker.path);
      expect(status.available).toBe(false);
      expect(status.error).toContain("permission denied");
      expect(status.error).toContain("group_add");
    } finally {
      chmodSync(docker.path, 0o660);
    }
  });

  test("says when the path is not a socket", async () => {
    const plain = join(dir, "not-a-socket");
    writeFileSync(plain, "");
    const status = await statusFor(plain);
    expect(status.error).toContain("is not a socket");
  });
});
