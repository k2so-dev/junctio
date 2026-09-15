<script setup lang="ts">
import type { ServerDto } from "@junctio/schema";
import { Plus, RotateCw } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import EmptyState from "@/components/EmptyState.vue";
import PageLayout from "@/components/layout/PageLayout.vue";
import StatusDot from "@/components/StatusDot.vue";
import AuditBadge from "@/components/server/AuditBadge.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { needsAttention, serverMeta } from "@/lib/status";

function auditWorthShowing(server: ServerDto): boolean {
  if (server.quarantinedAt !== null) return true;
  const status = server.audit?.status;
  return status === "ok" || status === "vulnerable" || status === "error";
}

const router = useRouter();

const servers = ref<ServerDto[]>([]);
const loading = ref(true);
const search = ref("");
const filter = ref<"all" | "running" | "attention" | "idle">("all");
const pending = ref<string | null>(null);

let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    servers.value = await api.servers.list();
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    loading.value = false;
  }
}

const groups: Record<typeof filter.value, (server: ServerDto) => boolean> = {
  all: () => true,
  running: (server) => server.status === "running" || server.status === "starting",
  attention: needsAttention,
  idle: (server) => server.status === "idle" || server.status === "stopped"
};

const counts = computed(() => ({
  all: servers.value.length,
  running: servers.value.filter(groups.running).length,
  attention: servers.value.filter(groups.attention).length,
  idle: servers.value.filter(groups.idle).length
}));

const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  return servers.value
    .filter(groups[filter.value])
    .filter((server) =>
      term === ""
        ? true
        : server.name.toLowerCase().includes(term) ||
          server.commandPreview.toLowerCase().includes(term) ||
          (server.url ?? "").toLowerCase().includes(term)
    );
});

const authSummary = (server: ServerDto) => {
  if (server.transport === "stdio") return "—";
  if (server.authMode === "none") return "none";
  if (server.authMode === "header") return "static header";
  return server.oauth ? `oauth · ${server.oauth.status}` : "oauth · not linked";
};

async function act(server: ServerDto, action: "start" | "stop" | "restart" | "reset") {
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

async function reauth(server: ServerDto) {
  try {
    const { authorizationUrl } = await api.servers.oauthStart(server.id);
    window.location.href = authorizationUrl;
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

onMounted(() => {
  void load();
  timer = setInterval(load, 5000);
});
onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});
</script>

<template>
  <PageLayout title="Servers">
    <template #actions>
      <Button size="sm" @click="router.push({ name: 'server-new' })">
        <Plus />
        Add server
      </Button>
    </template>

    <template #toolbar>
      <Tabs v-model="filter">
        <TabsList class="h-8">
          <TabsTrigger value="all">All <span class="ml-1.5 font-mono text-xs opacity-60">{{ counts.all }}</span></TabsTrigger>
          <TabsTrigger value="running">Running <span class="ml-1.5 font-mono text-xs opacity-60">{{ counts.running }}</span></TabsTrigger>
          <TabsTrigger value="attention">Needs attention <span class="ml-1.5 font-mono text-xs opacity-60">{{ counts.attention }}</span></TabsTrigger>
          <TabsTrigger value="idle">Idle <span class="ml-1.5 font-mono text-xs opacity-60">{{ counts.idle }}</span></TabsTrigger>
        </TabsList>
      </Tabs>
      <Input v-model="search" placeholder="Search servers…" class="ml-auto h-8 w-60" />
    </template>

    <EmptyState
      v-if="!loading && servers.length === 0"
      dashed
      title="No servers yet"
      description="Add an npm or PyPI package as a stdio server, or point the gateway at a remote Streamable HTTP or SSE server."
    >
      <Button size="sm" @click="router.push({ name: 'server-new' })">
        <Plus />
        Add server
      </Button>
    </EmptyState>

    <Card v-else class="gap-0 overflow-x-auto py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="min-w-44">Server</TableHead>
            <TableHead class="w-28">Status</TableHead>
            <TableHead class="min-w-52">Command / URL</TableHead>
            <TableHead class="w-20">Tools</TableHead>
            <TableHead class="w-32">Auth</TableHead>
            <TableHead class="w-40 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="server in rows"
            :key="server.id"
            class="cursor-pointer"
            @click="router.push({ name: 'server', params: { id: server.id } })"
          >
            <TableCell class="max-w-[260px]">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate font-medium">{{ server.name }}</span>
                <Badge variant="outline" class="shrink-0 font-mono text-[10px]">
                  {{ server.transport === "stdio" ? server.runtime : server.transport }}
                </Badge>
              </div>
              <div class="truncate text-xs text-muted-foreground">{{ serverMeta(server) }}</div>
            </TableCell>
            <TableCell>
              <div class="flex flex-col items-start gap-1">
                <StatusDot :status="server.status" />
                <AuditBadge
                  v-if="auditWorthShowing(server)"
                  :summary="server.audit"
                  :quarantined="server.quarantinedAt !== null"
                  compact
                />
              </div>
            </TableCell>
            <TableCell class="max-w-0">
              <div class="truncate font-mono text-xs text-muted-foreground">
                {{ server.transport === "stdio" ? server.commandPreview : server.url }}
              </div>
            </TableCell>
            <TableCell class="font-mono text-muted-foreground">{{ server.toolCount ?? "—" }}</TableCell>
            <TableCell class="text-xs text-muted-foreground">{{ authSummary(server) }}</TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-1">
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
                  v-if="server.status === 'running' || server.status === 'starting'"
                  size="sm"
                  variant="outline"
                  class="h-7"
                  :disabled="pending === server.id"
                  @click="act(server, 'stop')"
                >
                  Stop
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
                <Button
                  size="icon"
                  variant="outline"
                  class="size-7"
                  title="Restart"
                  :disabled="pending === server.id"
                  @click="act(server, 'restart')"
                >
                  <RotateCw class="size-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
          <TableRow v-if="rows.length === 0 && servers.length > 0">
            <TableCell colspan="6" class="py-9 text-center text-muted-foreground">No servers match.</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  </PageLayout>
</template>
