<script setup lang="ts">
import type { NamespaceDto, ServerDto } from "@junctio/schema";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import CodeBlock from "@/components/CodeBlock.vue";
import DefinitionList from "@/components/DefinitionList.vue";
import PageLayout from "@/components/layout/PageLayout.vue";
import StatusDot from "@/components/StatusDot.vue";
import DockerStatus from "@/components/server/DockerStatus.vue";
import ServerAudit from "@/components/server/ServerAudit.vue";
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
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { needsAttention, statusMeta } from "@/lib/status";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();

const TAB_LIST = "h-auto w-full justify-start rounded-none bg-transparent p-0";
const TAB_TRIGGER =
  "h-9 flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent px-3 text-muted-foreground shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-x-0 dark:data-[state=active]:border-t-0 dark:data-[state=active]:bg-transparent data-[state=active]:border-b-foreground dark:data-[state=active]:border-b-foreground";

const TABS = ["overview", "tools", "logs", "auth", "audit"];

const id = computed(() => String(route.params.id));
const server = ref<ServerDto | null>(null);
const namespaces = ref<NamespaceDto[]>([]);
const tab = ref(typeof route.query.tab === "string" && TABS.includes(route.query.tab) ? route.query.tab : "overview");
const busy = ref<string | null>(null);
const confirmDelete = ref(false);
const { settings, refreshSettings } = useSession();

const auditEnabled = computed(() => settings.value?.auditEnabled ?? false);

async function liftQuarantine() {
  busy.value = "quarantine";
  try {
    server.value = await api.servers.liftQuarantine(id.value);
    toast.success("Quarantine lifted");
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    busy.value = null;
  }
}

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
  const container = current.runtime === "docker" && current.transport === "stdio";
  return [
    { label: "Status", value: statusMeta(current.status).label },
    container
      ? { label: "Container", value: current.containerId === null ? "—" : current.containerId.slice(0, 12) }
      : { label: "PID", value: current.pid === null ? "—" : String(current.pid) },
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
  void refreshSettings();
  timer = setInterval(load, 5000);
});
onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});
</script>

