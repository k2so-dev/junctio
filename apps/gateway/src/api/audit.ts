import { Hono } from "hono";
import type { AuditOverviewDto, AuditReportDto } from "@junctio/schema";
import type { Core } from "../core.ts";
import { SELF_ID } from "../audit/types.ts";
import { badRequest, notFound } from "./util.ts";

export function createAuditApi(core: Core): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const overview: AuditOverviewDto = core.audit.overview();
    return c.json(overview);
  });

  app.post("/run", (c) => {
    if (!core.audit.isEnabled()) return badRequest(c, "the security audit is disabled in settings");
    void core.audit.runAll("manual").catch(() => undefined);
    return c.json({ started: true, current: core.audit.current() }, 202);
  });

  app.get("/self", (c) => {
    const report = core.audit.report(SELF_ID);
    if (!report) return notFound(c, "audit report");
    return c.json(report satisfies AuditReportDto);
  });

  app.post("/self/run", async (c) => {
    if (!core.audit.isEnabled()) return badRequest(c, "the security audit is disabled in settings");
    await core.audit.runServer(SELF_ID, "manual");
    const report = core.audit.report(SELF_ID);
    if (!report) return notFound(c, "audit report");
    return c.json(report);
  });

  return app;
}
