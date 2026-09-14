import type { Subprocess } from "bun";
import type { Handle, ProcessLaunch } from "./launch.ts";

export async function spawnProcess(launch: ProcessLaunch, log: (line: string) => void): Promise<Handle> {
  const argv = launch.argv.filter((part) => part !== "");
  if (argv.length === 0) throw new Error("empty command");

  const executable = argv[0] as string;
  if (!executable.includes("/") && !Bun.which(executable, { PATH: launch.env.PATH ?? "" })) {
    throw new Error(`${executable} is not in PATH (${launch.env.PATH ?? ""}); adjust PATH in Settings`);
  }

  const controller = new AbortController();
  let proc: Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn(argv, {
      cwd: launch.cwd ?? undefined,
      env: launch.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(`failed to spawn: ${error instanceof Error ? error.message : String(error)}`);
  }

  log(`started: ${argv.join(" ")} (pid ${proc.pid})`);

  return {
    describe: argv.join(" "),
    pid: proc.pid ?? null,
    containerId: null,
    stdin: proc.stdin,
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited.then((code) => ({ code, signal: proc.signalCode })),
    terminate: () => proc.kill("SIGTERM"),
    kill: () => {
      try {
        proc.kill("SIGKILL");
      } catch {
        return;
      }
    },
    dispose: () => controller.abort()
  };
}
