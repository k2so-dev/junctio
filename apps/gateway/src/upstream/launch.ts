import type { ContainerSpec } from "@junctio/schema";
import type { StdioSink } from "./stdio.ts";

export type ProcessLaunch = {
  kind: "process";
  argv: string[];
  cwd: string | null;
  env: Record<string, string>;
};

export type ContainerLaunch = {
  kind: "container";
  serverId: string;
  name: string;
  container: ContainerSpec;
};

export type Launch = ProcessLaunch | ContainerLaunch;

export type Exit = {
  code: number | null;
  signal: string | null;
};

export type Handle = {
  describe: string;
  pid: number | null;
  containerId: string | null;
  stdin: StdioSink | null;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<Exit>;
  terminate(graceMs: number): void;
  kill(): void;
  dispose(): void;
};

export type Launcher = (launch: Launch, log: (line: string) => void) => Promise<Handle>;
