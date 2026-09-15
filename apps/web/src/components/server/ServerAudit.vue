<script setup lang="ts">
import type { AuditFindingDto, AuditReportDto } from "@junctio/schema";
import { EyeOff, Eye, Loader2, RefreshCw } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { toast } from "vue-sonner";
import AuditBadge from "@/components/server/AuditBadge.vue";
import EmptyState from "@/components/EmptyState.vue";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { severityTone, TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

const props = defineProps<{ target: string; enabled: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const report = ref<AuditReportDto | null>(null);
const busy = ref(false);
const running = ref(false);

const isSelf = computed(() => props.target === "self");

const summary = computed(() =>
  report.value
    ? {
        status: report.value.status,
        ecosystem: report.value.ecosystem,
        counts: report.value.counts,
        activeCount: report.value.activeCount,
        ignoredCount: report.value.ignoredCount,
        worst: report.value.worst,
        action: report.value.action,
        checkedAt: report.value.checkedAt,
        error: report.value.error,
        reason: report.value.reason
      }
    : null
);

const resolved = computed(() => report.value?.resolved ?? []);

function sentence(value: string): string {
  return value === "" ? value : value[0]!.toUpperCase() + value.slice(1);
}

const sorted = computed(() => {
  const order = { critical: 0, high: 1, moderate: 2, unknown: 3, low: 4 };
  return [...(report.value?.findings ?? [])].sort((a, b) => order[a.severity] - order[b.severity]);
});

async function load() {
  busy.value = true;
  try {
    report.value = isSelf.value ? await api.audit.self() : await api.servers.audit(props.target);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 404) toast.error(error.message);
  } finally {
    busy.value = false;
  }
}

async function run() {
  running.value = true;
  try {
    report.value = isSelf.value ? await api.audit.runSelf() : await api.servers.runAudit(props.target);
    emit("changed");
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    running.value = false;
  }
}

async function toggleIgnore(finding: AuditFindingDto) {
  try {
    if (finding.ignored) {
      await api.servers.unignoreAdvisory(props.target, finding.id);
      await load();
    } else {
      report.value = await api.servers.ignoreAdvisory(props.target, finding.id, { reason: null });
    }
    emit("changed");
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

watch(() => props.target, load);
onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-col gap-0.5">
        <AuditBadge :summary="summary" :quarantined="report?.quarantined ?? false" />
        <span class="text-xs text-muted-foreground">
          <template v-if="report?.checkedAt">Checked {{ relativeTime(report.checkedAt) }}</template>
          <template v-else>Not audited yet</template>
          <template v-if="report?.engine"> · {{ report.engine }}</template>
        </span>
      </div>
      <Button variant="outline" size="sm" :disabled="!props.enabled || running" @click="run">
        <Loader2 v-if="running" class="animate-spin" />
        <RefreshCw v-else />
        Run audit now
      </Button>
    </div>

    <p v-if="!props.enabled" class="text-xs text-muted-foreground">
      The security audit is switched off. Turn it on in Settings to check these packages.
    </p>

    <p v-if="report?.error" class="text-xs text-warning">{{ report.error }}</p>

    <div v-if="resolved.length && resolved.length <= 6" class="text-xs text-muted-foreground">
      Audited <span class="font-mono">{{ resolved.join(", ") }}</span>
    </div>
    <details v-else-if="resolved.length" class="text-xs text-muted-foreground">
      <summary class="cursor-pointer select-none">Audited {{ resolved.length }} packages</summary>
      <div class="mt-1.5 max-h-48 overflow-auto rounded border bg-muted/30 p-2 font-mono break-all">
        {{ resolved.join(", ") }}
      </div>
    </details>

    <Table v-if="sorted.length">
      <TableHeader>
        <TableRow>
          <TableHead class="w-24">Severity</TableHead>
          <TableHead>Advisory</TableHead>
          <TableHead class="w-48">Package</TableHead>
          <TableHead v-if="!isSelf" class="w-24 text-right">Ignore</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="finding in sorted" :key="`${finding.package}:${finding.id}`" :class="finding.ignored && 'opacity-50'">
          <TableCell :class="cn('font-medium', TONE_TEXT[severityTone(finding.severity)])">
            {{ finding.severity }}
          </TableCell>
          <TableCell>
            <a v-if="finding.url" :href="finding.url" target="_blank" rel="noreferrer" class="font-mono text-xs underline">
              {{ finding.id }}
            </a>
            <span v-else class="font-mono text-xs">{{ finding.id }}</span>
            <div class="text-xs text-muted-foreground">{{ finding.title }}</div>
          </TableCell>
          <TableCell class="font-mono text-xs">
            {{ finding.package }}<template v-if="finding.version">@{{ finding.version }}</template>
            <div v-if="finding.vulnerableRange" class="text-muted-foreground">affects {{ finding.vulnerableRange }}</div>
          </TableCell>
          <TableCell v-if="!isSelf" class="text-right">
            <Button variant="ghost" size="sm" @click="toggleIgnore(finding)">
              <Eye v-if="finding.ignored" />
              <EyeOff v-else />
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <EmptyState
      v-else-if="report && report.status === 'ok'"
      title="No known advisories"
      description="Every package this server runs is clean in the public vulnerability databases."
    />
    <EmptyState
      v-else-if="report && report.status === 'unsupported'"
      title="Not audited"
      :description="report.reason ? sentence(report.reason) : 'The gateway cannot tell which packages this server runs.'"
    />
  </div>
</template>
