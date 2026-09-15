import { Hono } from "hono";
import { SettingsPatch, type SettingsDto } from "@junctio/schema";
import type { Core } from "../core.ts";
import { getSetting, getSettings, setSetting } from "../db/settings.ts";
import { parseActionMap } from "../audit/policy.ts";
import { badRequest, readJson } from "./util.ts";

export function adminMcpEnabled(core: Core): boolean {
  return getSetting(core.db, "admin_mcp_enabled") === "true";
}

export function adminMcpUrl(core: Core): string {
  const base = core.config.baseUrl ?? `http://localhost:${core.config.port}`;
  return `${base}/mcp/_admin`;
}

export function createSettingsApi(core: Core): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const stored = getSettings(core.db);
    const settings: SettingsDto = {
      baseUrl: core.config.baseUrl ?? `http://localhost:${core.config.port}`,
      toolSeparator: stored.tool_separator,
      runtimePath: stored.runtime_path,
      apiKeyQueryParam: stored.api_key_query_param === "true",
      requestLogRetentionDays: Number(stored.request_log_retention_days),
      oauthIssuer: core.config.oauthIssuer,
      authorizationServer: core.config.oauthIssuer ? "external" : "builtin",
      adminMcp: stored.admin_mcp_enabled === "true",
      adminMcpUrl: adminMcpUrl(core),
      auditEnabled: stored.audit_enabled === "true",
      auditIntervalHours: Number(stored.audit_interval_hours),
      auditActions: parseActionMap(stored.audit_actions),
      version: core.config.version
    };
    return c.json(settings);
  });

  app.patch("/", async (c) => {
    const parsed = SettingsPatch.safeParse(await readJson(c));
    if (!parsed.success) return badRequest(c, parsed.error);
    const patch = parsed.data;
    if (patch.toolSeparator !== undefined) setSetting(core.db, "tool_separator", patch.toolSeparator);
    if (patch.runtimePath !== undefined) setSetting(core.db, "runtime_path", patch.runtimePath);
    if (patch.apiKeyQueryParam !== undefined) {
      setSetting(core.db, "api_key_query_param", patch.apiKeyQueryParam ? "true" : "false");
    }
    if (patch.requestLogRetentionDays !== undefined) {
      setSetting(core.db, "request_log_retention_days", String(patch.requestLogRetentionDays));
    }
    if (patch.adminMcp !== undefined) {
      setSetting(core.db, "admin_mcp_enabled", patch.adminMcp ? "true" : "false");
    }
    if (patch.auditEnabled !== undefined) {
      setSetting(core.db, "audit_enabled", patch.auditEnabled ? "true" : "false");
      if (!patch.auditEnabled) core.audit.cancelPending();
    }
    if (patch.auditIntervalHours !== undefined) {
      setSetting(core.db, "audit_interval_hours", String(patch.auditIntervalHours));
    }
    if (patch.auditActions !== undefined) {
      setSetting(core.db, "audit_actions", JSON.stringify(patch.auditActions));
      await core.audit.reevaluateAll();
    }
    core.registry.invalidate();
    return c.json({ ok: true });
  });

  return app;
}
