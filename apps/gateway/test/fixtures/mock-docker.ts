import type { Socket, Subprocess, UnixSocketListener } from "bun";
import { rmSync } from "node:fs";

type Created = {
  id: string;
  name: string;
  labels: Record<string, string>;
  image: string;
  cmd: string[];
  entrypoint: string[] | null;
  env: string[];
  binds: string[];
  workdir: string | null;
  user: string | null;
  attached: Socket<Data> | null;
  proc: Subprocess<"pipe", "pipe", "pipe"> | null;
  status: number | null;
  waiters: ((code: number) => void)[];
  killTimer: ReturnType<typeof setTimeout> | null;
};

type Data = {
  buffer: Uint8Array;
  hijacked: Created | null;
};

export type MockDocker = {
  path: string;
  calls: string[];
  containers(): Created[];
  seedImage(reference: string): void;
  seedContainer(labels: Record<string, string>, name: string): string;
  stop(): Promise<void>;
};

const encoder = new TextEncoder();

function frame(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  out[0] = kind;
  new DataView(out.buffer).setUint32(4, payload.length);
  out.set(payload, 8);
  return out;
}

const REASON: Record<number, string> = { 200: "OK", 201: "Created", 204: "No Content", 404: "Not Found" };

function respond(socket: Socket<Data>, status: number, body: unknown): void {
  const text = body === null ? "" : JSON.stringify(body);
  socket.write(
    `HTTP/1.1 ${status} ${REASON[status] ?? "Error"}\r\n` +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${encoder.encode(text).length}\r\n` +
      "Connection: keep-alive\r\n\r\n" +
      text
  );
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

export async function startMockDocker(path: string): Promise<MockDocker> {
  const containers = new Map<string, Created>();
  const images = new Set<string>();
  const calls: string[] = [];
  let sequence = 0;

  const pipe = (container: Created, socket: Socket<Data>, proc: Subprocess<"pipe", "pipe", "pipe">) => {
    const forward = async (stream: ReadableStream<Uint8Array>, kind: number) => {
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) socket.write(frame(kind, value));
      }
    };
    void forward(proc.stdout, 1);
    void forward(proc.stderr, 2);
    void proc.exited.then((code) => {
      container.status = code;
      if (container.killTimer) clearTimeout(container.killTimer);
      for (const waiter of container.waiters.splice(0)) waiter(code);
    });
  };

  const handle = (socket: Socket<Data>, method: string, target: string, body: string): void => {
    const url = new URL(target, "http://docker");
    const path = url.pathname;
    calls.push(`${method} ${path}`);

    if (path === "/version") {
      respond(socket, 200, { Version: "27.0.0-mock", ApiVersion: "1.47" });
      return;
    }

    const image = /^\/images\/(.+)\/json$/.exec(path);
    if (image?.[1]) {
      const reference = decodeURIComponent(image[1]);
      if (images.has(reference)) respond(socket, 200, { Id: `sha256:${reference}` });
      else respond(socket, 404, { message: `No such image: ${reference}` });
      return;
    }

    if (path === "/images/create") {
      const reference = url.searchParams.get("fromImage") ?? "";
      if (reference.startsWith("missing/")) {
        respond(socket, 404, { message: `pull access denied for ${reference}, repository does not exist` });
        return;
      }
      images.add(reference);
      const lines =
        `${JSON.stringify({ status: `Pulling from ${reference}` })}\n` +
        `${JSON.stringify({ status: "Downloading", progress: "[====>]" })}\n` +
        `${JSON.stringify({ status: `Status: Downloaded newer image for ${reference}` })}\n`;
      socket.write(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" +
          `Content-Length: ${encoder.encode(lines).length}\r\n\r\n${lines}`
      );
      return;
    }

    if (path === "/containers/create") {
      const parsed = JSON.parse(body) as Record<string, never>;
      const spec = parsed as unknown as {
        Image: string;
        Cmd: string[] | null;
        Entrypoint: string[] | null;
        Env: string[];
        WorkingDir: string | null;
        User: string | null;
        Labels: Record<string, string>;
        HostConfig: { Binds: string[] };
      };
      if (!images.has(spec.Image)) {
        respond(socket, 404, { message: `No such image: ${spec.Image}` });
        return;
      }
      sequence += 1;
      const id = `c${String(sequence).padStart(4, "0")}${"0".repeat(58)}`;
      containers.set(id, {
        id,
        name: url.searchParams.get("name") ?? id,
        labels: spec.Labels ?? {},
        image: spec.Image,
        cmd: spec.Cmd ?? [],
        entrypoint: spec.Entrypoint,
        env: spec.Env ?? [],
        binds: spec.HostConfig?.Binds ?? [],
        workdir: spec.WorkingDir,
        user: spec.User,
        attached: null,
        proc: null,
        status: null,
        waiters: [],
        killTimer: null
      });
      respond(socket, 201, { Id: id, Warnings: [] });
      return;
    }

    if (path === "/containers/json") {
      const filters = JSON.parse(url.searchParams.get("filters") ?? "{}") as { label?: string[] };
      const wanted = filters.label ?? [];
      const rows = [...containers.values()].filter((container) =>
        wanted.every((entry) => {
          const [key, value] = entry.includes("=") ? entry.split("=", 2) : [entry, undefined];
          const actual = container.labels[key ?? ""];
          return actual !== undefined && (value === undefined || actual === value);
        })
      );
      respond(
        socket,
        200,
        rows.map((container) => ({ Id: container.id, Names: [`/${container.name}`], Labels: container.labels }))
      );
      return;
    }

    const action = /^\/containers\/([^/]+)(?:\/(attach|start|wait|stop|kill))?$/.exec(path);
    const container = action?.[1] ? containers.get(action[1]) : undefined;
    if (!container) {
      respond(socket, 404, { message: "No such container" });
      return;
    }

    switch (action?.[2]) {
      case "attach":
        container.attached = socket;
        socket.data.hijacked = container;
        socket.write(
          "HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n"
        );
        return;
      case "start": {
        const argv = [...(container.entrypoint ?? []), ...container.cmd];
        const env: Record<string, string> = {};
        for (const pair of container.env) {
          const index = pair.indexOf("=");
          if (index > 0) env[pair.slice(0, index)] = pair.slice(index + 1);
        }
        const proc = Bun.spawn(argv, {
          env: { PATH: Bun.env.PATH ?? "/usr/bin", ...env },
          ...(container.workdir ? { cwd: container.workdir } : {}),
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe"
        });
        container.proc = proc;
        if (container.attached) pipe(container, container.attached, proc);
        respond(socket, 204, null);
        return;
      }
      case "wait": {
        if (container.status !== null) {
          respond(socket, 200, { StatusCode: container.status });
          return;
        }
        container.waiters.push((code) => respond(socket, 200, { StatusCode: code }));
        return;
      }
      case "stop": {
        const grace = Number(url.searchParams.get("t") ?? "10") * 1000;
        container.proc?.kill("SIGTERM");
        container.killTimer = setTimeout(() => container.proc?.kill("SIGKILL"), grace);
        respond(socket, 204, null);
        return;
      }
      case "kill":
        container.proc?.kill("SIGKILL");
        respond(socket, 204, null);
        return;
      default:
        if (method === "DELETE") {
          if (container.killTimer) clearTimeout(container.killTimer);
          container.proc?.kill("SIGKILL");
          containers.delete(container.id);
          respond(socket, 204, null);
          return;
        }
        respond(socket, 404, { message: "not implemented by the mock" });
    }
  };

  const drain = (socket: Socket<Data>): void => {
    for (;;) {
      const text = new TextDecoder("latin1").decode(socket.data.buffer);
      const end = text.indexOf("\r\n\r\n");
      if (end === -1) return;
      const head = text.slice(0, end);
      const [line = "", ...headerLines] = head.split("\r\n");
      const [method = "GET", target = "/"] = line.split(" ");
      const length = Number(
        headerLines.find((header) => header.toLowerCase().startsWith("content-length:"))?.split(":")[1] ?? "0"
      );
      if (text.length - end - 4 < length) return;
      const body = text.slice(end + 4, end + 4 + length);
      socket.data.buffer = socket.data.buffer.slice(end + 4 + length);
      handle(socket, method, target, body);
      if (socket.data.hijacked) return;
    }
  };

  rmSync(path, { force: true });

  const listener: UnixSocketListener<Data> = Bun.listen<Data>({
    unix: path,
    socket: {
      open(socket) {
        socket.data = { buffer: new Uint8Array(0), hijacked: null };
      },
      data(socket, chunk) {
        const container = socket.data.hijacked;
        if (container) {
          const stdin = container.proc?.stdin;
          if (stdin) {
            stdin.write(chunk);
            void stdin.flush();
          }
          return;
        }
        socket.data.buffer = concat(socket.data.buffer, chunk);
        drain(socket);
      },
      close() {
        return;
      },
      error() {
        return;
      }
    }
  });

  return {
    path,
    calls,
    containers: () => [...containers.values()],
    seedImage: (reference) => images.add(reference),
    seedContainer: (labels, name) => {
      sequence += 1;
      const id = `c${String(sequence).padStart(4, "0")}${"0".repeat(58)}`;
      containers.set(id, {
        id,
        name,
        labels,
        image: "seed",
        cmd: [],
        entrypoint: null,
        env: [],
        binds: [],
        workdir: null,
        user: null,
        attached: null,
        proc: null,
        status: 0,
        waiters: [],
        killTimer: null
      });
      return id;
    },
    async stop() {
      for (const container of containers.values()) container.proc?.kill("SIGKILL");
      listener.stop(true);
      rmSync(path, { force: true });
    }
  };
}
