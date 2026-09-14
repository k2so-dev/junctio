export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = LEVELS.info;

export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS[level];
}

const MASK_PATTERNS: RegExp[] = [
  /\b(bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\bjn_[A-Za-z0-9]{6,}/g,
  /\b(sk|pat|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|xoxa)[-_][A-Za-z0-9._-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
];

const SENSITIVE_KEYS =
  /^(authorization|cookie|set-cookie|password|secret|token|access_token|refresh_token|client_secret|api_key|apikey|x-api-key)$/i;

export function maskString(value: string): string {
  let out = value;
  for (const re of MASK_PATTERNS) {
    out = out.replace(re, (_match, ...rest: unknown[]) => {
      const prefix = typeof rest[0] === "string" ? rest[0] : "";
      return `${prefix}***`;
    });
  }
  return out;
}

function maskValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map((v) => maskValue(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: maskString(value.message) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "***" : maskValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export type Fields = Record<string, unknown>;

export type Logger = {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
};

function emit(level: LogLevel, base: Fields, msg: string, fields?: Fields): void {
  if (LEVELS[level] < threshold) return;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: maskString(msg),
    ...(maskValue({ ...base, ...fields }) as Fields)
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export function createLogger(base: Fields = {}): Logger {
  return {
    debug: (msg, fields) => emit("debug", base, msg, fields),
    info: (msg, fields) => emit("info", base, msg, fields),
    warn: (msg, fields) => emit("warn", base, msg, fields),
    error: (msg, fields) => emit("error", base, msg, fields),
    child: (fields) => createLogger({ ...base, ...fields })
  };
}

export const log = createLogger();
