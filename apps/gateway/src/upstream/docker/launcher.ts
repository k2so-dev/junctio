import type { Logger } from "../../log.ts";
import type { ContainerLaunch, Handle } from "../launch.ts";
import { DockerClient, DockerError, type CreateBody } from "./client.ts";
import { attachContainer } from "./stream.ts";

export const SERVER_LABEL = "junctio.server";
export const NAME_LABEL = "junctio.name";

function body(launch: ContainerLaunch): CreateBody {
  const spec = launch.container;
  return {
    Image: spec.image,
    Cmd: spec.cmd.length > 0 ? spec.cmd : null,
    Entrypoint: spec.entrypoint,
    Env: Object.entries(spec.env).map(([key, value]) => `${key}=${value}`),
    WorkingDir: spec.workdir,
    User: spec.user,
    Labels: { ...spec.labels, [SERVER_LABEL]: launch.serverId, [NAME_LABEL]: launch.name },
    OpenStdin: true,
    StdinOnce: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    HostConfig: {
      Binds: spec.binds,
      ...(spec.network === null ? {} : { NetworkMode: spec.network }),
      ...(spec.init ? { Init: true } : {}),
      AutoRemove: false
    }
  };
}

async function removeOwn(client: DockerClient, serverId: string): Promise<void> {
  const existing = await client.list(`${SERVER_LABEL}=${serverId}`).catch(() => []);
  for (const container of existing) await client.remove(container.id).catch(() => undefined);
}

async function create(client: DockerClient, launch: ContainerLaunch, name: string): Promise<string> {
  try {
    return await client.create(body(launch), name);
  } catch (error) {
    if (!(error instanceof DockerError) || error.status !== 409) throw error;
    await client.remove(name).catch(() => undefined);
    return client.create(body(launch), name);
  }
}

export async function spawnContainer(
  client: DockerClient,
  launch: ContainerLaunch,
  log: (line: string) => void
): Promise<Handle> {
  const spec = launch.container;
  await removeOwn(client, launch.serverId);

  if (spec.pull === "always" || !(await client.hasImage(spec.image))) {
    if (spec.pull === "never") throw new Error(`image ${spec.image} is not present and --pull never forbids fetching it`);
    log(`pulling ${spec.image}`);
    await client.pull(spec.image, (status) => log(`pull: ${status}`));
  }

  const name = `junctio-${launch.name}`;
  const id = await create(client, launch, name);
  const short = id.slice(0, 12);

  let attachment;
  try {
    attachment = await attachContainer(client.socket, id);
  } catch (error) {
    await client.remove(id).catch(() => undefined);
    throw error;
  }

  const exited = client
    .wait(id)
    .then((code) => ({ code, signal: null as string | null }))
    .catch(() => ({ code: null, signal: null as string | null }))
    .finally(async () => {
      attachment.close();
      await client.remove(id).catch(() => undefined);
    });

  try {
    await client.start(id);
  } catch (error) {
    attachment.close();
    await client.remove(id).catch(() => undefined);
    throw error;
  }

  log(`started: ${spec.image} (container ${short})`);

  return {
    describe: `container ${short}`,
    pid: null,
    containerId: id,
    stdin: attachment.stdin,
    stdout: attachment.stdout,
    stderr: attachment.stderr,
    exited,
    terminate: (graceMs) => {
      void client.stop(id, Math.max(1, Math.ceil(graceMs / 1000))).catch(() => undefined);
    },
    kill: () => {
      void client.kill(id).catch(() => undefined);
    },
    dispose: () => {
      attachment.close();
      void client.remove(id).catch(() => undefined);
    }
  };
}

export async function reapContainers(client: DockerClient, logger: Logger): Promise<void> {
  let leftovers;
  try {
    leftovers = await client.list(SERVER_LABEL);
  } catch (error) {
    logger.debug("docker is unavailable, skipping the leftover sweep", { error: String(error) });
    return;
  }
  if (leftovers.length === 0) return;
  for (const container of leftovers) await client.remove(container.id).catch(() => undefined);
  logger.info("removed leftover containers from a previous run", {
    count: leftovers.length,
    names: leftovers.map((container) => container.names[0] ?? container.id.slice(0, 12))
  });
}
