import { SourceCatalog, type SourceDto } from "@junctio/schema";
import catalog from "../src/data/sources.json" with { type: "json" };

const AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20000;

type Verdict = "alive" | "moved" | "unverified" | "dead";

type Result = {
  source: SourceDto;
  verdict: Verdict;
  detail: string;
};

async function check(source: SourceDto): Promise<Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(source.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": AGENT, accept: "text/html,*/*" }
    });
    const status = response.status;
    if (status === 403 || status === 429) {
      return { source, verdict: "unverified", detail: `${status}, bot protection` };
    }
    if (status === 404 || status === 410 || status >= 500) {
      return { source, verdict: "dead", detail: `${status}` };
    }
    if (!response.ok) {
      return { source, verdict: "unverified", detail: `${status}` };
    }
    const landed = new URL(response.url);
    const asked = new URL(source.url);
    if (landed.hostname.replace(/^www\./, "") !== asked.hostname.replace(/^www\./, "")) {
      return { source, verdict: "moved", detail: `now ${landed.origin}${landed.pathname}` };
    }
    return { source, verdict: "alive", detail: `${status}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { source, verdict: "dead", detail: reason.includes("abort") ? "timed out" : reason };
  } finally {
    clearTimeout(timer);
  }
}

function table(title: string, results: Result[]): string {
  if (results.length === 0) return "";
  const rows = results.map((result) => `| ${result.source.name} | ${result.source.url} | ${result.detail} |`);
  return [`### ${title}`, "", "| Source | URL | Result |", "| --- | --- | --- |", ...rows, ""].join("\n");
}

const sources = SourceCatalog.parse(catalog).sources;
const results: Result[] = [];
for (const source of sources) {
  results.push(await check(source));
}

const dead = results.filter((result) => result.verdict === "dead");
const moved = results.filter((result) => result.verdict === "moved");
const unverified = results.filter((result) => result.verdict === "unverified");
const alive = results.filter((result) => result.verdict === "alive");

const report = [
  `Checked ${results.length} sources on ${new Date().toISOString().slice(0, 10)}.`,
  "",
  `${alive.length} alive, ${moved.length} moved, ${unverified.length} unverified, ${dead.length} dead.`,
  "",
  table("Dead", dead),
  table("Moved", moved),
  table("Unverified", unverified)
]
  .filter((part) => part !== "")
  .join("\n");

console.log(report);

if (dead.length > 0) process.exit(1);
