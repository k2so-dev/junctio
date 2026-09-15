import { z } from "zod";

export const severities = ["critical", "high", "moderate", "low", "unknown"] as const;
export const Severity = z.enum(severities);
export type Severity = z.infer<typeof Severity>;

export const sanctionSeverities = ["critical", "high", "moderate", "low"] as const;
export const SanctionSeverity = z.enum(sanctionSeverities);
export type SanctionSeverity = z.infer<typeof SanctionSeverity>;

export const sanctionActions = ["ignore", "report", "quarantine", "disable"] as const;
export const SanctionAction = z.enum(sanctionActions);
export type SanctionAction = z.infer<typeof SanctionAction>;

export const AuditActionMap = z.object({
  critical: SanctionAction,
  high: SanctionAction,
  moderate: SanctionAction,
  low: SanctionAction
});
export type AuditActionMap = z.infer<typeof AuditActionMap>;

export const auditStatuses = ["ok", "vulnerable", "error", "unsupported", "pending"] as const;
export const AuditStatus = z.enum(auditStatuses);
export type AuditStatus = z.infer<typeof AuditStatus>;

export const auditEcosystems = ["npm", "pypi", "self"] as const;
export const AuditEcosystem = z.enum(auditEcosystems);
export type AuditEcosystem = z.infer<typeof AuditEcosystem>;

export const auditTriggers = ["periodic", "manual", "server-saved", "startup"] as const;
export const AuditTrigger = z.enum(auditTriggers);
export type AuditTrigger = z.infer<typeof AuditTrigger>;

export const AuditFindingDto = z.object({
  id: z.string(),
  aliases: z.array(z.string()),
  package: z.string(),
  version: z.string().nullable(),
  vulnerableRange: z.string().nullable(),
  title: z.string(),
  severity: Severity,
  cvss: z.number().nullable(),
  url: z.string().nullable(),
  ignored: z.boolean()
});
export type AuditFindingDto = z.infer<typeof AuditFindingDto>;

export const SeverityCounts = z.object({
  critical: z.number(),
  high: z.number(),
  moderate: z.number(),
  low: z.number(),
  unknown: z.number()
});
export type SeverityCounts = z.infer<typeof SeverityCounts>;

export const AuditSummaryDto = z.object({
  status: AuditStatus,
  ecosystem: AuditEcosystem.nullable(),
  counts: SeverityCounts,
  activeCount: z.number(),
  ignoredCount: z.number(),
  worst: Severity.nullable(),
  action: SanctionAction.nullable(),
  checkedAt: z.number().nullable(),
  error: z.string().nullable(),
  reason: z.string().nullable()
});
export type AuditSummaryDto = z.infer<typeof AuditSummaryDto>;

export const AuditIgnoreDto = z.object({
  advisoryId: z.string(),
  reason: z.string().nullable(),
  createdAt: z.number()
});
export type AuditIgnoreDto = z.infer<typeof AuditIgnoreDto>;

export const AuditReportDto = AuditSummaryDto.extend({
  id: z.string(),
  name: z.string(),
  target: z.array(z.string()),
  resolved: z.array(z.string()),
  engine: z.string().nullable(),
  trigger: AuditTrigger.nullable(),
  durationMs: z.number().nullable(),
  quarantined: z.boolean(),
  quarantineReason: z.string().nullable(),
  findings: z.array(AuditFindingDto),
  ignores: z.array(AuditIgnoreDto)
});
export type AuditReportDto = z.infer<typeof AuditReportDto>;

export const AuditRunSummaryDto = z.object({
  trigger: AuditTrigger,
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  total: z.number(),
  done: z.number(),
  ok: z.number(),
  vulnerable: z.number(),
  errors: z.number(),
  unsupported: z.number(),
  quarantined: z.number(),
  lifted: z.number(),
  disabled: z.number()
});
export type AuditRunSummaryDto = z.infer<typeof AuditRunSummaryDto>;

export const AuditServerSummaryDto = AuditSummaryDto.extend({
  serverId: z.string(),
  serverName: z.string(),
  quarantined: z.boolean()
});
export type AuditServerSummaryDto = z.infer<typeof AuditServerSummaryDto>;

export const AuditOverviewDto = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  current: AuditRunSummaryDto.nullable(),
  lastRun: AuditRunSummaryDto.nullable(),
  nextRunAt: z.number().nullable(),
  self: AuditSummaryDto.nullable(),
  servers: z.array(AuditServerSummaryDto)
});
export type AuditOverviewDto = z.infer<typeof AuditOverviewDto>;

export const AuditIgnoreInput = z.object({
  reason: z.string().max(500).nullable().default(null)
});
export type AuditIgnoreInput = z.infer<typeof AuditIgnoreInput>;
