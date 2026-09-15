<script setup lang="ts">
import type {
  ApiKeyDto,
  EndpointAuthMode,
  EndpointDto,
  EndpointProtocolUsageDto,
  NamespaceDto,
  ProtocolVersion
} from "@junctio/schema";
import { latestProtocolVersion } from "@junctio/schema";
import { Check, Copy, ExternalLink, KeyRound, Loader2, Plus, Trash2 } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import CodeBlock from "@/components/CodeBlock.vue";
import EmptyState from "@/components/EmptyState.vue";
import PageLayout from "@/components/layout/PageLayout.vue";
import SearchSelect, { type SelectOption } from "@/components/SearchSelect.vue";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { describeError } from "@/composables/useResource";
import { CLIENTS, type AuthKind } from "@/lib/clients";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFreshKeys } from "@/stores/keys";
import { useSession } from "@/stores/session";
import { useCopy } from "@/composables/useCopy";

const route = useRoute();
const router = useRouter();
const { settings } = useSession();
const { tokens: freshTokens } = useFreshKeys();

const endpoints = ref<EndpointDto[]>([]);
const namespaces = ref<NamespaceDto[]>([]);
const keys = ref<ApiKeyDto[]>([]);
const seen = ref<EndpointProtocolUsageDto[]>([]);
const client = ref("claude-code");
const kindPick = ref<AuthKind>("key");
const keyPick = ref("");
const { copy: write, copied } = useCopy();
const creating = ref(false);
const draft = ref({ slug: "", namespaceId: "" });
const busy = ref(false);

const KEY_PLACEHOLDER = "<your-api-key>";
const UNSTATED = "unstated";

const PROTOCOLS: SelectOption<ProtocolVersion>[] = [
  { value: "2026-07-28", label: "2026-07-28", hint: "Modern era only; older clients are refused", mono: true },
  { value: "2025-11-25", label: "2025-11-25", hint: "Both eras; older clients get the handshake", mono: true },
  { value: "2025-06-18", label: "2025-06-18", hint: "Both eras, widest compatibility", mono: true }
];

const AUTH_MODES: { value: EndpointAuthMode; label: string; hint: string }[] = [
  { value: "api_key", label: "API key", hint: "Bearer jn_… or X-API-Key. The simple path." },
  { value: "oauth", label: "OAuth", hint: "The browser flow. Needed for claude.ai connectors." },
  { value: "any", label: "Either", hint: "Accepts an API key or a valid token." },
  { value: "none", label: "Open", hint: "No authentication. Localhost only." }
];

const KINDS: { value: AuthKind; label: string }[] = [
  { value: "key", label: "API key" },
  { value: "oauth", label: "OAuth" }
];

const selectedId = computed(() => {
  const param = typeof route.params.id === "string" ? route.params.id : null;
  if (param && endpoints.value.some((endpoint) => endpoint.id === param)) return param;
  return endpoints.value[0]?.id ?? null;
});

const current = computed(() => endpoints.value.find((endpoint) => endpoint.id === selectedId.value) ?? null);

const endpointOptions = computed(() =>
  endpoints.value.map((endpoint) => ({
    value: endpoint.id,
    label: `/mcp/${endpoint.slug}`,
    hint: endpoint.namespaceName,
    mono: true
  }))
);

function pickEndpoint(value: string) {
  void router.push({ name: "endpoints", params: { id: value } });
}

const namespaceOptions = computed(() =>
  namespaces.value.map((namespace) => ({
    value: namespace.id,
    label: namespace.name,
    hint: `${namespace.servers.length} servers`
  }))
);

const endpointKeys = computed(() =>
  keys.value
    .filter((key) => key.endpointId === null || key.endpointId === selectedId.value)
    .sort((a, b) => Number(freshTokens.has(b.id)) - Number(freshTokens.has(a.id)) || b.createdAt - a.createdAt)
);

