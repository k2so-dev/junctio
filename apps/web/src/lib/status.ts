import type { AuditStatus, AuditSummaryDto, SanctionAction, ServerDto, ServerStatus, Severity } from "@junctio/schema";

export type Tone = "success" | "warning" | "destructive" | "muted";

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
  no_refresh: { label: "No refresh token", tone: "warning", pulse: false },
  quarantined: { label: "Quarantined", tone: "destructive", pulse: false }
};

export function statusMeta(status: ServerStatus): StatusMeta {
  return STATUS[status];
}

export const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground"
};

export const TONE_BG: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground"
};

export const TONE_BORDER: Record<Tone, string> = {
  success: "border-success/50",
  warning: "border-warning/50",
  destructive: "border-destructive/50",
  muted: "border-border"
};

export function serverMeta(server: ServerDto): string {
  if (server.transport !== "stdio") return server.url ?? "";
  return server.warm ? "warm start" : "lazy start";
}

export function needsAttention(server: ServerDto): boolean {
  return (
    server.status === "failed" ||
    server.status === "needs_reauth" ||
    server.status === "no_refresh" ||
    server.status === "quarantined"
  );
}

const AUDIT_STATUS: Record<AuditStatus, StatusMeta> = {
  ok: { label: "No known advisories", tone: "success", pulse: false },
  vulnerable: { label: "Advisories found", tone: "warning", pulse: false },
  error: { label: "Audit failed", tone: "warning", pulse: false },
  unsupported: { label: "Not audited", tone: "muted", pulse: false },
  pending: { label: "Never audited", tone: "muted", pulse: false }
};

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "destructive",
  high: "destructive",
  moderate: "warning",
  low: "muted",
  unknown: "muted"
};

const AUDIT_SHORT: Record<AuditStatus, string> = {
  ok: "Clean",
  vulnerable: "Advisories",
  error: "Audit failed",
  unsupported: "Not audited",
  pending: "Never audited"
};

export function auditMeta(summary: AuditSummaryDto, compact = false): StatusMeta {
  if (summary.status === "vulnerable" && summary.worst) {
    const tone = SEVERITY_TONE[summary.worst];
    return { label: `${summary.activeCount} ${summary.worst}`, tone, pulse: false };
  }
  const meta = AUDIT_STATUS[summary.status];
  return compact ? { ...meta, label: AUDIT_SHORT[summary.status] } : meta;
}

export function severityTone(severity: Severity): Tone {
  return SEVERITY_TONE[severity];
}

export const ACTION_LABEL: Record<SanctionAction, string> = {
  ignore: "Ignore",
  report: "Report only",
  quarantine: "Quarantine the server",
  disable: "Disable the server"
};
