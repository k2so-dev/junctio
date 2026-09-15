import { z } from "zod";

const KNOWN_KEYS = [
  "JUNCTIO_SECRET",
  "JUNCTIO_BASE_URL",
  "JUNCTIO_ADMIN_TOKEN",
  "JUNCTIO_OAUTH_ISSUER",
  "JUNCTIO_OAUTH_AUDIENCE",
  "JUNCTIO_DATA_DIR",
  "JUNCTIO_DOCKER_SOCKET",
  "JUNCTIO_TRUST_PROXY",
  "PORT",
  "HOST",
  "LOG_LEVEL"
] as const;

const EnvSchema = z.object({
  JUNCTIO_SECRET: z.string().min(16, "JUNCTIO_SECRET must be at least 16 characters"),
  JUNCTIO_BASE_URL: z.string().url().optional(),
  JUNCTIO_ADMIN_TOKEN: z.string().min(16).optional(),
  JUNCTIO_OAUTH_ISSUER: z.string().url().optional(),
  JUNCTIO_OAUTH_AUDIENCE: z.string().optional(),
  JUNCTIO_DATA_DIR: z.string().default("/data"),
  JUNCTIO_DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
  JUNCTIO_TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

function present(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of KNOWN_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

export type Config = {
  secret: string;
  baseUrl: string | null;
  adminToken: string | null;
  oauthIssuer: string | null;
  oauthAudience: string | null;
  dataDir: string;
  dockerSocket: string;
  trustProxy: boolean;
  port: number;
  host: string;
  logLevel: "debug" | "info" | "warn" | "error";
  version: string;
};

export const VERSION = "0.1.0";

export function loadConfig(env: Record<string, string | undefined> = Bun.env): Config {
  const parsed = EnvSchema.safeParse(present(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const baseUrl = e.JUNCTIO_BASE_URL ? e.JUNCTIO_BASE_URL.replace(/\/+$/, "") : null;
  return {
    secret: e.JUNCTIO_SECRET,
    baseUrl,
    adminToken: e.JUNCTIO_ADMIN_TOKEN ?? null,
    oauthIssuer: e.JUNCTIO_OAUTH_ISSUER ?? null,
    oauthAudience: e.JUNCTIO_OAUTH_AUDIENCE ?? null,
    dataDir: e.JUNCTIO_DATA_DIR,
    dockerSocket: e.JUNCTIO_DOCKER_SOCKET,
    trustProxy: e.JUNCTIO_TRUST_PROXY === "true",
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    version: VERSION
  };
}

export function requireBaseUrl(config: Config, reason: string): string {
  if (!config.baseUrl) {
    throw new Error(`JUNCTIO_BASE_URL is required for ${reason}`);
  }
  return config.baseUrl;
}
