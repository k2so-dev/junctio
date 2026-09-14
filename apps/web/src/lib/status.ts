import type { ServerDto, ServerStatus } from "@junctio/schema";

export type Tone = "success" | "warning" | "destructive" | "muted" | "foreground";

interface StatusMeta {
  label: string;
  tone: Tone;
  pulse: boolean;
}

const STATUS: Record<ServerStatus, StatusMeta> = {
  running: { label: "Running", tone: "success", pulse: false },
  starting: { label: "Starting", tone: "success", pulse: true },
  idle: { label: "Idle", tone: "muted", pulse: false },
  stopped: { label: "Stopped", tone: "muted", pulse: false },
  failed: { label: "Failed", tone: "destructive", pulse: false },
  needs_reauth: { label: "Needs re-auth", tone: "warning", pulse: true },
  no_refresh: { label: "No refresh token", tone: "warning", pulse: false }
};

export function statusMeta(status: ServerStatus): StatusMeta {
  return STATUS[status];
}

export const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
  foreground: "text-foreground"
};

export const TONE_BG: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
  foreground: "bg-foreground"
};

export const TONE_BORDER: Record<Tone, string> = {
  success: "border-success/50",
  warning: "border-warning/50",
  destructive: "border-destructive/50",
  muted: "border-border",
  foreground: "border-foreground/50"
};

export function serverMeta(server: ServerDto): string {
  if (server.transport === "http") return server.url ?? "";
  return server.warm ? "warm start" : "lazy start";
}

export function needsAttention(server: ServerDto): boolean {
  return server.status === "failed" || server.status === "needs_reauth" || server.status === "no_refresh";
}
