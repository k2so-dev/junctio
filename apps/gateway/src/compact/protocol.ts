export type SandboxMode = "search" | "execute";

export type SandboxFailure = { name: string; message: string; location?: string };

export type RunMessage = {
  type: "run";
  mode: SandboxMode;
  code: string;
  catalog: string;
  deadline: number;
  memoryBytes: number;
  stackBytes: number;
  logLines: number;
  logChars: number;
};

export type HostMessage =
  | RunMessage
  | { type: "result"; id: number; ok: true; value: string }
  | { type: "result"; id: number; ok: false; name: string; error: string };

export type ChildMessage =
  | { type: "ready" }
  | { type: "log"; line: string }
  | { type: "call"; id: number; name: string; input: string }
  | { type: "done"; ok: true; value: string }
  | { type: "done"; ok: false; error: SandboxFailure; catalog?: true };
