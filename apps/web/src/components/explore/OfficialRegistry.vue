<script setup lang="ts">
import type { RegistryDetailDto, RegistryInstallOptionDto, RegistryLinkDto, RegistryServerDto } from "@junctio/schema";
import { Braces, ChevronLeft, ChevronRight, Code, Globe, Loader2, Package, TriangleAlert } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import EmptyState from "@/components/EmptyState.vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;

const LINK_ICONS: Record<RegistryLinkDto["kind"], typeof Code> = {
  repository: Code,
  website: Globe,
  npm: Package,
  pypi: Package,
  registry: Braces
};

const router = useRouter();

const items = ref<RegistryServerDto[]>([]);
const nextCursor = ref<string | null>(null);
const cursors = ref<string[]>([]);
const search = ref("");
const loading = ref(true);
const failure = ref<string | null>(null);
const fetchedAt = ref(0);
const stale = ref(false);
const staleReason = ref<string | null>(null);

const detail = ref<RegistryDetailDto | null>(null);
const detailFor = ref<string | null>(null);
const detailBusy = ref(false);
const picked = ref<string | null>(null);
const open = ref(false);

let debounce: ReturnType<typeof setTimeout> | null = null;

const page = computed(() => cursors.value.length + 1);

const pickedOption = computed<RegistryInstallOptionDto | null>(
  () => detail.value?.options.find((option) => option.id === picked.value) ?? null
);

