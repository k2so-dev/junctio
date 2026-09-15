<script setup lang="ts">
import type { AuditOverviewDto, AuditServerSummaryDto, Severity } from "@junctio/schema";
import { Loader2, RefreshCw } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { toast } from "vue-sonner";
import PageLayout from "@/components/layout/PageLayout.vue";
import StatCard from "@/components/layout/StatCard.vue";
import AuditPolicyCard from "@/components/security/AuditPolicyCard.vue";
import AuditBadge from "@/components/server/AuditBadge.vue";
import ServerAudit from "@/components/server/ServerAudit.vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { ACTION_LABEL, severityTone, TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, unknown: 3, low: 4 };

const { settings, refreshSettings } = useSession();

const overview = ref<AuditOverviewDto | null>(null);
const loading = ref(true);
const starting = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

async function load() {
  try {
    overview.value = await api.audit.overview();
  } catch {
    overview.value = null;
  } finally {
    loading.value = false;
  }
}

async function runAll() {
  starting.value = true;
  try {
    await api.audit.run();
    toast.success("Audit started");
    setTimeout(load, 1500);
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    starting.value = false;
  }
}

const enabled = computed(() => settings.value?.auditEnabled ?? false);
const running = computed(() => overview.value?.running ?? false);

const rows = computed(() => {
  const servers = [...(overview.value?.servers ?? [])];
  return servers.sort((a, b) => {
    if (a.quarantined !== b.quarantined) return a.quarantined ? -1 : 1;
    const rank = (server: AuditServerSummaryDto) => (server.status === "vulnerable" ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const worst = (server: AuditServerSummaryDto) => (server.worst ? SEVERITY_ORDER[server.worst] : 9);
    if (worst(a) !== worst(b)) return worst(a) - worst(b);
    return a.serverName.localeCompare(b.serverName);
  });
});

const vulnerableCount = computed(() => rows.value.filter((row) => row.status === "vulnerable").length);
const quarantinedCount = computed(() => rows.value.filter((row) => row.quarantined).length);

const lastRunFooter = computed(() => {
  const run = overview.value?.lastRun;
  if (!run) return "No audit has run yet";
  return `${run.ok} clean · ${run.vulnerable} with advisories · ${run.errors} failed · ${run.unsupported} not audited`;
});

const lastRunValue = computed(() => {
  const run = overview.value?.lastRun;
  if (!run) return "Never";
  return relativeTime(run.finishedAt ?? run.startedAt);
});

function counts(row: AuditServerSummaryDto): string {
  const parts = [
    row.counts.critical > 0 ? `${row.counts.critical} crit` : null,
    row.counts.high > 0 ? `${row.counts.high} high` : null,
    row.counts.moderate > 0 ? `${row.counts.moderate} mod` : null,
    row.counts.low > 0 ? `${row.counts.low} low` : null,
    row.counts.unknown > 0 ? `${row.counts.unknown} unknown` : null
  ].filter((part) => part !== null);
  return parts.length === 0 ? "—" : parts.join(" · ");
}

onMounted(async () => {
  await refreshSettings();
  await load();
  timer = setInterval(() => {
    tick += 1;
    if (running.value || tick % 6 === 0) void load();
  }, 5000);
});

onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});
</script>

<template>
  <PageLayout title="Security">
    <template #actions>
      <Button variant="outline" size="sm" :disabled="!enabled || starting || running" @click="runAll">
        <Loader2 v-if="starting || running" class="animate-spin" />
        <RefreshCw v-else />
        Audit all servers
      </Button>
    </template>

    <div class="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <StatCard
        label="Audit"
        :value="enabled ? 'On' : 'Off'"
        :badge="enabled ? `every ${settings?.auditIntervalHours ?? 24}h` : 'disabled'"
        :badge-tone="enabled ? 'muted' : 'warning'"
        :footer="enabled ? 'npm advisories and OSV.dev' : 'Turn it on in the policy below'"
      />
      <StatCard label="Last run" :value="lastRunValue" :loading="loading" :footer="lastRunFooter" />
      <StatCard
        label="Next run"
        :value="running ? 'Running' : relativeTime(overview?.nextRunAt)"
        :loading="loading"
        :footer="
          running && overview?.current
            ? `${overview.current.done}/${overview.current.total} servers audited`
            : 'Scheduled by the interval below'
        "
      />
      <StatCard
        label="Findings"
        :value="vulnerableCount"
        :loading="loading"
        :badge="quarantinedCount > 0 ? `${quarantinedCount} quarantined` : 'none quarantined'"
        :badge-tone="quarantinedCount > 0 ? 'destructive' : 'muted'"
        footer="Servers with active advisories"
      />
    </div>

    <Card class="gap-0 overflow-hidden py-0">
      <CardHeader class="gap-1 border-b py-3 [.border-b]:pb-3">
        <CardTitle class="text-sm font-medium">Servers</CardTitle>
        <CardDescription class="text-xs">Every upstream server the gateway could resolve packages for.</CardDescription>
      </CardHeader>
      <CardContent class="px-0">
        <p v-if="rows.length === 0" class="px-4 py-8 text-center text-muted-foreground">
          No server has been audited yet.
        </p>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead class="min-w-44">Server</TableHead>
              <TableHead class="w-44">Status</TableHead>
              <TableHead class="w-24">Worst</TableHead>
              <TableHead class="min-w-40">Findings</TableHead>
              <TableHead class="w-44">Action</TableHead>
              <TableHead class="w-32">Checked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in rows" :key="row.serverId">
              <TableCell class="max-w-[260px]">
                <RouterLink
                  :to="{ name: 'server', params: { id: row.serverId }, query: { tab: 'audit' } }"
                  class="truncate font-medium hover:underline"
                >
                  {{ row.serverName }}
                </RouterLink>
                <div class="font-mono text-[11px] text-muted-foreground">{{ row.ecosystem ?? "—" }}</div>
              </TableCell>
              <TableCell>
                <AuditBadge :summary="row" :quarantined="row.quarantined" />
              </TableCell>
              <TableCell :class="cn('capitalize', row.worst ? TONE_TEXT[severityTone(row.worst)] : 'text-muted-foreground')">
                {{ row.worst ?? "—" }}
              </TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground">{{ counts(row) }}</TableCell>
              <TableCell class="text-xs text-muted-foreground">
                {{ row.action ? ACTION_LABEL[row.action] : "—" }}
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">{{ relativeTime(row.checkedAt) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Card class="gap-0 overflow-hidden py-0">
      <CardHeader class="gap-1 border-b py-3 [.border-b]:pb-3">
        <CardTitle class="text-sm font-medium">The gateway itself</CardTitle>
        <CardDescription class="text-xs">The packages this gateway runs on.</CardDescription>
      </CardHeader>
      <CardContent class="py-4">
        <ServerAudit target="self" :enabled="enabled" @changed="load" />
      </CardContent>
    </Card>

    <AuditPolicyCard @saved="load" />
  </PageLayout>
</template>
