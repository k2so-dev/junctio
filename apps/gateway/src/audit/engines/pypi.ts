import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Severity } from "@junctio/schema";
import type { AuditEngine, AuditFinding, AuditTarget, EngineContext, EngineResult, TargetKind } from "../types.ts";
import { normalizePypiName } from "../spec.ts";
import { withTempDir } from "../tmp.ts";

export const OSV_BASE_URL = "https://api.osv.dev";
const BATCH_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const DETAIL_TTL_MS = 86_400_000;
const DETAIL_CONCURRENCY = 4;

export type OsvVuln = {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: { type?: string; score?: string }[];
  database_specific?: { severity?: string };
};

export function parseCompiledRequirements(stdout: string): { name: string; version: string }[] {
  const out: { name: string; version: string }[] = [];
  const seen = new Set<string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.split("#")[0]!.trim();
    if (line === "" || line.startsWith("-")) continue;
    const match = /^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*==\s*([^\s;]+)/.exec(line);
    if (!match) continue;
    const name = normalizePypiName(match[1]!);
    const version = match[2]!;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, version });
  }
  return out;
}

export function toSeverity(value: string | undefined): Severity {
  const lowered = (value ?? "").toLowerCase();
  if (lowered === "medium") return "moderate";
  if (lowered === "critical" || lowered === "high" || lowered === "moderate" || lowered === "low") return lowered;
  return "unknown";
}

