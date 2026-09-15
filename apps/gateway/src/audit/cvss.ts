const WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR: { U: { N: 0.85, L: 0.62, H: 0.27 }, C: { N: 0.85, L: 0.68, H: 0.5 } },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 }
} as const;

type Metrics = Record<string, string>;

function parse(vector: string): Metrics | null {
  const parts = vector.split("/");
  const head = parts.shift();
  if (head !== "CVSS:3.0" && head !== "CVSS:3.1") return null;
  const metrics: Metrics = {};
  for (const part of parts) {
    const [key, value] = part.split(":");
    if (!key || !value) return null;
    metrics[key] = value;
  }
  return metrics;
}

function roundUp(value: number): number {
  const scaled = Math.round(value * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10;
}

export function cvssBaseScore(vector: string): number | null {
  const metrics = parse(vector);
  if (!metrics) return null;
  const scope = metrics.S;
  if (scope !== "U" && scope !== "C") return null;

  const av = WEIGHTS.AV[metrics.AV as keyof typeof WEIGHTS.AV];
  const ac = WEIGHTS.AC[metrics.AC as keyof typeof WEIGHTS.AC];
  const pr = WEIGHTS.PR[scope][metrics.PR as keyof typeof WEIGHTS.PR.U];
  const ui = WEIGHTS.UI[metrics.UI as keyof typeof WEIGHTS.UI];
  const c = WEIGHTS.CIA[metrics.C as keyof typeof WEIGHTS.CIA];
  const i = WEIGHTS.CIA[metrics.I as keyof typeof WEIGHTS.CIA];
  const a = WEIGHTS.CIA[metrics.A as keyof typeof WEIGHTS.CIA];
  if ([av, ac, pr, ui, c, i, a].some((value) => value === undefined)) return null;

  const impactBase = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scope === "U" ? 6.42 * impactBase : 7.52 * (impactBase - 0.029) - 3.25 * (impactBase - 0.02) ** 15;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const score = scope === "U" ? Math.min(impact + exploitability, 10) : Math.min(1.08 * (impact + exploitability), 10);
  return roundUp(score);
}
