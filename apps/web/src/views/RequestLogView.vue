<script setup lang="ts">
import type { EndpointDto, RequestLogDto, ServerDto } from "@junctio/schema";
import { RefreshCw } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import EmptyState from "@/components/EmptyState.vue";
import PageLayout from "@/components/layout/PageLayout.vue";
import SearchSelect from "@/components/SearchSelect.vue";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { clockTime, duration, durationTone } from "@/lib/format";
import { toast } from "vue-sonner";
import { useSession } from "@/stores/session";
import { usePolling } from "@/composables/usePolling";
import { describeError } from "@/composables/useResource";

const { settings } = useSession();

const rows = ref<RequestLogDto[]>([]);
const endpoints = ref<EndpointDto[]>([]);
const servers = ref<ServerDto[]>([]);
const endpointId = ref("");
const serverId = ref("");
const status = ref<"all" | "ok" | "error">("all");
const loading = ref(false);

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
  } catch (error) {
    toast.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

watch([endpointId, serverId, status], () => void load());

onMounted(async () => {
  try {
    [endpoints.value, servers.value] = await Promise.all([api.endpoints.list(), api.servers.list()]);
  } catch (error) {
    toast.error(describeError(error));
  }
});

usePolling(load, 10_000);
</script>

<template>
  <PageLayout title="Request log">
    <template #actions>
      <Button variant="outline" size="sm" :disabled="loading" @click="load">
        <RefreshCw :class="loading && 'animate-spin'" />
        Refresh
      </Button>
    </template>

    <template #toolbar>
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
    </template>

    <EmptyState
      v-if="rows.length === 0 && !loading"
      dashed
      title="Nothing logged yet"
      description="Calls appear here as soon as a client talks to an endpoint."
    />

    <Card v-else class="gap-0 overflow-x-auto py-0">
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
    </Card>

    <p class="text-xs text-muted-foreground">
      Every call that passed through the gateway. Retained {{ settings?.requestLogRetentionDays ?? 7 }} days.
    </p>
  </PageLayout>
</template>
