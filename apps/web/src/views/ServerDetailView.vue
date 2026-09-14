<script setup lang="ts">
import type { NamespaceDto, ServerDto } from "@junctio/schema";
import { ArrowLeft, Loader2, Pencil, Trash2 } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import CodeBlock from "@/components/CodeBlock.vue";
import DefinitionList from "@/components/DefinitionList.vue";
import StatusDot from "@/components/StatusDot.vue";
import ServerAuth from "@/components/server/ServerAuth.vue";
import ServerLogs from "@/components/server/ServerLogs.vue";
import ServerTools from "@/components/server/ServerTools.vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { needsAttention, statusMeta } from "@/lib/status";

const route = useRoute();
const router = useRouter();

const TAB_LIST = "mt-3 h-auto w-full justify-start rounded-none bg-transparent p-0";
const TAB_TRIGGER =
  "h-9 flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent px-3 text-muted-foreground shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-x-0 dark:data-[state=active]:border-t-0 dark:data-[state=active]:bg-transparent data-[state=active]:border-b-foreground dark:data-[state=active]:border-b-foreground";

const id = computed(() => String(route.params.id));
const server = ref<ServerDto | null>(null);
const namespaces = ref<NamespaceDto[]>([]);
const tab = ref("overview");
const busy = ref<string | null>(null);

let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    server.value = await api.servers.get(id.value);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) await router.replace({ name: "servers" });
  }
}

async function loadNamespaces() {
  namespaces.value = await api.namespaces.list();
}

const memberships = computed(() =>
  namespaces.value
    .flatMap((namespace) =>
      namespace.servers
        .filter((member) => member.serverId === id.value)
        .map((member) => ({ name: namespace.name, prefix: member.prefix, enabled: member.enabled }))
    )
);

const overview = computed(() => {
  const current = server.value;
  if (!current) return [];
  const base = [
    { label: "Transport", value: current.transport },
    { label: "Enabled", value: current.enabled ? "yes" : "no" },
    { label: "Warm start", value: current.warm ? "yes" : "no" },
    { label: "Idle timeout", value: current.idleTimeoutSec === 0 ? "never" : `${current.idleTimeoutSec}s` },
    { label: "Created", value: relativeTime(current.createdAt) }
  ];
  if (current.transport === "stdio") {
    base.splice(1, 0, { label: "Runtime", value: current.runtime });
    base.splice(2, 0, { label: "Working directory", value: current.cwd ?? "inherited" });
    base.splice(3, 0, {
      label: "Environment",
      value: Object.keys(current.env).length === 0 ? "none" : Object.keys(current.env).join(", ")
    });
  } else {
    base.splice(1, 0, { label: "Auth mode", value: current.authMode });
  }
  return base;
});

const stats = computed(() => {
  const current = server.value;
  if (!current) return [];
  return [
    { label: "Status", value: statusMeta(current.status).label },
    { label: "PID", value: current.pid === null ? "—" : String(current.pid) },
    { label: "Restarts", value: String(current.restarts) },
    { label: "Tools", value: current.toolCount === null ? "—" : String(current.toolCount) },
    { label: "Protocol", value: current.protocolVersion ?? "—" }
  ];
});

async function act(action: "start" | "stop" | "restart" | "reset") {
  busy.value = action;
  try {
    server.value = await api.servers[action](id.value);
    toast.success(`${action} done`);
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    busy.value = null;
    await load();
  }
}

async function test() {
  busy.value = "test";
  try {
    const result = await api.servers.test(id.value);
    if (result.ok) {
      const info = result.serverInfo ? `${result.serverInfo.name} ${result.serverInfo.version}` : "connected";
      const protocol = result.protocolVersion ? ` · ${result.protocolVersion}` : "";
      toast.success(`${info}${protocol} · ${result.toolCount} tools · ${result.durationMs}ms`);
    } else {
      toast.error(result.error ?? "Connection failed");
    }
  } finally {
    busy.value = null;
    await load();
  }
}

async function toggleEnabled() {
  if (!server.value) return;
  busy.value = "enabled";
  try {
    server.value = await api.servers.patch(id.value, { enabled: !server.value.enabled });
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    busy.value = null;
  }
}

async function remove() {
  try {
    await api.servers.remove(id.value);
    toast.success("Server deleted");
    await router.push({ name: "servers" });
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

watch(id, () => {
  void load();
});

onMounted(() => {
  void load();
  void loadNamespaces();
  timer = setInterval(load, 5000);
});
onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});
</script>