const keyOptions = computed(() => [
  { value: "", label: KEY_PLACEHOLDER, hint: "Placeholder to replace by hand", mono: true },
  ...endpointKeys.value.map((key) => ({
    value: key.id,
    label: `${key.prefix}… · ${key.name}`,
    hint: freshTokens.has(key.id) ? "Created this session, paste-ready" : "Prefix only",
    mono: true
  }))
]);

const kind = computed<AuthKind>(() => {
  const mode = current.value?.authMode;
  if (mode === "any") return kindPick.value;
  if (mode === "oauth") return "oauth";
  if (mode === "none") return "none";
  return "key";
});

const token = computed(() => {
  if (keyPick.value === "") return KEY_PLACEHOLDER;
  return freshTokens.get(keyPick.value) ?? KEY_PLACEHOLDER;
});

const guide = computed(() => {
  const endpoint = current.value;
  const spec = CLIENTS.find((item) => item.value === client.value);
  if (!endpoint || !spec) return null;
  const queryUrl = settings.value?.apiKeyQueryParam ? `${endpoint.url}?api_key=${token.value}` : null;
  return spec.build({ url: endpoint.url, slug: endpoint.slug, kind: kind.value, token: token.value, queryUrl });
});

const seenNote = computed(() => {
  if (seen.value.length === 0) return "No client has called this endpoint yet.";
  const rank = (protocol: string) => (protocol === UNSTATED ? "" : protocol);
  const ranked = [...seen.value].sort((a, b) => rank(b.protocol).localeCompare(rank(a.protocol)));
  const spoken = ranked.map((usage) => `${usage.protocol} ×${usage.count}`).join(" · ");
  const last = Math.max(...seen.value.map((usage) => usage.lastSeenAt));
  return `Revisions clients spoke here: ${spoken}. Last call ${relativeTime(last)}. An unstated revision means the client sent neither the header nor an initialize version.`;
});

const refusedNote = computed(() => {
  const floor = current.value?.protocolMin;
  if (!floor) return null;
  const refused = seen.value.filter((usage) => usage.protocol !== UNSTATED && usage.protocol < floor);
  if (refused.length === 0) return null;
  const list = refused.map((usage) => `${usage.protocol} ×${usage.count}`).join(", ");
  return `Turned away for speaking below the minimum: ${list}. Lower Min protocol to let those clients in.`;
});

const keyWarning = computed(() => {
  if (kind.value !== "key" || keyPick.value === "" || freshTokens.has(keyPick.value)) return null;
  return "Keys are stored as hashes, so this one cannot be shown again. The snippet keeps the placeholder; create a new key for a paste-ready one.";
});

const kindNote = computed(() => {
  const mode = current.value?.authMode;
  if (mode === "oauth") return "This endpoint accepts OAuth only, so the snippets skip API keys.";
  if (mode === "none") return "This endpoint is open, so the snippets carry no credentials.";
  return null;
});

const wellKnownNote = computed(() => {
  const mode = current.value?.authMode;
  if (mode === "oauth" || mode === "any") {
    return "Discovery documents under /.well-known/ are served for this endpoint and a 401 carries the resource metadata URL.";
  }
  return "Discovery documents under /.well-known/ return 404 for this endpoint, so no client is sent down an authorization flow that cannot work.";
});

async function loadAll() {
  try {
    [endpoints.value, namespaces.value, keys.value] = await Promise.all([
      api.endpoints.list(),
      api.namespaces.list(),
      api.apiKeys.list()
    ]);
  } catch (error) {
    toast.error(describeError(error));
  }
}

async function loadSeen() {
  const id = selectedId.value;
  if (!id) {
    seen.value = [];
    return;
  }
  try {
    seen.value = await api.endpoints.protocols(id);
  } catch {
    seen.value = [];
  }
}

