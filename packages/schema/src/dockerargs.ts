export type ContainerSpec = {
  image: string;
  cmd: string[];
  entrypoint: string[] | null;
  env: Record<string, string>;
  binds: string[];
  network: string | null;
  workdir: string | null;
  user: string | null;
  init: boolean;
  pull: "missing" | "always" | "never";
  labels: Record<string, string>;
};

export type ParsedDockerRun = {
  spec: ContainerSpec | null;
  errors: string[];
  notes: string[];
};

const VALUE_FLAGS = new Set([
  "-e",
  "--env",
  "--env-file",
  "-v",
  "--volume",
  "--mount",
  "--network",
  "--net",
  "-w",
  "--workdir",
  "-u",
  "--user",
  "--entrypoint",
  "--pull",
  "-l",
  "--label",
  "--name",
  "--platform"
]);

const REFUSED: Record<string, string> = {
  "-d": "the gateway needs the container attached to its stdio",
  "--detach": "the gateway needs the container attached to its stdio",
  "-p": "an mcp server over stdio needs no published port",
  "--publish": "an mcp server over stdio needs no published port",
  "--privileged": "refused on purpose",
  "--cap-add": "refused on purpose",
  "--device": "refused on purpose",
  "--pid": "refused on purpose",
  "--ipc": "refused on purpose",
  "--gpus": "not supported by the gateway",
  "--env-file": "the gateway has no access to that file, list the variables in Environment instead",
  "--restart": "the gateway restarts the container itself"
};

const IGNORED: Record<string, string> = {
  "-t": "runs without a tty",
  "--tty": "runs without a tty",
  "--name": "the gateway names containers itself",
  "--platform": "the platform is left to the daemon"
};

function splitFlag(part: string): { flag: string; inline: string | null } {
  if (!part.startsWith("--")) return { flag: part, inline: null };
  const index = part.indexOf("=");
  if (index === -1) return { flag: part, inline: null };
  return { flag: part.slice(0, index), inline: part.slice(index + 1) };
}

function parseMount(value: string): { bind: string | null; error: string | null } {
  const fields: Record<string, string> = {};
  const flags = new Set<string>();
  for (const part of value.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) {
      if (part !== "") flags.add(part);
      continue;
    }
    fields[part.slice(0, index)] = part.slice(index + 1);
  }
  const type = fields.type ?? "volume";
  if (type !== "bind" && type !== "volume") {
    return { bind: null, error: `--mount type ${type} is not supported, use bind or volume` };
  }
  const source = fields.source ?? fields.src ?? "";
  const target = fields.target ?? fields.destination ?? fields.dst ?? "";
  if (target === "") return { bind: null, error: "--mount needs a target" };
  if (source === "") return { bind: null, error: "--mount needs a source" };
  const readonly = flags.has("readonly") || flags.has("ro") || fields.readonly === "true" || fields.ro === "true";
  return { bind: `${source}:${target}${readonly ? ":ro" : ""}`, error: null };
}

function assignEnv(spec: ContainerSpec, value: string, ambient: Record<string, string>, errors: string[]): void {
  const index = value.indexOf("=");
  if (index !== -1) {
    spec.env[value.slice(0, index)] = value.slice(index + 1);
    return;
  }
  const existing = ambient[value];
  if (existing === undefined) {
    errors.push(`-e ${value} has no value, set ${value} in Environment`);
    return;
  }
  spec.env[value] = existing;
}

export function parseDockerRun(args: string[], env: Record<string, string> = {}): ParsedDockerRun {
  const parts = args.map((part) => part.trim()).filter((part) => part !== "");
  const errors: string[] = [];
  const notes: string[] = [];

  if (parts.length === 0) return { spec: null, errors: ["arguments are required, start with run"], notes };
  if (parts[0] !== "run") {
    return { spec: null, errors: [`the arguments must start with run, not ${parts[0]}`], notes };
  }

  const spec: ContainerSpec = {
    image: "",
    cmd: [],
    entrypoint: null,
    env: { ...env },
    binds: [],
    network: null,
    workdir: null,
    user: null,
    init: false,
    pull: "missing",
    labels: {}
  };

  let index = 1;
  for (; index < parts.length; index += 1) {
    const part = parts[index] as string;
    if (!part.startsWith("-")) break;

    if (part === "--") {
      index += 1;
      break;
    }

    const { flag, inline } = splitFlag(part);
    const refusal = REFUSED[flag];
    if (refusal) {
      errors.push(`${flag} is not supported: ${refusal}`);
      if (inline === null && VALUE_FLAGS.has(flag)) index += 1;
      continue;
    }

    const takesValue = VALUE_FLAGS.has(flag);
    let value = inline;
    if (takesValue && value === null) {
      value = parts[index + 1] ?? null;
      if (value === null) {
        errors.push(`${flag} needs a value`);
        continue;
      }
      index += 1;
    }

    const ignored = IGNORED[flag];
    if (ignored) {
      notes.push(`${flag} is ignored, ${ignored}`);
      continue;
    }

    switch (flag) {
      case "-i":
      case "--interactive":
      case "--rm":
        continue;
      case "--init":
        spec.init = true;
        continue;
      case "-e":
      case "--env":
        assignEnv(spec, value as string, env, errors);
        continue;
      case "-v":
      case "--volume":
        spec.binds.push(value as string);
        continue;
      case "--mount": {
        const mount = parseMount(value as string);
        if (mount.error) errors.push(mount.error);
        else spec.binds.push(mount.bind as string);
        continue;
      }
      case "--network":
      case "--net":
        spec.network = value as string;
        continue;
      case "-w":
      case "--workdir":
        spec.workdir = value as string;
        continue;
      case "-u":
      case "--user":
        spec.user = value as string;
        continue;
      case "--entrypoint":
        spec.entrypoint = [value as string];
        continue;
      case "--pull": {
        const mode = value as string;
        if (mode !== "always" && mode !== "missing" && mode !== "never") {
          errors.push(`--pull takes always, missing or never, not ${mode}`);
          continue;
        }
        spec.pull = mode;
        continue;
      }
      case "-l":
      case "--label": {
        const raw = value as string;
        const eq = raw.indexOf("=");
        if (eq === -1) spec.labels[raw] = "";
        else spec.labels[raw.slice(0, eq)] = raw.slice(eq + 1);
        continue;
      }
      default:
        errors.push(`unsupported flag ${flag}`);
        continue;
    }
  }

  const rest = parts.slice(index);
  const image = rest[0] ?? "";
  if (image === "") {
    errors.push("no image given, the last argument before the command is the image");
    return { spec: null, errors, notes };
  }
  spec.image = image;
  spec.cmd = rest.slice(1);

  if (errors.length > 0) return { spec: null, errors, notes };
  return { spec, errors, notes };
}
