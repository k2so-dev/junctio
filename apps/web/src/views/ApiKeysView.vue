<script setup lang="ts">
import type { ApiKeyDto, EndpointDto } from "@junctio/schema";
import { Check, Copy, Loader2, Plus, ShieldCheck } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { toast } from "vue-sonner";
import EmptyState from "@/components/EmptyState.vue";
import PageHeader from "@/components/PageHeader.vue";
import SearchSelect from "@/components/SearchSelect.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { relativeTime, shortDate } from "@/lib/format";

const route = useRoute();

const keys = ref<ApiKeyDto[]>([]);
const endpoints = ref<EndpointDto[]>([]);
const creating = ref(false);
const busy = ref(false);
const revealed = ref<string | null>(null);
const copied = ref(false);
const draft = ref({ name: "", endpointId: "", expires: "never" });

const EXPIRY = [
  { value: "never", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" }
];

const endpointOptions = computed(() => [
  { value: "", label: "All endpoints" },
  ...endpoints.value.map((endpoint) => ({ value: endpoint.id, label: `/mcp/${endpoint.slug}`, mono: true }))
]);

function expiryMeta(key: ApiKeyDto): { label: string; tone: string } {
  if (key.expiresAt === null) return { label: "never", tone: "text-muted-foreground" };
  if (key.expiresAt < Date.now()) return { label: "expired", tone: "text-destructive" };
  const days = Math.ceil((key.expiresAt - Date.now()) / 86_400_000);
  return { label: shortDate(key.expiresAt), tone: days <= 7 ? "text-warning" : "text-muted-foreground" };
}

async function load() {
  [keys.value, endpoints.value] = await Promise.all([api.apiKeys.list(), api.endpoints.list()]);
}

async function create() {
  busy.value = true;
  try {
    const created = await api.apiKeys.create({
      name: draft.value.name,
      endpointId: draft.value.endpointId === "" ? null : draft.value.endpointId,
      expiresAt:
        draft.value.expires === "never" ? null : Date.now() + Number(draft.value.expires) * 86_400_000
    });
    revealed.value = created.token;
    creating.value = false;
    draft.value = { name: "", endpointId: "", expires: "never" };
    await load();
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    busy.value = false;
  }
}

async function copy() {
  if (!revealed.value) return;
  await navigator.clipboard.writeText(revealed.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1600);
}

async function revoke(key: ApiKeyDto) {
  try {
    await api.apiKeys.remove(key.id);
    toast.success(`${key.name} revoked`);
    await load();
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

onMounted(async () => {
  await load();
  const preselect = typeof route.query.endpoint === "string" ? route.query.endpoint : null;
  if (preselect) {
    draft.value.endpointId = preselect;
    const endpoint = endpoints.value.find((item) => item.id === preselect);
    if (endpoint) draft.value.name = `${endpoint.slug} client`;
    creating.value = true;
  }
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
    <PageHeader title="API Keys">
      <template #description>
        Sent as <span class="font-mono text-foreground">Authorization: Bearer jn_…</span> or
        <span class="font-mono text-foreground">X-API-Key</span>. Stored as argon2id hashes and shown once.
      </template>
      <template #actions>
        <Button size="sm" :disabled="creating" @click="creating = true">
          <Plus />
          Create key
        </Button>
      </template>
    </PageHeader>

    <form
      v-if="creating"
      class="grid items-end gap-3 rounded-lg border bg-card p-4 md:grid-cols-[minmax(180px,1.4fr)_minmax(160px,1fr)_minmax(140px,1fr)_auto]"
      @submit.prevent="create"
    >
      <div class="grid gap-2">
        <Label for="key-name">Name</Label>
        <Input id="key-name" v-model="draft.name" placeholder="work laptop · Claude Code" class="h-8" autofocus />
      </div>
      <div class="grid gap-2">
        <Label>Scope</Label>
        <SearchSelect v-model="draft.endpointId" :options="endpointOptions" trigger-class="h-8" />
      </div>
      <div class="grid gap-2">
        <Label>Expires</Label>
        <SearchSelect v-model="draft.expires" :options="EXPIRY" trigger-class="h-8" />
      </div>
      <div class="flex gap-2">
        <Button type="submit" size="sm" :disabled="busy || draft.name === ''">
          <Loader2 v-if="busy" class="animate-spin" />
          Generate
        </Button>
        <Button type="button" variant="outline" size="sm" @click="creating = false">Cancel</Button>
      </div>
    </form>

    <div v-if="revealed" class="flex flex-col gap-2.5 rounded-lg border border-success/50 bg-success/8 p-4">
      <div class="flex items-center gap-2 font-medium text-success">
        <ShieldCheck class="size-4" />
        Key created — copy it now. It will not be shown again.
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <code class="min-w-60 flex-1 rounded-md border bg-background px-3 py-2 font-mono break-all">
          {{ revealed }}
        </code>
        <Button size="sm" @click="copy">
          <component :is="copied ? Check : Copy" />
          {{ copied ? "Copied" : "Copy" }}
        </Button>
        <Button variant="outline" size="sm" @click="revealed = null">Done</Button>
      </div>
    </div>

    <EmptyState
      v-if="keys.length === 0"
      dashed
      title="No keys yet"
      description="A key authenticates one client against one endpoint, or against all of them."
    />

    <div v-else class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="min-w-44">Name</TableHead>
            <TableHead class="w-40">Prefix</TableHead>
            <TableHead class="w-36">Scope</TableHead>
            <TableHead class="w-32">Last used</TableHead>
            <TableHead class="w-32">Expires</TableHead>
            <TableHead class="w-24 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="key in keys" :key="key.id">
            <TableCell class="max-w-[260px]">
              <div class="truncate font-medium">{{ key.name }}</div>
              <div class="text-xs text-muted-foreground">created {{ shortDate(key.createdAt) }}</div>
            </TableCell>
            <TableCell class="font-mono text-xs whitespace-nowrap text-muted-foreground">{{ key.prefix }}…</TableCell>
            <TableCell class="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
              {{ key.endpointSlug ? `/mcp/${key.endpointSlug}` : "all" }}
            </TableCell>
            <TableCell class="text-muted-foreground">{{ relativeTime(key.lastUsedAt) }}</TableCell>
            <TableCell :class="expiryMeta(key).tone">{{ expiryMeta(key).label }}</TableCell>
            <TableCell class="text-right">
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-muted-foreground hover:border-destructive/50 hover:text-destructive"
                @click="revoke(key)"
              >
                Revoke
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
