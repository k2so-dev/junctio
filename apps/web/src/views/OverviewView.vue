<script setup lang="ts">
import type { ApiKeyDto, EndpointDto, RequestLogDto, ServerDto } from "@junctio/schema";
import { Plus } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import PageLayout from "@/components/layout/PageLayout.vue";
import StatCard from "@/components/layout/StatCard.vue";
import AuditBadge from "@/components/server/AuditBadge.vue";
import StatusDot from "@/components/StatusDot.vue";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { clockTime, duration, durationTone, relativeTime } from "@/lib/format";
import { needsAttention, statusMeta, type Tone } from "@/lib/status";
import { useSession } from "@/stores/session";
import { usePolling } from "@/composables/usePolling";
import { useServerActions } from "@/composables/useServerActions";

const router = useRouter();
const { health } = useSession();

const servers = ref<ServerDto[]>([]);
const endpoints = ref<EndpointDto[]>([]);
const keys = ref<ApiKeyDto[]>([]);
const requests = ref<RequestLogDto[]>([]);
const loading = ref(true);
const pending = ref<string | null>(null);

async function load() {
  const [serverList, endpointList, keyList, logList] = await Promise.allSettled([
    api.servers.list(),
    api.endpoints.list(),
    api.apiKeys.list(),
    api.requestLog({ limit: 20 })
  ]);
  if (serverList.status === "fulfilled") servers.value = serverList.value;
  if (endpointList.status === "fulfilled") endpoints.value = endpointList.value;
  if (keyList.status === "fulfilled") keys.value = keyList.value;
  if (logList.status === "fulfilled") requests.value = logList.value;
  loading.value = false;
}

const attention = computed(() => servers.value.filter(needsAttention));

const serverStats = computed(() => {
  const current = health.value;
  if (!current) return null;
  return current.servers;
});

const namespaceCount = computed(() => new Set(endpoints.value.map((endpoint) => endpoint.namespaceName)).size);

const boundKeys = computed(() => endpoints.value.reduce((total, endpoint) => total + endpoint.keyCount, 0));

const expiringKeys = computed(() => {
  const horizon = Date.now() + 7 * 86_400_000;
  return keys.value.filter((key) => key.expiresAt !== null && key.expiresAt <= horizon).length;
});

const neverExpiring = computed(() => keys.value.filter((key) => key.expiresAt === null).length);

const auditEnabled = computed(() => health.value?.audit.enabled ?? false);

const securityBadge = computed<{ text: string; tone: Tone }>(() => {
  const audit = health.value?.audit;
  if (!auditEnabled.value || !audit) return { text: "audit disabled", tone: "muted" };
  if (audit.quarantined > 0) return { text: `${audit.quarantined} quarantined`, tone: "destructive" };
  if (audit.vulnerable > 0) return { text: "needs review", tone: "warning" };
  return { text: "clean", tone: "success" };
});

async function act(server: ServerDto, action: "start" | "reset") {
  pending.value = server.id;
  try {
    await api.servers[action](server.id);
    toast.success(`${server.name}: ${action} done`);
    await load();
  } catch (error) {
    if (error instanceof ApiError) toast.error(`${server.name}: ${error.message}`);
  } finally {
    pending.value = null;
  }
}

const { reauth } = useServerActions(load);

usePolling(load, 10_000);
</script>

