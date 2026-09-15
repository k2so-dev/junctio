import type { AuditActionMap } from "@junctio/schema";

export const DEFAULT_ACTIONS: AuditActionMap = {
  critical: "quarantine",
  high: "report",
  moderate: "report",
  low: "ignore"
};
