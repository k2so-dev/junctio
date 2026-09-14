<script setup lang="ts">
import type { NamespaceDto, NamespaceToolDto, ServerDto } from "@junctio/schema";
import { Loader2, Plus, RotateCcw, Trash2, TriangleAlert } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import EmptyState from "@/components/EmptyState.vue";
import SearchSelect from "@/components/SearchSelect.vue";
import StatusDot from "@/components/StatusDot.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const { settings } = useSession();

const namespaces = ref<NamespaceDto[]>([]);
const servers = ref<ServerDto[]>([]);
const tools = ref<NamespaceToolDto[]>([]);
const toolsLoading = ref(false);
const toolSearch = ref("");
const conflicts = ref<string[]>([]);
const addPick = ref("");
const creating = ref(false);
const draft = ref({ name: "", description: "" });
const busy = ref(false);

const selectedId = computed(() => {
  const param = typeof route.params.id === "string" ? route.params.id : null;
  if (param && namespaces.value.some((namespace) => namespace.id === param)) return param;
  return namespaces.value[0]?.id ?? null;
});

const current = computed(() => namespaces.value.find((namespace) => namespace.id === selectedId.value) ?? null);

const separator = computed(() => settings.value?.toolSeparator ?? "__");

const serverById = computed(() => new Map(servers.value.map((server) => [server.id, server])));

const available = computed(() =>
  servers.value
    .filter((server) => !current.value?.servers.some((member) => member.serverId === server.id))
    .map((server) => ({ value: server.id, label: server.name, hint: server.transport }))
);

const filteredTools = computed(() => {
  const term = toolSearch.value.trim().toLowerCase();
  if (term === "") return tools.value;
  return tools.value.filter(
    (tool) =>
      tool.exposedName.toLowerCase().includes(term) ||
      tool.serverName.toLowerCase().includes(term) ||
      (tool.description ?? tool.originalDescription ?? "").toLowerCase().includes(term)
  );
});

const enabledCount = computed(() => tools.value.filter((tool) => tool.enabled).length);

function hint(tool: NamespaceToolDto, key: string): boolean {
  return Boolean((tool.annotations ?? tool.originalAnnotations)?.[key]);
}

async function loadAll() {
  [namespaces.value, servers.value] = await Promise.all([api.namespaces.list(), api.servers.list()]);
}

async function loadTools() {
  if (!selectedId.value) {
    tools.value = [];
    return;
  }
  toolsLoading.value = true;
  try {
    tools.value = await api.namespaces.tools(selectedId.value);
    const result = await api.namespaces.validate(selectedId.value);
    conflicts.value = result.ok ? [] : result.conflicts;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      conflicts.value = (error.details as { conflicts?: string[] } | null)?.conflicts ?? [error.message];
    }
  } finally {
    toolsLoading.value = false;
  }
}

async function createNamespace() {
  busy.value = true;
  try {
    const created = await api.namespaces.create({
      name: draft.value.name,
      description: draft.value.description === "" ? null : draft.value.description
    });
    creating.value = false;
    draft.value = { name: "", description: "" };
    await loadAll();
    await router.push({ name: "namespaces", params: { id: created.id } });
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    busy.value = false;
  }
}

async function saveDescription(value: string) {
  if (!selectedId.value) return;
  await api.namespaces.patch(selectedId.value, { description: value === "" ? null : value });
  await loadAll();
}

