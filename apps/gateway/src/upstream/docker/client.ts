import { accessSync, constants, statSync, type Stats } from "node:fs";

export type DockerVersion = {
  version: string;
  apiVersion: string;
};

export type ContainerSummary = {
  id: string;
  names: string[];
  labels: Record<string, string>;
};

export type CreateBody = {
  Image: string;
  Cmd: string[] | null;
  Entrypoint: string[] | null;
  Env: string[];
  WorkingDir: string | null;
  User: string | null;
  Labels: Record<string, string>;
  OpenStdin: boolean;
  StdinOnce: boolean;
  AttachStdin: boolean;
  AttachStdout: boolean;
  AttachStderr: boolean;
  Tty: boolean;
  HostConfig: {
    Binds: string[];
    NetworkMode?: string;
    Init?: boolean;
    AutoRemove: boolean;
  };
};

export class DockerError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "DockerError";
  }
}

function diagnose(socket: string): string {
  let stats: Stats;
  try {
    stats = statSync(socket);
  } catch {
    return `docker socket not found at ${socket}, mount it into the gateway container`;
  }
  if (!stats.isSocket()) return `${socket} is not a socket, point JUNCTIO_DOCKER_SOCKET at the docker socket`;
  try {
    accessSync(socket, constants.R_OK | constants.W_OK);
  } catch {
    return `permission denied on ${socket}, add its group to the gateway with group_add`;
  }
  return `nothing answers on ${socket}, is the docker daemon running?`;
}

function friendly(error: unknown, socket: string): DockerError {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|No such file/i.test(message)) {
    return new DockerError(`docker socket not found at ${socket}, mount it into the gateway container`, null);
  }
  if (/EACCES|permission denied/i.test(message)) {
    return new DockerError(`permission denied on ${socket}, add its group to the gateway with group_add`, null);
  }
  if (/FailedToOpenSocket|ECONNREFUSED|typo in the url/i.test(message)) {
    return new DockerError(diagnose(socket), null);
  }
  return new DockerError(`docker socket ${socket}: ${message}`, null);
}

export class DockerClient {
  constructor(readonly socket: string) {}

  private url(path: string): string {
    return `http://docker${path}`;
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetch(this.url(path), {
        method,
        unix: this.socket,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      });
    } catch (error) {
      throw friendly(error, this.socket);
    }
  }

  private async fail(response: Response): Promise<DockerError> {
    const text = await response.text().catch(() => "");
    let detail = text.trim();
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === "string") detail = parsed.message;
    } catch {
      detail = detail.slice(0, 300);
    }
    return new DockerError(detail === "" ? `docker answered ${response.status}` : detail, response.status);
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    if (!response.ok) throw await this.fail(response);
    return (await response.json()) as T;
  }

  private async none(method: string, path: string, body?: unknown): Promise<void> {
    const response = await this.send(method, path, body);
    if (!response.ok) throw await this.fail(response);
    await response.text().catch(() => "");
  }

  async version(): Promise<DockerVersion> {
    const body = await this.json<{ Version?: string; ApiVersion?: string }>("GET", "/version");
    return { version: body.Version ?? "unknown", apiVersion: body.ApiVersion ?? "unknown" };
  }

  async hasImage(reference: string): Promise<boolean> {
    const response = await this.send("GET", `/images/${encodeURIComponent(reference)}/json`);
    if (response.ok) {
      await response.text().catch(() => "");
      return true;
    }
    if (response.status === 404) {
      await response.text().catch(() => "");
      return false;
    }
    throw await this.fail(response);
  }

  async pull(reference: string, onStatus: (line: string) => void): Promise<void> {
    const response = await this.send("POST", `/images/create?fromImage=${encodeURIComponent(reference)}`);
    if (!response.ok) throw await this.fail(response);
    const body = response.body;
    if (!body) return;
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let rest = "";
    let failure: string | null = null;
    let last = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() === "") continue;
        const parsed = JSON.parse(line) as { status?: unknown; error?: unknown; progress?: unknown };
        if (typeof parsed.error === "string") failure = parsed.error;
        if (typeof parsed.status !== "string" || parsed.progress !== undefined) continue;
        if (parsed.status === last) continue;
        last = parsed.status;
        onStatus(parsed.status);
      }
    }
    if (failure !== null) throw new DockerError(failure, null);
  }

  async create(body: CreateBody, name: string): Promise<string> {
    const created = await this.json<{ Id?: string; Warnings?: string[] }>(
      "POST",
      `/containers/create?name=${encodeURIComponent(name)}`,
      body
    );
    if (!created.Id) throw new DockerError("the daemon created a container without an id", null);
    return created.Id;
  }

  async start(id: string): Promise<void> {
    await this.none("POST", `/containers/${id}/start`);
  }

  async wait(id: string): Promise<number> {
    const body = await this.json<{ StatusCode?: number }>("POST", `/containers/${id}/wait?condition=next-exit`);
    return body.StatusCode ?? 0;
  }

  async stop(id: string, graceSec: number): Promise<void> {
    const response = await this.send("POST", `/containers/${id}/stop?t=${graceSec}`);
    await response.text().catch(() => "");
  }

  async kill(id: string): Promise<void> {
    const response = await this.send("POST", `/containers/${id}/kill`);
    await response.text().catch(() => "");
  }

  async remove(id: string): Promise<void> {
    const response = await this.send("DELETE", `/containers/${id}?force=1&v=1`);
    await response.text().catch(() => "");
  }

  async list(...labels: string[]): Promise<ContainerSummary[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: labels }));
    const body = await this.json<{ Id?: string; Names?: string[]; Labels?: Record<string, string> }[]>(
      "GET",
      `/containers/json?all=1&filters=${filters}`
    );
    return body.map((item) => ({
      id: item.Id ?? "",
      names: (item.Names ?? []).map((name) => name.replace(/^\//, "")),
      labels: item.Labels ?? {}
    }));
  }
}