export function cvssScore(vuln: OsvVuln): number | null {
  for (const entry of vuln.severity ?? []) {
    if (!entry.score) continue;
    const parsed = Number.parseFloat(entry.score);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export function severityFromCvss(score: number | null): Severity {
  if (score === null) return "unknown";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "moderate";
  return "low";
}

export function severityFromOsv(vuln: OsvVuln, ghsa: OsvVuln | null): Severity {
  const own = toSeverity(vuln.database_specific?.severity);
  if (own !== "unknown") return own;
  const aliased = toSeverity(ghsa?.database_specific?.severity);
  if (aliased !== "unknown") return aliased;
  return severityFromCvss(cvssScore(vuln) ?? cvssScore(ghsa ?? { id: "" }));
}

export function canonicalId(vuln: OsvVuln): { id: string; aliases: string[] } {
  const aliases = (vuln.aliases ?? []).map((alias) => alias.toUpperCase());
  const ghsa = aliases.find((alias) => alias.startsWith("GHSA-"));
  const id = vuln.id.toUpperCase();
  if (ghsa && !id.startsWith("GHSA-")) {
    return { id: ghsa, aliases: [id, ...aliases.filter((alias) => alias !== ghsa)] };
  }
  return { id, aliases: aliases.filter((alias) => alias !== id) };
}

function title(vuln: OsvVuln): string {
  const summary = vuln.summary?.trim();
  if (summary) return summary;
  const details = vuln.details?.trim().split("\n")[0]?.trim();
  return details && details !== "" ? details : "advisory published in the osv database";
}

type Batched = { vulns?: { id: string }[] };

export type OsvPypiOptions = {
  uvPath: () => string | null;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  pythonVersion?: string;
};

export class OsvPypiEngine implements AuditEngine {
  readonly kinds: readonly TargetKind[] = ["pypi"];
  private readonly details = new Map<string, { at: number; value: Promise<OsvVuln | null> }>();

  constructor(private readonly options: OsvPypiOptions) {}

  private get baseUrl(): string {
    return this.options.baseUrl ?? OSV_BASE_URL;
  }

  private request(ctx: EngineContext, path: string, init?: RequestInit): Promise<Response> {
    const impl = this.options.fetchImpl ?? ctx.fetchImpl;
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    return impl(`${this.baseUrl}${path}`, { ...init, signal });
  }

  private detail(ctx: EngineContext, id: string): Promise<OsvVuln | null> {
    const cached = this.details.get(id);
    if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.value;
    const value = this.request(ctx, `/v1/vulns/${encodeURIComponent(id)}`)
      .then(async (response) => (response.ok ? ((await response.json()) as OsvVuln) : null))
      .catch(() => null);
    this.details.set(id, { at: Date.now(), value });
    return value;
  }

  private async resolve(target: Extract<AuditTarget, { kind: "pypi" }>, ctx: EngineContext): Promise<{ name: string; version: string }[]> {
    const uv = this.options.uvPath();
    if (!uv) throw new Error("uv is not on the runtime path, python packages cannot be resolved");
    return withTempDir(ctx.tmpRoot, async (dir) => {
      const file = join(dir, "requirements.in");
      writeFileSync(file, `${target.requirements.join("\n")}\n`);
      const proc = Bun.spawn(
        [
          uv,
          "pip",
          "compile",
          file,
          "--universal",
          "--python-version",
          this.options.pythonVersion ?? "3.12",
          "--no-header",
          "--no-annotate",
          "--no-progress",
          "--color",
          "never",
          "-o",
          "-"
        ],
        { cwd: dir, env: ctx.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", signal: ctx.signal }
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
      ]);
      if (code !== 0) {
        const detail = stderr
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .slice(-2)
          .join("; ");
        throw new Error(`uv pip compile failed: ${detail || `exit code ${code}`}`);
      }
      return parseCompiledRequirements(stdout);
    });
  }

  private async query(ctx: EngineContext, packages: { name: string; version: string }[]): Promise<Map<number, string[]>> {
    const hits = new Map<number, string[]>();
    for (let offset = 0; offset < packages.length; offset += BATCH_SIZE) {
      const chunk = packages.slice(offset, offset + BATCH_SIZE);
      const response = await this.request(ctx, "/v1/querybatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queries: chunk.map((item) => ({ package: { name: item.name, ecosystem: "PyPI" }, version: item.version }))
        })
      });
      if (!response.ok) throw new Error(`osv.dev returned ${response.status}`);
      const body = (await response.json()) as { results?: Batched[] };
      const results = body.results ?? [];
      for (let index = 0; index < results.length; index += 1) {
        const ids = (results[index]?.vulns ?? []).map((vuln) => vuln.id);
        if (ids.length > 0) hits.set(offset + index, ids);
      }
    }
    return hits;
  }

  private async fetchDetails(ctx: EngineContext, ids: string[]): Promise<Map<string, OsvVuln>> {
    const out = new Map<string, OsvVuln>();
    const queue = [...ids];
    const workers = Array.from({ length: Math.min(DETAIL_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;
        const vuln = await this.detail(ctx, id);
        if (vuln) out.set(id, vuln);
      }
    });
    await Promise.all(workers);
    return out;
  }

  async audit(target: AuditTarget, ctx: EngineContext): Promise<EngineResult> {
    if (target.kind !== "pypi") throw new Error(`unsupported target for osv: ${target.kind}`);
    const packages = await this.resolve(target, ctx);
    const resolved = packages.map((item) => `${item.name}@${item.version}`).sort();
    if (packages.length === 0) return { findings: [], resolved, engine: "uv + osv.dev" };

    const hits = await this.query(ctx, packages);
    const ids = [...new Set([...hits.values()].flat())];
    if (ids.length === 0) return { findings: [], resolved, engine: "uv + osv.dev" };

    const details = await this.fetchDetails(ctx, ids);
    const aliasIds = new Set<string>();
    for (const vuln of details.values()) {
      for (const alias of vuln.aliases ?? []) {
        if (alias.toUpperCase().startsWith("GHSA-") && !details.has(alias)) aliasIds.add(alias);
      }
    }
    const aliasDetails = await this.fetchDetails(ctx, [...aliasIds]);

    const findings = new Map<string, AuditFinding>();
    for (const [index, vulnIds] of hits) {
      const pkg = packages[index];
      if (!pkg) continue;
      for (const vulnId of vulnIds) {
        const vuln = details.get(vulnId);
        if (!vuln) continue;
        const ghsa = (vuln.aliases ?? []).map((alias) => aliasDetails.get(alias)).find((item) => item !== undefined);
        const { id, aliases } = canonicalId(vuln);
        const key = `${pkg.name}@${pkg.version}:${id}`;
        if (findings.has(key)) continue;
        findings.set(key, {
          id,
          aliases,
          package: pkg.name,
          version: pkg.version,
          vulnerableRange: null,
          title: title(vuln),
          severity: severityFromOsv(vuln, ghsa ?? null),
          cvss: cvssScore(vuln) ?? cvssScore(ghsa ?? { id: "" }),
          url: `https://osv.dev/vulnerability/${vuln.id}`
        });
      }
    }
    return { findings: [...findings.values()], resolved, engine: "uv + osv.dev" };
  }
}
