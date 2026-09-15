import type { SanctionAction, SanctionSeverity, Severity } from "@junctio/schema";
import type { ActionMap, AuditFinding, SeverityCounts } from "./types.ts";

export const DEFAULT_ACTIONS: ActionMap = {
  critical: "quarantine",
  high: "report",
  moderate: "report",
  low: "ignore"
};

export const ACTION_RANK: Record<SanctionAction, number> = {
  ignore: 0,
  report: 1,
  quarantine: 2,
  disable: 3
};

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  unknown: 3,
  low: 1
};

const ACTIONS: SanctionAction[] = ["ignore", "report", "quarantine", "disable"];
const SANCTION_SEVERITIES: SanctionSeverity[] = ["critical", "high", "moderate", "low"];

export function parseActionMap(raw: string): ActionMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_ACTIONS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_ACTIONS };
  const source = parsed as Record<string, unknown>;
  const out = { ...DEFAULT_ACTIONS };
  for (const severity of SANCTION_SEVERITIES) {
    const value = source[severity];
    if (typeof value === "string" && ACTIONS.includes(value as SanctionAction)) {
      out[severity] = value as SanctionAction;
    }
  }
  return out;
}

export function sanctionSeverity(severity: Severity): SanctionSeverity {
  return severity === "unknown" ? "high" : severity;
}

export function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
}

export function countBySeverity(findings: AuditFinding[]): SeverityCounts {
  const counts = emptyCounts();
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export function normalizeAdvisoryId(value: string): string {
  return value.trim().toUpperCase();
}

export function isIgnored(finding: AuditFinding, ignores: Set<string>): boolean {
  if (ignores.size === 0) return false;
  if (ignores.has(normalizeAdvisoryId(finding.id))) return true;
  return finding.aliases.some((alias) => ignores.has(normalizeAdvisoryId(alias)));
}

export type Decision = {
  action: SanctionAction | null;
  worst: Severity | null;
  active: AuditFinding[];
  ignored: AuditFinding[];
  counts: SeverityCounts;
  reason: string | null;
};

function describe(active: AuditFinding[], counts: SeverityCounts): string {
  const parts: string[] = [];
  for (const severity of ["critical", "high", "moderate", "low", "unknown"] as Severity[]) {
    if (counts[severity] > 0) parts.push(`${counts[severity]} ${severity}`);
  }
  const head = parts.join(", ");
  const sample = active
    .slice()
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, 3)
    .map((finding) => `${finding.id} in ${finding.package}${finding.version ? `@${finding.version}` : ""}`)
    .join(", ");
  return sample === "" ? head : `${head}: ${sample}`;
}

export function decide(findings: AuditFinding[], ignores: Set<string>, actions: ActionMap): Decision {
  const active: AuditFinding[] = [];
  const ignored: AuditFinding[] = [];
  for (const finding of findings) {
    if (isIgnored(finding, ignores)) ignored.push(finding);
    else active.push(finding);
  }
  const counts = countBySeverity(active);
  if (active.length === 0) {
    return { action: null, worst: null, active, ignored, counts, reason: null };
  }
  let action: SanctionAction = "ignore";
  let worst: Severity = active[0]!.severity;
  for (const finding of active) {
    const candidate = actions[sanctionSeverity(finding.severity)];
    if (ACTION_RANK[candidate] > ACTION_RANK[action]) action = candidate;
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[worst]) worst = finding.severity;
  }
  return { action, worst, active, ignored, counts, reason: describe(active, counts) };
}

export function shouldLift(quarantined: boolean, status: string, decision: Decision): boolean {
  if (!quarantined) return false;
  if (status !== "ok" && status !== "vulnerable") return false;
  if (decision.action === null) return true;
  return ACTION_RANK[decision.action] < ACTION_RANK.quarantine;
}
