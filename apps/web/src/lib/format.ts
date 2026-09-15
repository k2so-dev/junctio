const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 1000],
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
  ["month", 2_592_000_000],
  ["year", 31_536_000_000]
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeOnly = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function relativeTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "never";
  const delta = ts - Date.now();
  const magnitude = Math.abs(delta);
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let divisor = 1000;
  for (const [candidate, size] of UNITS) {
    if (magnitude >= size) {
      unit = candidate;
      divisor = size;
    }
  }
  return relative.format(Math.round(delta / divisor), unit);
}

export function shortDate(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "—";
  return dateOnly.format(new Date(ts));
}

export function clockTime(ts: number): string {
  return timeOnly.format(new Date(ts));
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function countdown(ms: number): string {
  if (ms <= 0) return "expired";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s` : `${minutes}m ${pad(seconds)}s`;
}

export function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function durationTone(ms: number): string {
  if (ms >= 5000) return "text-destructive";
  if (ms >= 2000) return "text-warning";
  return "text-muted-foreground";
}
