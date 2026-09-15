import type { AuditEcosystem, AuditTrigger, SanctionAction, SanctionSeverity, Severity } from "@junctio/schema";
import type { Logger } from "../log.ts";

export type ActionMap = Record<SanctionSeverity, SanctionAction>;

export type AuditFinding = {
  id: string;
  aliases: string[];
  package: string;
  version: string | null;
  vulnerableRange: string | null;
  title: string;
  severity: Severity;
  cvss: number | null;
  url: string | null;
};

export type SeverityCounts = Record<Severity, number>;

export type AuditTarget =
  | { kind: "npm"; specs: string[] }
  | { kind: "pypi"; requirements: string[] }
  | { kind: "node-project"; cwd: string }
  | { kind: "self"; appDir: string };

export type Unsupported = { kind: "unsupported"; reason: string };

export type TargetKind = AuditTarget["kind"];

export type EngineContext = {
  signal: AbortSignal;
  env: Record<string, string>;
  logger: Logger;
  fetchImpl: typeof fetch;
  tmpRoot: string;
};

export type EngineResult = {
  findings: AuditFinding[];
  resolved: string[];
  engine: string;
};

export interface AuditEngine {
  readonly kinds: readonly TargetKind[];
  audit(target: AuditTarget, ctx: EngineContext): Promise<EngineResult>;
}

export type AuditRunSummary = {
  trigger: AuditTrigger;
  startedAt: number;
  finishedAt: number | null;
  total: number;
  done: number;
  ok: number;
  vulnerable: number;
  errors: number;
  unsupported: number;
  quarantined: number;
  lifted: number;
  disabled: number;
};

export const SELF_ID = "self";

export const ECOSYSTEM_BY_KIND: Record<TargetKind, AuditEcosystem> = {
  npm: "npm",
  "node-project": "npm",
  pypi: "pypi",
  self: "self"
};

export function targetValues(target: AuditTarget): string[] {
  if (target.kind === "npm") return target.specs;
  if (target.kind === "pypi") return target.requirements;
  if (target.kind === "node-project") return [target.cwd];
  return [target.appDir];
}