<template>
  <Tabs v-if="server" v-model="tab" class="flex min-h-0 flex-1 flex-col gap-0">
    <PageLayout
      :breadcrumbs="[{ label: 'Servers', to: { name: 'servers' } }, { label: server.name }]"
      padded
    >
      <template #title>
        <div class="flex min-w-0 items-center gap-2.5">
          <h1 class="truncate text-base font-medium">{{ server.name }}</h1>
          <StatusDot :status="server.status" class="shrink-0 rounded-full border px-2 py-0.5 text-xs" />
        </div>
      </template>

      <template #actions>
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
        <Button variant="outline" size="sm" :disabled="busy !== null" @click="act('restart')">Restart</Button>
        <Button variant="outline" size="sm" :disabled="busy !== null" @click="test">
          <Loader2 v-if="busy === 'test'" class="animate-spin" />
          Test
        </Button>
        <Button variant="outline" size="sm" as-child>
          <RouterLink :to="{ name: 'server-edit', params: { id: server.id } }">
            <Pencil />
            Edit
          </RouterLink>
        </Button>

        <AlertDialog v-model:open="confirmDelete">
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

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="size-8 text-muted-foreground">
              <MoreHorizontal />
              <span class="sr-only">More actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuItem :disabled="busy !== null" @select="act('reset')">Reset failures</DropdownMenuItem>
            <DropdownMenuItem :disabled="busy !== null" @select="toggleEnabled">
              {{ server.enabled ? "Disable" : "Enable" }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" @select="confirmDelete = true">
              <Trash2 />
              Delete server
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>

      <template #toolbar>
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
          <TabsTrigger value="audit" :class="TAB_TRIGGER">
            Audit
            <span
              v-if="server.quarantinedAt !== null || server.audit?.status === 'vulnerable'"
              :class="
                server.quarantinedAt !== null
                  ? 'size-[6px] rounded-full bg-destructive'
                  : 'size-[6px] rounded-full bg-warning'
              "
            />
          </TabsTrigger>
        </TabsList>
      </template>

      <div
        v-if="server.quarantinedAt !== null"
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="font-medium text-destructive">Quarantined by the security audit</span>
          <span class="text-xs text-muted-foreground">
            {{ server.quarantineReason ?? "A vulnerable package was found." }}
          </span>
          <span class="text-xs text-muted-foreground">
            Lifting it keeps the server running until the next audit finds the same advisory again.
          </span>
        </div>
        <Button variant="outline" size="sm" :disabled="busy !== null" @click="liftQuarantine">Lift quarantine</Button>
      </div>

      <div
        v-else-if="server.disabledReason"
        class="rounded-lg border border-warning/50 bg-warning/5 px-4 py-3 text-xs text-muted-foreground"
      >
        <span class="font-medium text-warning">Disabled by the security audit.</span>
        {{ server.disabledReason }}
      </div>

      <TabsContent value="overview" class="mt-0">
        <div class="grid items-start gap-4 lg:grid-cols-3">
          <div class="flex flex-col gap-4 lg:col-span-2">
            <Card class="gap-0 overflow-hidden py-0">
              <CardHeader class="border-b py-3 [.border-b]:pb-3">
                <CardTitle class="text-sm font-medium">
                  {{ server.transport === "stdio" ? "Resulting command" : "Endpoint" }}
                </CardTitle>
              </CardHeader>
              <CardContent class="py-4">
                <CodeBlock
                  :code="server.transport === 'stdio' ? server.commandPreview : (server.url ?? '')"
                  copyable
                />
              </CardContent>
            </Card>

            <Card class="gap-0 overflow-hidden py-0">
              <CardHeader class="border-b py-3 [.border-b]:pb-3">
                <CardTitle class="text-sm font-medium">Configuration</CardTitle>
              </CardHeader>
              <CardContent class="px-4 py-0">
                <DefinitionList :items="overview" class="rounded-none border-0 bg-transparent px-0" />
              </CardContent>
            </Card>
          </div>

          <div class="flex flex-col gap-4">
            <Card class="gap-0 overflow-hidden py-0">
              <CardHeader class="border-b py-3 [.border-b]:pb-3">
                <CardTitle class="text-sm font-medium">Runtime</CardTitle>
              </CardHeader>
              <CardContent class="grid grid-cols-2 gap-3.5 py-4">
                <div v-for="stat in stats" :key="stat.label">
                  <div class="text-xs text-muted-foreground">{{ stat.label }}</div>
                  <div class="mt-0.5 font-mono text-base">{{ stat.value }}</div>
                </div>
              </CardContent>
            </Card>

            <DockerStatus v-if="server.runtime === 'docker' && server.transport === 'stdio'" compact />

            <div v-if="server.lastError" class="rounded-lg border border-destructive/50 bg-destructive/8 p-3.5">
              <div class="font-medium text-destructive">Last error</div>
              <p class="mt-1 font-mono text-xs leading-relaxed break-words">{{ server.lastError }}</p>
            </div>

            <Card class="gap-0 overflow-hidden py-0">
              <CardHeader class="border-b py-3 [.border-b]:pb-3">
                <CardTitle class="text-sm font-medium">Used in namespaces</CardTitle>
              </CardHeader>
              <CardContent class="px-4 py-0">
                <div
                  v-for="membership in memberships"
                  :key="membership.name"
                  class="flex justify-between gap-3 border-b py-2.5 last:border-b-0"
                >
                  <span :class="!membership.enabled && 'text-muted-foreground line-through'">{{ membership.name }}</span>
                  <span class="font-mono text-xs text-muted-foreground">prefix {{ membership.prefix }}</span>
                </div>
                <p v-if="memberships.length === 0" class="py-3 text-muted-foreground">
                  Not used yet. Add it to a namespace to expose its tools.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="tools" class="mt-0">
        <ServerTools :server="server" :namespaces="namespaces" />
      </TabsContent>

      <TabsContent value="logs" class="mt-0 flex min-h-0 flex-1 flex-col">
        <ServerLogs :server-id="server.id" />
      </TabsContent>

      <TabsContent value="audit" class="mt-0">
        <ServerAudit :target="server.id" :enabled="auditEnabled" @changed="load" />
      </TabsContent>

      <TabsContent value="auth" class="mt-0">
        <ServerAuth :server="server" @changed="load" />
      </TabsContent>
    </PageLayout>
  </Tabs>
</template>