async function removeNamespace() {
  if (!selectedId.value) return;
  try {
    await api.namespaces.remove(selectedId.value);
    toast.success("Namespace deleted");
    await loadAll();
    await router.push({ name: "namespaces" });
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

async function addServer() {
  if (!selectedId.value || addPick.value === "") return;
  try {
    await api.namespaces.putServer(selectedId.value, { serverId: addPick.value, prefix: null, enabled: true });
    addPick.value = "";
    await loadAll();
    await loadTools();
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

async function updateMember(serverId: string, prefix: string, enabled: boolean) {
  if (!selectedId.value) return;
  try {
    await api.namespaces.putServer(selectedId.value, {
      serverId,
      prefix: prefix.trim() === "" ? null : prefix.trim(),
      enabled
    });
    conflicts.value = [];
    await loadAll();
    await loadTools();
  } catch (error) {
    if (error instanceof ApiError) {
      conflicts.value = [error.message];
      toast.error(error.message);
      await loadAll();
    }
  }
}

async function removeMember(serverId: string) {
  if (!selectedId.value) return;
  await api.namespaces.removeServer(selectedId.value, serverId);
  await loadAll();
  await loadTools();
}

async function saveOverride(tool: NamespaceToolDto, patch: Partial<NamespaceToolDto>) {
  if (!selectedId.value) return;
  const next = { ...tool, ...patch };
  await api.namespaces.putTool(selectedId.value, {
    serverId: tool.serverId,
    toolName: tool.toolName,
    enabled: next.enabled,
    displayName: next.displayName,
    description: next.description,
    annotations: next.annotations
  });
  Object.assign(tool, patch);
}

async function revertOverride(tool: NamespaceToolDto) {
  if (!selectedId.value) return;
  await api.namespaces.resetTool(selectedId.value, tool.serverId, tool.toolName);
  await loadTools();
}

watch(selectedId, () => void loadTools());

onMounted(async () => {
  await loadAll();
  await loadTools();
});
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside class="flex w-60 shrink-0 flex-col gap-3 overflow-auto border-r p-4">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold tracking-tight">Namespaces</h1>
        <Button variant="outline" size="icon" class="size-7" title="New namespace" @click="creating = true">
          <Plus class="size-3.5" />
        </Button>
      </div>
      <nav class="flex flex-col gap-0.5">
        <RouterLink
          v-for="namespace in namespaces"
          :key="namespace.id"
          :to="{ name: 'namespaces', params: { id: namespace.id } }"
          :class="
            cn(
              'flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent',
              namespace.id === selectedId && 'bg-accent'
            )
          "
        >
          <span class="truncate font-medium">{{ namespace.name }}</span>
          <span class="truncate font-mono text-xs text-muted-foreground">
            {{ namespace.servers.length }} servers · {{ namespace.endpointCount }} endpoints
          </span>
        </RouterLink>
      </nav>
    </aside>

    <div v-if="current" class="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h2 class="flex min-w-0 items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span class="truncate">{{ current.name }}</span>
            <span class="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">
              {{ enabledCount }} tools exposed
            </span>
          </h2>
          <Input
            :model-value="current.description ?? ''"
            placeholder="Description…"
            class="mt-1.5 -ml-2.5 h-8 max-w-lg border-transparent bg-transparent text-muted-foreground shadow-none dark:bg-transparent hover:border-input dark:hover:bg-input/30"
            @change="saveDescription(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" as-child>
            <RouterLink :to="{ name: 'endpoints' }">Endpoints using this</RouterLink>
          </Button>
          <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-destructive" @click="removeNamespace">
            <Trash2 />
          </Button>
        </div>
      </div>

      <div
        v-if="conflicts.length > 0"
        class="flex items-start gap-2.5 rounded-lg border border-destructive/50 bg-destructive/8 p-3.5"
      >
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <span class="font-medium text-destructive">Name collision.</span>
          <span class="ml-1">{{ conflicts.join("; ") }} — clients would see two tools with the same name.</span>
        </div>
      </div>

      <div class="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="min-w-40">Server</TableHead>
              <TableHead class="w-40">Prefix</TableHead>
              <TableHead class="w-24">Status</TableHead>
              <TableHead class="w-20">Enabled</TableHead>
              <TableHead class="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="member in current.servers" :key="member.serverId" :class="!member.enabled && 'opacity-60'">
              <TableCell class="max-w-[220px] truncate font-medium">{{ member.serverName }}</TableCell>
              <TableCell>
                <Input
                  :model-value="member.prefix"
                  class="h-7 font-mono text-xs"
                  @change="updateMember(member.serverId, ($event.target as HTMLInputElement).value, member.enabled)"
                />
              </TableCell>
              <TableCell>
                <StatusDot
                  v-if="serverById.get(member.serverId)"
                  :status="serverById.get(member.serverId)!.status"
                  :label="false"
                />
              </TableCell>
              <TableCell>
                <Switch
                  :model-value="member.enabled"
                  @update:model-value="updateMember(member.serverId, member.prefix, $event)"
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7 text-muted-foreground hover:text-destructive"
                  title="Remove from namespace"
                  @click="removeMember(member.serverId)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div class="flex items-center gap-2 border-t p-2.5">
          <SearchSelect
            v-model="addPick"
            :options="available"
            placeholder="Add server…"
            trigger-class="h-8 w-56"
          />
          <Button variant="outline" size="sm" class="h-8" :disabled="addPick === ''" @click="addServer">Add</Button>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-muted-foreground">
          Tools — toggle visibility and edit the description clients see. Upstream names stay untouched.
        </p>
        <Input v-model="toolSearch" placeholder="Filter tools…" class="h-8 w-56" />
      </div>

      <EmptyState
        v-if="!toolsLoading && tools.length === 0"
        dashed
        title="No tools yet"
        description="Add a server to this namespace, or start the servers you already added so the gateway can read their catalogs."
      />

      <div v-else class="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-14" />
              <TableHead class="min-w-48">Exposed name</TableHead>
              <TableHead class="min-w-56">Description</TableHead>
              <TableHead class="w-24 text-right">Hints</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="tool in filteredTools" :key="tool.exposedName" :class="!tool.enabled && 'opacity-50'">
              <TableCell>
                <Switch :model-value="tool.enabled" @update:model-value="saveOverride(tool, { enabled: $event })" />
              </TableCell>
              <TableCell class="max-w-0">
                <div class="truncate font-mono text-xs">
                  <span class="text-muted-foreground">
                    {{ tool.exposedName.slice(0, tool.exposedName.lastIndexOf(separator) + separator.length) }}
                  </span>
                  {{ tool.toolName }}
                </div>
                <div class="truncate text-[11px] text-muted-foreground">{{ tool.serverName }}</div>
              </TableCell>
              <TableCell class="max-w-0">
                <div class="flex items-center gap-1.5">
                  <Input
                    :model-value="tool.description ?? tool.originalDescription ?? ''"
                    class="h-7 border-transparent bg-transparent shadow-none dark:bg-transparent hover:border-input dark:hover:bg-input/30"
                    @change="saveOverride(tool, { description: ($event.target as HTMLInputElement).value })"
                  />
                  <Button
                    v-if="tool.description !== null"
                    variant="outline"
                    size="sm"
                    class="h-6 shrink-0 px-1.5 text-[10px]"
                    title="Revert to the upstream description"
                    @click="revertOverride(tool)"
                  >
                    <RotateCcw class="size-2.5" />
                    edited
                  </Button>
                </div>
              </TableCell>
              <TableCell class="text-right">
                <span class="flex flex-wrap justify-end gap-1">
                  <Badge v-if="hint(tool, 'readOnlyHint')" variant="outline" class="text-[10px]">read-only</Badge>
                  <Badge
                    v-if="hint(tool, 'destructiveHint')"
                    variant="outline"
                    class="border-destructive/50 text-[10px] text-destructive"
                  >
                    destructive
                  </Badge>
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>

    <div v-else class="flex flex-1 items-center justify-center p-6">
      <EmptyState
        dashed
        title="No namespaces"
        description="A namespace groups upstream servers and decides which tools an endpoint exposes."
      >
        <Button size="sm" @click="creating = true">
          <Plus />
          New namespace
        </Button>
      </EmptyState>
    </div>

    <Dialog v-model:open="creating">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New namespace</DialogTitle>
          <DialogDescription>Group servers and expose them through one endpoint.</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="createNamespace">
          <div class="grid gap-2">
            <Label for="ns-name">Name</Label>
            <Input id="ns-name" v-model="draft.name" placeholder="coding" autofocus />
          </div>
          <div class="grid gap-2">
            <Label for="ns-description">Description</Label>
            <Input id="ns-description" v-model="draft.description" placeholder="Day-to-day dev stack" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="creating = false">Cancel</Button>
            <Button type="submit" :disabled="busy || draft.name === ''">
              <Loader2 v-if="busy" class="animate-spin" />
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
