<script setup lang="ts">
import type { ApiKeyDto, EndpointAuthMode, EndpointDto, NamespaceDto, ProtocolVersion } from "@junctio/schema";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import CodeBlock from "@/components/CodeBlock.vue";
import EmptyState from "@/components/EmptyState.vue";
import SearchSelect, { type SelectOption } from "@/components/SearchSelect.vue";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

const route = useRoute();
const router = useRouter();

const endpoints = ref<EndpointDto[]>([]);
const namespaces = ref<NamespaceDto[]>([]);
const keys = ref<ApiKeyDto[]>([]);
const client = ref("claude-code");
const keyPick = ref("");
const copied = ref(false);
const creating = ref(false);
const draft = ref({ slug: "", namespaceId: "" });
const busy = ref(false);

const PROTOCOLS: SelectOption<ProtocolVersion>[] = [
  { value: "2025-06-18", label: "2025-06-18", mono: true },
  { value: "2025-11-25", label: "2025-11-25", mono: true }
];

const AUTH_MODES: { value: EndpointAuthMode; label: string; hint: string }[] = [
  { value: "api_key", label: "API key", hint: "Bearer jn_… or X-API-Key. The simple path." },
  { value: "oauth", label: "OAuth", hint: "JWTs validated against your identity provider." },
  { value: "any", label: "Either", hint: "Accepts an API key or a valid token." },
  { value: "none", label: "Open", hint: "No authentication. Localhost only." }
];

const CLIENTS = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
  { value: "claude-ai", label: "claude.ai" }
];

const selectedId = computed(() => {
  const param = typeof route.params.id === "string" ? route.params.id : null;
  if (param && endpoints.value.some((endpoint) => endpoint.id === param)) return param;
  return endpoints.value[0]?.id ?? null;
});

const current = computed(() => endpoints.value.find((endpoint) => endpoint.id === selectedId.value) ?? null);

const namespaceOptions = computed(() =>
  namespaces.value.map((namespace) => ({
    value: namespace.id,
    label: namespace.name,
    hint: `${namespace.servers.length} servers`
  }))
);

const keyOptions = computed(() => [
  { value: "", label: "<paste your key>", mono: true },
  ...keys.value
    .filter((key) => key.endpointId === null || key.endpointId === selectedId.value)
    .map((key) => ({ value: key.id, label: `${key.prefix}… · ${key.name}`, mono: true }))
]);

const keyToken = computed(() => {
  const picked = keys.value.find((key) => key.id === keyPick.value);
  return picked ? `${picked.prefix}...` : "<paste your key>";
});

const snippet = computed(() => {
  const endpoint = current.value;
  if (!endpoint) return "";
  const url = endpoint.url;
  const token = keyToken.value;
  switch (client.value) {
    case "codex":
      return `# ~/.codex/config.toml\n[mcp_servers.junctio]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`;
    case "cursor":
      return `// ~/.cursor/mcp.json\n{\n  "mcpServers": {\n    "junctio": {\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }\n    }\n  }\n}`;
    case "claude-ai":
      return `Settings → Connectors → Add custom connector\n\nRemote MCP server URL:\n${url}\n\nAuthentication: OAuth`;
    default:
      return `claude mcp add --transport http junctio ${url} \\\n  --header "Authorization: Bearer ${token}"`;
  }
});

const snippetWarning = computed(() => {
  const endpoint = current.value;
  if (!endpoint) return null;
  if (client.value === "claude-ai" && endpoint.authMode !== "oauth" && endpoint.authMode !== "any") {
    return "claude.ai connectors authenticate with OAuth. Switch this endpoint to OAuth or Either first.";
  }
  if (client.value !== "claude-ai" && endpoint.authMode === "oauth") {
    return "This endpoint accepts OAuth only, so an API key in the snippet will be rejected.";
  }
  if (keyPick.value !== "" && client.value !== "claude-ai") {
    return "Existing keys are hashed — the snippet can only show the prefix. Create a new key for a paste-ready snippet.";
  }
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
  [endpoints.value, namespaces.value, keys.value] = await Promise.all([
    api.endpoints.list(),
    api.namespaces.list(),
    api.apiKeys.list()
  ]);
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
      protocolMin: "2025-06-18",
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

async function copyUrl() {
  if (!current.value) return;
  await navigator.clipboard.writeText(current.value.url);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1600);
}

watch(namespaceOptions, (options) => {
  if (draft.value.namespaceId === "" && options.length > 0) draft.value.namespaceId = options[0]!.value;
});

onMounted(loadAll);
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside class="flex w-64 shrink-0 flex-col gap-3 overflow-auto border-r p-4">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold tracking-tight">Endpoints</h1>
        <Button variant="outline" size="icon" class="size-7" title="New endpoint" @click="creating = true">
          <Plus class="size-3.5" />
        </Button>
      </div>
      <nav class="flex flex-col gap-0.5">
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
      </nav>
    </aside>

    <div v-if="current" class="flex min-w-0 flex-1 flex-col gap-5 overflow-auto p-6">
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
          <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-destructive" @click="remove">
            <Trash2 />
          </Button>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
      </div>

      <div class="grid gap-2">
        <Label>Auth mode</Label>
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
      </div>

      <div class="flex flex-col gap-3">
        <Tabs v-model="client">
          <TabsList>
            <TabsTrigger v-for="item in CLIENTS" :key="item.value" :value="item.value">{{ item.label }}</TabsTrigger>
          </TabsList>
        </Tabs>

        <p v-if="snippetWarning" class="rounded-lg border border-warning/50 bg-warning/8 p-3 leading-relaxed">
          {{ snippetWarning }}
        </p>

        <div class="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
          <CodeBlock title="Client configuration" :code="snippet" copyable />
          <div class="flex flex-col gap-2.5">
            <div class="grid gap-2">
              <Label>Key in snippet</Label>
              <SearchSelect v-model="keyPick" :options="keyOptions" trigger-class="h-8" />
            </div>
            <Button variant="outline" size="sm" class="self-start" as-child>
              <RouterLink :to="{ name: 'api-keys', query: { endpoint: current.id } }">
                <KeyRound />
                New key for this endpoint
              </RouterLink>
            </Button>
          </div>
        </div>
      </div>
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
  </div>
</template>