async function load(refresh = false) {
  loading.value = true;
  failure.value = null;
  try {
    const result = await api.registry.list({
      limit: PAGE_SIZE,
      ...(search.value.trim() === "" ? {} : { search: search.value.trim() }),
      ...(cursors.value.length > 0 ? { cursor: cursors.value[cursors.value.length - 1] } : {}),
      ...(refresh ? { refresh: "1" } : {})
    });
    items.value = result.items;
    nextCursor.value = result.nextCursor;
    fetchedAt.value = result.fetchedAt;
    stale.value = result.stale;
    staleReason.value = result.error;
  } catch (error) {
    items.value = [];
    nextCursor.value = null;
    failure.value = error instanceof ApiError ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function forward() {
  if (!nextCursor.value) return;
  cursors.value = [...cursors.value, nextCursor.value];
  void load();
}

function back() {
  if (cursors.value.length === 0) return;
  cursors.value = cursors.value.slice(0, -1);
  void load();
}

watch(search, () => {
  if (debounce !== null) clearTimeout(debounce);
  debounce = setTimeout(() => {
    cursors.value = [];
    void load();
  }, 300);
});

async function inspect(server: RegistryServerDto) {
  open.value = true;
  detailFor.value = server.name;
  detail.value = null;
  picked.value = null;
  detailBusy.value = true;
  try {
    const result = await api.registry.get(server.name);
    detail.value = result;
    picked.value = result.options.find((option) => option.supported)?.id ?? null;
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
    open.value = false;
  } finally {
    detailBusy.value = false;
  }
}

function install() {
  const option = pickedOption.value;
  if (!option?.draft) return;
  open.value = false;
  void router.push({
    name: "server-new",
    state: { draft: JSON.stringify(option.draft), source: detailFor.value ?? "" }
  });
}

onMounted(() => void load());

defineExpose({ load, loading });
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Input v-model="search" placeholder="Search the registry by name…" class="h-8 w-72" />
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span v-if="fetchedAt > 0">Fetched {{ relativeTime(fetchedAt) }}</span>
        <Button size="icon" variant="outline" class="size-7" :disabled="cursors.length === 0 || loading" @click="back">
          <ChevronLeft class="size-3.5" />
        </Button>
        <span class="font-mono">{{ page }}</span>
        <Button size="icon" variant="outline" class="size-7" :disabled="!nextCursor || loading" @click="forward">
          <ChevronRight class="size-3.5" />
        </Button>
      </div>
    </div>

    <Alert v-if="stale" class="border-warning/50">
      <TriangleAlert class="text-warning" />
      <AlertTitle>Showing a cached copy</AlertTitle>
      <AlertDescription>
        The registry did not answer: {{ staleReason }}. This list was fetched {{ relativeTime(fetchedAt) }}.
      </AlertDescription>
    </Alert>

    <EmptyState v-if="failure" dashed title="The registry is out of reach" :description="failure">
      <Button size="sm" @click="load(true)">Try again</Button>
    </EmptyState>

    <EmptyState
      v-else-if="!loading && items.length === 0"
      dashed
      title="Nothing matches"
      description="The registry searches by name only. Try a shorter term, or a part of the package name."
    />

    <div v-else class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="min-w-56">Server</TableHead>
            <TableHead class="min-w-64">Description</TableHead>
            <TableHead class="w-36">Kind</TableHead>
            <TableHead class="w-24">Version</TableHead>
            <TableHead class="w-28">Updated</TableHead>
            <TableHead class="w-28">Links</TableHead>
            <TableHead class="w-32 text-right">Install</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="server in items" :key="server.name">
            <TableCell class="max-w-[280px]">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate font-medium">{{ server.title ?? server.name.split("/").pop() }}</span>
                <Badge v-if="server.installed" variant="secondary" class="shrink-0 text-[10px]">Installed</Badge>
              </div>
              <div class="truncate font-mono text-xs text-muted-foreground">{{ server.name }}</div>
            </TableCell>
            <TableCell class="max-w-0">
              <div class="truncate text-muted-foreground">{{ server.description }}</div>
            </TableCell>
            <TableCell>
              <div class="flex flex-wrap gap-1">
                <Badge v-for="kind in server.kinds" :key="kind" variant="outline" class="font-mono text-[10px]">
                  {{ kind }}
                </Badge>
              </div>
            </TableCell>
            <TableCell class="font-mono text-xs text-muted-foreground">{{ server.version || "—" }}</TableCell>
            <TableCell class="text-xs text-muted-foreground">{{ relativeTime(server.updatedAt) }}</TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <a
                  v-for="link in server.links"
                  :key="link.url"
                  :href="link.url"
                  :title="`${link.label} — opens in a new tab`"
                  target="_blank"
                  rel="noreferrer noopener"
                  class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <component :is="LINK_ICONS[link.kind]" class="size-3.5" />
                </a>
              </div>
            </TableCell>
            <TableCell class="text-right">
              <Button
                v-if="server.installable"
                size="sm"
                :variant="server.installed ? 'outline' : 'default'"
                class="h-7"
                @click="inspect(server)"
              >
                {{ server.installed ? "Add again" : "Install" }}
              </Button>
              <span v-else class="text-xs text-muted-foreground">Not installable</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog v-model:open="open">
      <DialogContent class="max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ detail?.server.title ?? detailFor }}</DialogTitle>
          <DialogDescription>{{ detail?.server.description }}</DialogDescription>
        </DialogHeader>

        <div v-if="detailBusy" class="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 class="size-4 animate-spin" />
          Asking the registry…
        </div>

        <div v-else-if="detail" class="flex max-h-[55vh] flex-col gap-3 overflow-auto">
          <div class="flex flex-wrap gap-1.5">
            <a
              v-for="link in detail.server.links"
              :key="link.url"
              :href="link.url"
              target="_blank"
              rel="noreferrer noopener"
              class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            >
              <component :is="LINK_ICONS[link.kind]" class="size-3" />
              {{ link.label }}
            </a>
          </div>

          <div class="grid gap-2">
            <button
              v-for="option in detail.options"
              :key="option.id"
              type="button"
              :disabled="!option.supported"
              :class="
                cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  option.supported ? 'hover:border-ring' : 'cursor-not-allowed opacity-60',
                  picked === option.id ? 'border-primary bg-accent' : 'bg-card'
                )
              "
              @click="picked = option.id"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium">{{ option.label }}</span>
                <Badge variant="outline" class="font-mono text-[10px]">{{ option.kind }}</Badge>
              </div>
              <div class="mt-0.5 truncate font-mono text-xs text-muted-foreground">{{ option.detail }}</div>
              <div v-if="option.reason" class="mt-1 text-xs leading-snug text-warning">{{ option.reason }}</div>
            </button>
          </div>

          <div v-if="pickedOption && pickedOption.inputs.length > 0" class="rounded-lg border bg-card p-3">
            <div class="font-medium">You will need to fill in</div>
            <ul class="mt-1.5 flex flex-col gap-1.5">
              <li v-for="input in pickedOption.inputs" :key="input.name" class="text-xs">
                <span class="font-mono text-foreground">{{ input.name }}</span>
                <span v-if="input.required" class="ml-1.5 text-warning">required</span>
                <span v-if="input.secret" class="ml-1.5 text-muted-foreground">secret</span>
                <div v-if="input.description" class="text-muted-foreground">{{ input.description }}</div>
              </li>
            </ul>
          </div>
          <p v-else-if="pickedOption" class="text-xs text-muted-foreground">
            Nothing to fill in. The next screen shows the exact command before you save it.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="open = false">Cancel</Button>
          <Button :disabled="!pickedOption?.draft" @click="install">Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