<template>
  <PageLayout title="Overview">
    <template #actions>
      <Button size="sm" @click="router.push({ name: 'server-new' })">
        <Plus />
        Add server
      </Button>
    </template>

    <div class="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <StatCard
        label="Servers"
        :value="serverStats ? `${serverStats.running}/${serverStats.total}` : null"
        :loading="!serverStats"
        :badge="serverStats && serverStats.failed > 0 ? `${serverStats.failed} failed` : 'healthy'"
        :badge-tone="serverStats && serverStats.failed > 0 ? 'destructive' : 'success'"
        :footer="
          serverStats && (serverStats.needsReauth > 0 || serverStats.quarantined > 0)
            ? `${serverStats.needsReauth} need re-auth · ${serverStats.quarantined} quarantined`
            : 'Processes start lazily on first request'
        "
        :to="{ name: 'servers' }"
        link-label="All servers"
      />
      <StatCard
        label="Endpoints"
        :value="endpoints.length"
        :loading="loading"
        :badge="`${namespaceCount} namespaces`"
        :footer="`${boundKeys} keys bound to an endpoint`"
        :to="{ name: 'endpoints' }"
        link-label="Manage endpoints"
      />
      <StatCard
        label="API keys"
        :value="keys.length"
        :loading="loading"
        :badge="expiringKeys > 0 ? `${expiringKeys} expiring soon` : 'none expiring'"
        :badge-tone="expiringKeys > 0 ? 'warning' : 'muted'"
        :footer="`${neverExpiring} never expire`"
        :to="{ name: 'api-keys' }"
        link-label="Manage keys"
      />
      <StatCard
        label="Security"
        :value="auditEnabled ? (health?.audit.vulnerable ?? 0) : 'Off'"
        :loading="!health"
        :badge="securityBadge.text"
        :badge-tone="securityBadge.tone"
        :footer="
          auditEnabled
            ? `Last run ${relativeTime(health?.audit.lastRunAt)}`
            : 'Enable it on the Security page'
        "
        :to="{ name: 'security' }"
        link-label="Security"
      />
    </div>

    <Card v-if="!loading && servers.length === 0" class="items-center gap-2 py-10 text-center">
      <CardTitle class="text-base">No servers yet</CardTitle>
      <CardDescription class="max-w-md">
        Add an npm or PyPI package as a stdio server, or point the gateway at a remote Streamable HTTP or SSE server.
      </CardDescription>
      <div class="mt-2 flex gap-2">
        <Button size="sm" @click="router.push({ name: 'server-new' })">
          <Plus />
          Add server
        </Button>
        <Button size="sm" variant="outline" @click="router.push({ name: 'explore' })">Explore the registry</Button>
      </div>
    </Card>

    <Card v-else-if="attention.length > 0" class="gap-0 overflow-hidden py-0">
      <CardHeader class="gap-1 border-b py-3 [.border-b]:pb-3">
        <CardTitle class="text-sm font-medium">Needs attention</CardTitle>
        <CardDescription class="text-xs">Servers that stopped, lost their credentials or got quarantined.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" as-child>
            <RouterLink :to="{ name: 'servers' }">All servers</RouterLink>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent class="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="min-w-44">Server</TableHead>
              <TableHead class="w-36">Status</TableHead>
              <TableHead class="min-w-52">Detail</TableHead>
              <TableHead class="w-32 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="server in attention" :key="server.id">
              <TableCell class="max-w-[260px]">
                <RouterLink
                  :to="{ name: 'server', params: { id: server.id } }"
                  class="truncate font-medium hover:underline"
                >
                  {{ server.name }}
                </RouterLink>
              </TableCell>
              <TableCell>
                <div class="flex flex-col items-start gap-1">
                  <StatusDot :status="server.status" />
                  <AuditBadge
                    v-if="server.quarantinedAt !== null"
                    :summary="server.audit"
                    quarantined
                    compact
                  />
                </div>
              </TableCell>
              <TableCell class="max-w-0">
                <div class="truncate text-xs text-muted-foreground">
                  {{ server.quarantineReason ?? server.lastError ?? statusMeta(server.status).label }}
                </div>
              </TableCell>
              <TableCell class="text-right">
                <Button
                  v-if="server.oauth?.status === 'needs_reauth'"
                  size="sm"
                  variant="outline"
                  class="h-7 border-warning/50 text-warning hover:text-warning"
                  @click="reauth(server)"
                >
                  Re-login
                </Button>
                <Button
                  v-else-if="server.status === 'failed'"
                  size="sm"
                  variant="outline"
                  class="h-7"
                  :disabled="pending === server.id"
                  @click="act(server, 'reset')"
                >
                  Reset
                </Button>
                <Button
                  v-else
                  size="sm"
                  variant="outline"
                  class="h-7"
                  :disabled="pending === server.id || !server.enabled"
                  @click="act(server, 'start')"
                >
                  Start
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Card class="gap-0 overflow-hidden py-0">
      <CardHeader class="gap-1 border-b py-3 [.border-b]:pb-3">
        <CardTitle class="text-sm font-medium">Recent requests</CardTitle>
        <CardDescription class="text-xs">The last calls that passed through the gateway.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" as-child>
            <RouterLink :to="{ name: 'request-log' }">View all</RouterLink>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent class="px-0">
        <p v-if="requests.length === 0" class="px-4 py-8 text-center text-muted-foreground">
          Calls appear here as soon as a client talks to an endpoint.
        </p>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead class="w-24">Time</TableHead>
              <TableHead class="w-32">Endpoint</TableHead>
              <TableHead class="w-32">Server</TableHead>
              <TableHead class="min-w-52">Method / tool</TableHead>
              <TableHead class="w-24 text-right">Duration</TableHead>
              <TableHead class="w-32">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in requests" :key="row.id" class="font-mono text-xs">
              <TableCell class="text-muted-foreground">{{ clockTime(row.ts) }}</TableCell>
              <TableCell class="max-w-[160px] truncate text-muted-foreground">
                {{ row.endpointSlug ? `/${row.endpointSlug}` : "—" }}
              </TableCell>
              <TableCell class="max-w-[160px] truncate">{{ row.serverName ?? "—" }}</TableCell>
              <TableCell class="max-w-0 truncate">{{ row.tool ?? row.method }}</TableCell>
              <TableCell :class="['text-right', durationTone(row.durationMs)]">
                {{ duration(row.durationMs) }}
              </TableCell>
              <TableCell>
                <span
                  class="inline-flex items-center gap-2"
                  :class="row.status === 'ok' ? 'text-success' : 'text-destructive'"
                >
                  <span
                    class="size-[6px] rounded-full"
                    :class="row.status === 'ok' ? 'bg-success' : 'bg-destructive'"
                  />
                  {{ row.errorCode ?? row.status }}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </PageLayout>
</template>