async function patch(patchBody: Parameters<typeof api.endpoints.patch>[1]) {
  if (!selectedId.value) return;
  try {
    await api.endpoints.patch(selectedId.value, patchBody);
    await loadAll();
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
    await loadAll();
  }
}

async function create() {
  busy.value = true;
  try {
    const created = await api.endpoints.create({
      slug: draft.value.slug,
      namespaceId: draft.value.namespaceId,
      authMode: "api_key",
      protocolMin: latestProtocolVersion,
      rateLimit: { perMinute: 0 },
      enabled: true
    });
    creating.value = false;
    draft.value = { slug: "", namespaceId: "" };
    await loadAll();
    await router.push({ name: "endpoints", params: { id: created.id } });
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!selectedId.value) return;
  try {
    await api.endpoints.remove(selectedId.value);
    toast.success("Endpoint deleted");
    await loadAll();
    await router.push({ name: "endpoints" });
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

function copyUrl() {
  if (!current.value) return;
  void write(current.value.url);
}

watch(namespaceOptions, (options) => {
  if (draft.value.namespaceId === "" && options.length > 0) draft.value.namespaceId = options[0]!.value;
});

watch(client, (value) => {
  const preferred = CLIENTS.find((item) => item.value === value)?.prefers;
  if (preferred && current.value?.authMode === "any") kindPick.value = preferred;
});

watch(
  () => endpointKeys.value.map((key) => key.id).join(","),
  () => {
    if (endpointKeys.value.some((key) => key.id === keyPick.value)) return;
    const fresh = endpointKeys.value.find((key) => freshTokens.has(key.id));
    keyPick.value = fresh?.id ?? "";
  },
  { immediate: true }
);

watch(selectedId, () => {
  void loadSeen();
});

onMounted(async () => {
  await loadAll();
  await loadSeen();
});
</script>

<template>
  <PageLayout
    :breadcrumbs="[
      { label: 'Endpoints', to: { name: 'endpoints' } },
      ...(current ? [{ label: `/mcp/${current.slug}` }] : [])
    ]"
    :padded="false"
  >
    <template #actions>
      <Button size="sm" :disabled="namespaces.length === 0" @click="creating = true">
        <Plus />
        New endpoint
      </Button>
    </template>

    <template v-if="endpoints.length > 0" #toolbar>
      <div class="w-full md:hidden">
        <SearchSelect
          :model-value="selectedId ?? ''"
          :options="endpointOptions"
          placeholder="Pick an endpoint…"
          trigger-class="h-8 w-full"
          @update:model-value="pickEndpoint"
        />
      </div>
      <span class="hidden text-xs text-muted-foreground md:inline">
        An endpoint is the URL you give to a client. It points at one namespace and decides how callers authenticate.
      </span>
    </template>

    <div class="flex min-h-0 flex-1">
      <aside class="hidden w-64 shrink-0 flex-col gap-0.5 overflow-auto border-r p-2 md:flex">
        <RouterLink
          v-for="endpoint in endpoints"
          :key="endpoint.id"
          :to="{ name: 'endpoints', params: { id: endpoint.id } }"
          :class="
            cn(
              'flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-2 hover:bg-accent',
              endpoint.id === selectedId && 'bg-accent'
            )
          "
        >
          <span class="truncate font-mono text-xs font-medium">/mcp/{{ endpoint.slug }}</span>
          <span class="truncate text-xs text-muted-foreground">
            {{ endpoint.namespaceName }} · {{ endpoint.authMode }} · {{ endpoint.keyCount }} keys
          </span>
        </RouterLink>
      </aside>

      <div v-if="current" class="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="truncate font-mono text-lg font-semibold tracking-tight">{{ current.url }}</h2>
            <p class="mt-1 text-muted-foreground">
              Namespace {{ current.namespaceName }} · {{ current.keyCount }} keys · protocol ≥ {{ current.protocolMin }}
            </p>
          </div>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="copyUrl">
              <component :is="copied ? Check : Copy" />
              {{ copied ? "Copied" : "Copy URL" }}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger as-child>
                <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-destructive">
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete /mcp/{{ current.slug }}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every client pointed at this URL stops working, and keys bound to it are left without an endpoint.
                    The namespace and its servers are untouched. This cannot be undone.
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

        <Card class="gap-0 shrink-0 overflow-hidden py-0">
          <CardHeader class="border-b py-3 [.border-b]:pb-3">
            <CardTitle class="text-sm font-medium">Configuration</CardTitle>
          </CardHeader>
          <CardContent class="grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-4">
            <div class="grid gap-2">
              <Label for="slug">Slug</Label>
              <Input
                id="slug"
                :model-value="current.slug"
                class="h-8 font-mono text-xs"
                @change="patch({ slug: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="grid gap-2">
              <Label>Namespace</Label>
              <SearchSelect
                :model-value="current.namespaceId"
                :options="namespaceOptions"
                trigger-class="h-8"
                @update:model-value="patch({ namespaceId: $event })"
              />
            </div>
            <div class="grid gap-2">
              <Label>Min protocol</Label>
              <SearchSelect
                :model-value="current.protocolMin"
                :options="PROTOCOLS"
                trigger-class="h-8"
                @update:model-value="patch({ protocolMin: $event })"
              />
            </div>
            <div class="grid gap-2">
              <Label for="rate">Rate limit <span class="font-normal text-muted-foreground">— 0 = off</span></Label>
              <div class="flex items-center gap-2">
                <Input
                  id="rate"
                  type="number"
                  min="0"
                  :model-value="current.rateLimit.perMinute"
                  class="h-8 font-mono text-xs"
                  @change="patch({ rateLimit: { perMinute: Number(($event.target as HTMLInputElement).value) } })"
                />
                <span class="shrink-0 text-muted-foreground">/min</span>
              </div>
            </div>
            <p class="text-xs leading-relaxed text-muted-foreground sm:col-span-2 xl:col-span-4">{{ seenNote }}</p>
            <p
              v-if="refusedNote"
              class="rounded-lg border border-warning/50 bg-warning/8 p-3 text-xs leading-relaxed sm:col-span-2 xl:col-span-4"
            >
              {{ refusedNote }}
            </p>
          </CardContent>
        </Card>

        <Card class="gap-0 shrink-0 overflow-hidden py-0">
          <CardHeader class="border-b py-3 [.border-b]:pb-3">
            <CardTitle class="text-sm font-medium">Authentication</CardTitle>
          </CardHeader>
          <CardContent class="flex flex-col gap-2 py-4">
            <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <button
                v-for="mode in AUTH_MODES"
                :key="mode.value"
                type="button"
                :class="
                  cn(
                    'rounded-lg border p-3 text-left transition-colors hover:border-ring',
                    current.authMode === mode.value ? 'border-primary bg-accent' : 'bg-card'
                  )
                "
                @click="patch({ authMode: mode.value })"
              >
                <div class="font-medium">{{ mode.label }}</div>
                <div class="mt-0.5 text-xs leading-snug text-muted-foreground">{{ mode.hint }}</div>
              </button>
            </div>
            <p class="text-xs leading-relaxed text-muted-foreground">{{ wellKnownNote }}</p>
          </CardContent>
        </Card>

        <Card class="gap-0 shrink-0 overflow-hidden py-0">
          <CardHeader class="gap-1 border-b py-3 [.border-b]:pb-3">
            <CardTitle class="text-sm font-medium">Connect a client</CardTitle>
            <CardDescription class="text-xs">
              The server is registered under the slug; rename it in the snippet if you like.
            </CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-3 py-4">
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="item in CLIENTS"
                :key="item.value"
                type="button"
                :title="item.hint"
                :class="
                  cn(
                    'rounded-md border px-2.5 py-1 text-xs transition-colors hover:border-ring',
                    client === item.value ? 'border-primary bg-accent font-medium' : 'bg-card text-muted-foreground'
                  )
                "
                @click="client = item.value"
              >
                {{ item.label }}
              </button>
            </div>

            <div class="flex flex-wrap items-end gap-3">
              <div v-if="current.authMode === 'any'" class="grid gap-2">
                <Label>Credentials in snippet</Label>
                <Tabs v-model="kindPick">
                  <TabsList class="h-8">
                    <TabsTrigger v-for="item in KINDS" :key="item.value" :value="item.value" class="text-xs">
                      {{ item.label }}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div v-if="kind === 'key'" class="grid min-w-64 gap-2">
                <Label>Key in snippet</Label>
                <SearchSelect v-model="keyPick" :options="keyOptions" trigger-class="h-8" />
              </div>
              <Button v-if="kind === 'key'" variant="outline" size="sm" class="h-8" as-child>
                <RouterLink :to="{ name: 'api-keys', query: { endpoint: current.id } }">
                  <KeyRound />
                  New key for this endpoint
                </RouterLink>
              </Button>
              <p v-if="kindNote" class="text-xs text-muted-foreground">{{ kindNote }}</p>
            </div>

            <p v-if="keyWarning" class="rounded-lg border border-warning/50 bg-warning/8 p-3 text-xs leading-relaxed">
              {{ keyWarning }}
            </p>

            <template v-if="guide">
              <p v-if="guide.blocker" class="rounded-lg border border-warning/50 bg-warning/8 p-3 leading-relaxed">
                {{ guide.blocker }}
              </p>

              <div v-else class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
                <div class="flex min-w-0 flex-col gap-3">
                  <CodeBlock
                    v-for="block in guide.blocks"
                    :key="block.title"
                    :title="block.title"
                    :code="block.code"
                    copyable
                  />
                  <Button v-if="guide.link" variant="outline" size="sm" class="self-start" as-child>
                    <a :href="guide.link.href">
                      <ExternalLink />
                      {{ guide.link.label }}
                    </a>
                  </Button>
                </div>
                <div class="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3.5">
                  <ol class="flex list-decimal flex-col gap-1.5 pl-4 text-xs leading-relaxed marker:text-muted-foreground">
                    <li v-for="step in guide.steps" :key="step">{{ step }}</li>
                  </ol>
                  <ul
                    v-if="guide.notes.length"
                    class="flex flex-col gap-1.5 border-t pt-3 text-xs leading-relaxed text-muted-foreground"
                  >
                    <li v-for="note in guide.notes" :key="note">{{ note }}</li>
                  </ul>
                </div>
              </div>
            </template>
          </CardContent>
        </Card>
      </div>

      <div v-else class="flex flex-1 items-center justify-center p-6">
        <EmptyState
          dashed
          title="No endpoints"
          description="An endpoint is the URL you give to a client. It points at one namespace and decides how callers authenticate."
        >
          <Button size="sm" :disabled="namespaces.length === 0" @click="creating = true">
            <Plus />
            New endpoint
          </Button>
        </EmptyState>
      </div>
    </div>

    <Dialog v-model:open="creating">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New endpoint</DialogTitle>
          <DialogDescription>The slug becomes the URL path: /mcp/&lt;slug&gt;.</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="create">
          <div class="grid gap-2">
            <Label for="new-slug">Slug</Label>
            <Input id="new-slug" v-model="draft.slug" placeholder="coding" class="font-mono text-xs" autofocus />
          </div>
          <div class="grid gap-2">
            <Label>Namespace</Label>
            <SearchSelect v-model="draft.namespaceId" :options="namespaceOptions" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="creating = false">Cancel</Button>
            <Button type="submit" :disabled="busy || draft.slug === '' || draft.namespaceId === ''">
              <Loader2 v-if="busy" class="animate-spin" />
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </PageLayout>
</template>
