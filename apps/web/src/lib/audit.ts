import type { AuditActionMap, SanctionAction, SanctionSeverity } from "@junctio/schema";

export const DEFAULT_ACTIONS: AuditActionMap = {
  critical: "quarantine",
  high: "report",
  moderate: "report",
  low: "ignore"
};

export const SEVERITIES: SanctionSeverity[] = ["critical", "high", "moderate", "low"];

export const ACTIONS: SanctionAction[] = ["ignore", "report", "quarantine", "disable"];
