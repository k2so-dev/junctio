import type { AuditService } from "../audit/service.ts";
import type { ServerRegistry } from "./registry.ts";
import { UpstreamError, type ResolvedServer } from "./types.ts";

export type LaunchGate = {
  assert(serverId: string): Promise<ResolvedServer>;
  check(serverId: string): Promise<UpstreamError | null>;
};

export function createLaunchGate(registry: ServerRegistry, audit: () => AuditService): LaunchGate {
  async function assert(serverId: string): Promise<ResolvedServer> {
    const resolved = await registry.resolve(serverId);
    if (!resolved) throw new UpstreamError("server not found", "not_found", serverId);
    const { row } = resolved;
    if (!row.enabled) {
      const detail = row.disabledReason ? `: ${row.disabledReason}` : "";
      throw new UpstreamError(`server is disabled${detail}`, "disabled", serverId);
    }
    if (row.quarantinedAt !== null) {
      const detail = row.quarantineReason ?? "a vulnerable package was found";
      throw new UpstreamError(`server is quarantined by the security audit: ${detail}`, "quarantined", serverId);
    }

    const service = audit();
    if (service.isEnabled() && service.isAuditable(row)) {
      const result = service.store.get(serverId);
      if (result === null || result.status === "unsupported") {
        service.enqueue(serverId, "startup");
        throw new UpstreamError(
          "the security audit has not checked this server yet, it starts once the audit passes",
          "audit_pending",
          serverId
        );
      }
      if (result.status === "error") {
        service.enqueue(serverId, "startup");
        throw new UpstreamError(
          `the last security audit failed: ${result.error ?? "unknown error"}`,
          "audit_error",
          serverId
        );
      }
    }
    return resolved;
  }

  return {
    assert,
    async check(serverId) {
      try {
        await assert(serverId);
        return null;
      } catch (error) {
        if (error instanceof UpstreamError) return error;
        throw error;
      }
    }
  };
}