<template>
  <Tabs v-if="server" v-model="tab" class="flex min-h-0 flex-1 flex-col gap-0">
    <div class="border-b bg-sidebar px-6 pt-4">
      <Button variant="ghost" size="sm" class="mb-2 -ml-2 text-muted-foreground" @click="router.push({ name: 'servers' })">
        <ArrowLeft />
        Servers
      </Button>

      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex min-w-0 flex-wrap items-center gap-3">
          <h1 class="max-w-full truncate text-xl font-semibold tracking-tight">{{ server.name }}</h1>
          <StatusDot :status="server.status" class="shrink-0 rounded-full border px-2.5 py-0.5 text-xs" />
          <span class="max-w-full truncate font-mono text-[11px] text-muted-foreground">
            {{ server.transport === "http" ? server.url : server.runtime }}
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="server.status === 'running' || server.status === 'starting'"
            variant="outline"
            size="sm"
            :disabled="busy !== null"
            @click="act('stop')"
          >
            Stop
          </Button>
          <Button v-else variant="outline" size="sm" :disabled="busy !== null || !server.enabled" @click="act('start')">
            Start
          </Button>
          <Button v-if="server.status === 'failed'" variant="outline" size="sm" :disabled="busy !== null" @click="act('reset')">
            Reset failures
          </Button>
          <Button variant="outline" size="sm" :disabled="busy !== null" @click="act('restart')">Restart</Button>
          <Button variant="outline" size="sm" :disabled="busy !== null" @click="test">
            <Loader2 v-if="busy === 'test'" class="animate-spin" />
            Test connection
          </Button>
          <Button variant="outline" size="sm" :disabled="busy !== null" @click="toggleEnabled">
            {{ server.enabled ? "Disable" : "Enable" }}
          </Button>
          <Button variant="outline" size="sm" as-child>
            <RouterLink :to="{ name: 'server-edit', params: { id: server.id } }">
              <Pencil />
              Edit
            </RouterLink>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger as-child>
              <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-destructive">
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {{ server.name }}?</AlertDialogTitle>
                <AlertDialogDescription>
                  The process is stopped, stored credentials are dropped and the server is removed from every namespace.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction class="bg-destructive text-destructive-foreground" @click="remove">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <TabsList :class="TAB_LIST">
        <TabsTrigger value="overview" :class="TAB_TRIGGER">Overview</TabsTrigger>
        <TabsTrigger value="tools" :class="TAB_TRIGGER">Tools</TabsTrigger>
        <TabsTrigger value="logs" :class="TAB_TRIGGER">
          Logs
          <span v-if="server.status === 'failed'" class="size-[6px] rounded-full bg-destructive" />
        </TabsTrigger>
        <TabsTrigger value="auth" :class="TAB_TRIGGER">
          Auth
          <span v-if="needsAttention(server)" class="size-[6px] rounded-full bg-warning" />
        </TabsTrigger>
      </TabsList>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      <TabsContent value="overview" class="mt-0">
          <div class="grid items-start gap-5 lg:grid-cols-[minmax(300px,1.3fr)_minmax(260px,1fr)]">
            <div class="flex flex-col gap-3.5">
              <CodeBlock
                :title="server.transport === 'stdio' ? 'Resulting command' : 'Endpoint'"
                :code="server.transport === 'stdio' ? server.commandPreview : (server.url ?? '')"
                copyable
              />
              <DefinitionList :items="overview" />
            </div>
            <div class="flex flex-col gap-3.5">
              <div class="grid grid-cols-2 gap-3.5 rounded-lg border bg-card p-3.5">
                <div v-for="stat in stats" :key="stat.label">
                  <div class="text-xs text-muted-foreground">{{ stat.label }}</div>
                  <div class="mt-0.5 font-mono text-base">{{ stat.value }}</div>
                </div>
              </div>

              <div v-if="server.lastError" class="rounded-lg border border-destructive/50 bg-destructive/8 p-3.5">
                <div class="font-medium text-destructive">Last error</div>
                <p class="mt-1 font-mono text-xs leading-relaxed break-words">{{ server.lastError }}</p>
              </div>

              <div class="rounded-lg border bg-card px-3.5 py-2.5">
                <div class="pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Used in namespaces
                </div>
                <div
                  v-for="membership in memberships"
                  :key="membership.name"
                  class="flex justify-between gap-3 border-t py-2"
                >
                  <span :class="!membership.enabled && 'text-muted-foreground line-through'">{{ membership.name }}</span>
                  <span class="font-mono text-xs text-muted-foreground">prefix {{ membership.prefix }}</span>
                </div>
                <p v-if="memberships.length === 0" class="border-t py-2 text-muted-foreground">
                  Not used yet. Add it to a namespace to expose its tools.
                </p>
              </div>
            </div>
          </div>
      </TabsContent>

      <TabsContent value="tools" class="mt-0">
        <ServerTools :server="server" :namespaces="namespaces" />
      </TabsContent>

      <TabsContent value="logs" class="mt-0 flex min-h-0 flex-1 flex-col">
        <ServerLogs :server-id="server.id" />
      </TabsContent>

      <TabsContent value="auth" class="mt-0">
        <ServerAuth :server="server" @changed="load" />
      </TabsContent>
    </div>
  </Tabs>
</template>
