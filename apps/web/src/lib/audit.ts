import type { SanctionAction, SanctionSeverity } from "@junctio/schema";

export const SEVERITIES: SanctionSeverity[] = ["critical", "high", "moderate", "low"];

export const ACTIONS: SanctionAction[] = ["ignore", "report", "quarantine", "disable"];
