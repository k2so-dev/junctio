import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AuditEngine, AuditFinding, AuditTarget, EngineContext, EngineResult, TargetKind } from "../types.ts";
import type { Severity } from "@junctio/schema";
import { withTempDir } from "../tmp.ts";

export type BunAuditAdvisory = {
  id: number;
  url?: string;
  title?: string;
  severity?: string;
  vulnerable_versions?: string;
  cwe?: string[];
  cvss?: { score?: number; vectorString?: string };
};

export type BunAuditReport = Record<string, BunAuditAdvisory[]>;

const SEVERITIES: Severity[] = ["critical", "high", "moderate", "low"];

export function toSeverity(value: string | undefined): Severity {
  const lowered = (value ?? "").toLowerCase();
  if (lowered === "medium") return "moderate";
  return SEVERITIES.includes(lowered as Severity) ? (lowered as Severity) : "unknown";
}

export function parseBunAuditOutput(stdout: string): BunAuditReport {
  const trimmed = stdout.trim();
  if (trimmed === "") throw new Error("bun audit did not return json");
  const lines = trimmed.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith("{")) continue;
    const candidate = lines.slice(i).join("\n").trim();
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed !== "object" || parsed === null) continue;
      if ("error" in parsed) throw new Error(String((parsed as { error: unknown }).error));
      return parsed as BunAuditReport;
    } catch {
      continue;
    }
  }
  throw new Error("bun audit did not return json");
}

function safeAdvisoryUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function advisoryId(advisory: BunAuditAdvisory): { id: string; aliases: string[] } {
  const ghsa = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(advisory.url ?? "");
  if (ghsa) return { id: ghsa[0].toUpperCase(), aliases: [`NPM:${advisory.id}`] };
  return { id: `NPM:${advisory.id}`, aliases: [] };
}

export function toFindings(report: BunAuditReport, versions: Map<string, string>): AuditFinding[] {
  const out: AuditFinding[] = [];
  for (const [name, advisories] of Object.entries(report)) {
    if (!Array.isArray(advisories)) continue;
    for (const advisory of advisories) {
      const { id, aliases } = advisoryId(advisory);
      out.push({
        id,
        aliases,
        package: name,
        version: versions.get(name) ?? null,
        vulnerableRange: advisory.vulnerable_versions ?? null,
        title: advisory.title ?? "vulnerability reported by the npm advisory database",
        severity: toSeverity(advisory.severity),
        cvss: typeof advisory.cvss?.score === "number" ? advisory.cvss.score : null,
        url: safeAdvisoryUrl(advisory.url)
      });
    }
  }
  return out;
}

export function manifestFor(specs: string[]): string {
  const dependencies: Record<string, string> = {};
  for (const spec of specs) {
    const at = spec.lastIndexOf("@");
    const name = at > 0 ? spec.slice(0, at) : spec;
    const range = at > 0 ? spec.slice(at + 1) : "";
    dependencies[name] = range === "" ? "latest" : range;
  }
  return `${JSON.stringify({ name: "junctio-audit", version: "0.0.0", private: true, dependencies }, null, 2)}\n`;
}

export function parseLockVersions(lock: string): Map<string, string> {
  const versions = new Map<string, string>();
  const pattern = /"((?:@[^"/]+\/)?[^"@]+)@([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(lock)) !== null) {
    const name = match[1]!;
    const version = match[2]!;
    if (!/^\d/.test(version)) continue;
    if (!versions.has(name)) versions.set(name, version);
  }
  return versions;
}

function lastLines(text: string, count = 3): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-count)
    .join("; ");
}

const SELF_MANIFESTS = ["package.json", "bun.lock", "packages/schema/package.json", "web/package.json"];

export class BunAuditEngine implements AuditEngine {
  readonly kinds: readonly TargetKind[] = ["npm", "node-project", "self"];

  constructor(private readonly bunPath: string = process.execPath) {}

  private async run(argv: string[], cwd: string, ctx: EngineContext): Promise<{ stdout: string; stderr: string; code: number }> {
    const proc = Bun.spawn([this.bunPath, ...argv], {
      cwd,
      env: ctx.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: ctx.signal
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ]);
    return { stdout, stderr, code };
  }

  private async auditIn(cwd: string, ctx: EngineContext, versions: Map<string, string>): Promise<EngineResult> {
    const audit = await this.run(["audit", "--json"], cwd, ctx);
    if (audit.code > 1) {
      const detail = lastLines(audit.stderr) || lastLines(audit.stdout) || `exit code ${audit.code}`;
      throw new Error(`bun audit failed: ${detail}`);
    }
    let report: BunAuditReport;
    try {
      report = parseBunAuditOutput(audit.stdout);
    } catch (error) {
      const detail =
        error instanceof Error && error.message !== "bun audit did not return json"
          ? error.message
          : lastLines(audit.stderr) || lastLines(audit.stdout) || `exit code ${audit.code}`;
      throw new Error(`bun audit failed: ${detail}`);
    }
    return {
      findings: toFindings(report, versions),
      resolved: [...versions].map(([name, version]) => `${name}@${version}`).sort(),
      engine: "bun audit"
    };
  }

  private lockVersions(cwd: string): Map<string, string> {
    const lock = join(cwd, "bun.lock");
    if (!existsSync(lock)) return new Map();
    try {
      return parseLockVersions(readFileSync(lock, "utf8"));
    } catch {
      return new Map();
    }
  }

  async audit(target: AuditTarget, ctx: EngineContext): Promise<EngineResult> {
    if (target.kind === "node-project") {
      return this.auditIn(target.cwd, ctx, this.lockVersions(target.cwd));
    }
    if (target.kind === "self") {
      const appDir = target.appDir;
      if (!existsSync(join(appDir, "bun.lock"))) {
        throw new Error("bun.lock is not shipped next to package.json, the gateway cannot audit itself");
      }
      try {
        return await this.auditIn(appDir, ctx, this.lockVersions(appDir));
      } catch (error) {
        if (!String(error).includes("EROFS")) throw error;
        return withTempDir(ctx.tmpRoot, (dir) => {
          for (const relative of SELF_MANIFESTS) {
            const source = join(appDir, relative);
            if (!existsSync(source)) continue;
            const destination = join(dir, relative);
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(source, destination);
          }
          return this.auditIn(dir, ctx, this.lockVersions(dir));
        });
      }
    }
    if (target.kind !== "npm") throw new Error(`unsupported target for bun audit: ${target.kind}`);
    const specs = target.specs;
    return withTempDir(ctx.tmpRoot, async (dir) => {
      writeFileSync(join(dir, "package.json"), manifestFor(specs));
      const install = await this.run(
        ["install", "--lockfile-only", "--ignore-scripts", "--no-progress", "--no-summary"],
        dir,
        ctx
      );
      if (install.code !== 0) {
        const detail = lastLines(install.stderr) || lastLines(install.stdout) || `exit code ${install.code}`;
        throw new Error(`bun install failed: ${detail}`);
      }
      return this.auditIn(dir, ctx, this.lockVersions(dir));
    });
  }
}
