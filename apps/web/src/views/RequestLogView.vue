<script setup lang="ts">
import type { EndpointDto, RequestLogDto, ServerDto } from "@junctio/schema";
import { RefreshCw } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import EmptyState from "@/components/EmptyState.vue";
import PageHeader from "@/components/PageHeader.vue";
import SearchSelect from "@/components/SearchSelect.vue";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { clockTime, duration } from "@/lib/format";
import { useSession } from "@/stores/session";

const { settings } = useSession();

const rows = ref<RequestLogDto[]>([]);
const endpoints = ref<EndpointDto[]>([]);
const servers = ref<ServerDto[]>([]);
const endpointId = ref("");
const serverId = ref("");
const status = ref<"all" | "ok" | "error">("all");
const loading = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;

const endpointOptions = computed(() => [
  { value: "", label: "All endpoints" },
  ...endpoints.value.map((endpoint) => ({ value: endpoint.id, label: `/mcp/${endpoint.slug}`, mono: true }))
]);

const serverOptions = computed(() => [
  { value: "", label: "All servers" },
  ...servers.value.map((server) => ({ value: server.id, label: server.name }))
]);

async function load() {
  loading.value = true;
  try {
    rows.value = await api.requestLog({
      endpointId: endpointId.value === "" ? undefined : endpointId.value,
      serverId: serverId.value === "" ? undefined : serverId.value,
      status: status.value === "all" ? undefined : status.value,
      limit: 200
    });
  } finally {
    loading.value = false;
  }
}

function durationTone(ms: number): string {
  if (ms >= 2000) return "text-warning";
  if (ms >= 5000) return "text-destructive";
  return "text-muted-foreground";
}

watch([endpointId, serverId, status], () => void load());

onMounted(async () => {
  [endpoints.value, servers.value] = await Promise.all([api.endpoints.list(), api.servers.list()]);
  await load();
  timer = setInterval(load, 10_000);
});
onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
    <PageHeader
      title="Request log"
      :description="`Every call that passed through the gateway. Retained ${settings?.requestLogRetentionDays ?? 7} days.`"
    >
      <template #actions>
        <Button variant="outline" size="sm" :disabled="loading" @click="load">
          <RefreshCw :class="loading && 'animate-spin'" />
          Refresh
        </Button>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-center gap-2">
      <SearchSelect v-model="endpointId" :options="endpointOptions" trigger-class="h-8 w-48" />
      <SearchSelect v-model="serverId" :options="serverOptions" trigger-class="h-8 w-48" />
      <Tabs v-model="status">
        <TabsList class="h-8">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="ok">Ok</TabsTrigger>
          <TabsTrigger value="error">Errors</TabsTrigger>
        </TabsList>
      </Tabs>
      <span class="ml-auto font-mono text-xs text-muted-foreground">{{ rows.length }} entries</span>
    </div>

    <EmptyState
      v-if="rows.length === 0 && !loading"
      dashed
      title="Nothing logged yet"
      description="Calls appear here as soon as a client talks to an endpoint."
    />

    <div v-else class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-24">Time</TableHead>
            <TableHead class="w-32">Endpoint</TableHead>
            <TableHead class="w-32">Server</TableHead>
            <TableHead class="min-w-52">Method / tool</TableHead>
            <TableHead class="w-28">Protocol</TableHead>
            <TableHead class="w-24 text-right">Duration</TableHead>
            <TableHead class="w-40">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in rows" :key="row.id" class="font-mono text-xs">
            <TableCell class="text-muted-foreground">{{ clockTime(row.ts) }}</TableCell>
            <TableCell class="max-w-[160px] truncate text-muted-foreground">
              {{ row.endpointSlug ? `/${row.endpointSlug}` : "—" }}
            </TableCell>
            <TableCell class="max-w-[160px] truncate">{{ row.serverName ?? "—" }}</TableCell>
            <TableCell class="max-w-0 truncate">{{ row.tool ?? row.method }}</TableCell>
            <TableCell class="text-muted-foreground">{{ row.protocol ?? "—" }}</TableCell>
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
    </div>
  </div>
</template>
