<script setup lang="ts">
import type { OAuthClientDto } from "@junctio/schema";
import { Loader2 } from "@lucide/vue";
import { computed, onMounted, reactive, ref } from "vue";
import { toast } from "vue-sonner";
import PageHeader from "@/components/PageHeader.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useSession } from "@/stores/session";

const { settings, refreshSettings } = useSession();

const draft = reactive({
  toolSeparator: "__",
  runtimePath: "",
  apiKeyQueryParam: false,
  requestLogRetentionDays: 7
});

const busy = ref(false);
const clients = ref<OAuthClientDto[]>([]);

const builtinAs = computed(() => settings.value?.authorizationServer === "builtin");

async function loadClients() {
  try {
    clients.value = await api.oauth.clients();
  } catch {
    clients.value = [];
  }
}

async function revokeClient(client: OAuthClientDto) {
  try {
    await api.oauth.removeClient(client.clientId);
    toast.success(`${client.clientName ?? "Client"} revoked`);
    await loadClients();
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

const dirty = computed(() => {
  const current = settings.value;
  if (!current) return false;
  return (
    draft.toolSeparator !== current.toolSeparator ||
    draft.runtimePath !== current.runtimePath ||
    draft.apiKeyQueryParam !== current.apiKeyQueryParam ||
    draft.requestLogRetentionDays !== current.requestLogRetentionDays
  );
});

function reset() {
  const current = settings.value;
  if (!current) return;
  draft.toolSeparator = current.toolSeparator;
  draft.runtimePath = current.runtimePath;
  draft.apiKeyQueryParam = current.apiKeyQueryParam;
  draft.requestLogRetentionDays = current.requestLogRetentionDays;
}

async function save() {
  busy.value = true;
  try {
    await api.settings.patch({ ...draft });
    await refreshSettings();
    toast.success("Settings saved");
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await refreshSettings();
  reset();
  await loadClients();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-6">
    <PageHeader title="Settings">
      <template #description>
        Stored in SQLite. Environment variables (<span class="font-mono text-foreground">JUNCTIO_*</span>) take
        precedence and are shown read-only.
      </template>
      <template #actions>
        <Button variant="outline" size="sm" :disabled="!dirty" @click="reset">Discard</Button>
        <Button size="sm" :disabled="!dirty || busy" @click="save">
          <Loader2 v-if="busy" class="animate-spin" />
          Save changes
        </Button>
      </template>
    </PageHeader>

    <div class="grid max-w-5xl items-start gap-4 lg:grid-cols-2">
      <section class="overflow-hidden rounded-lg border bg-card">
        <header class="flex items-baseline justify-between border-b px-3.5 py-2.5">
          <span class="font-medium">Gateway</span>
          <span class="text-xs text-muted-foreground">read-only, set through the environment</span>
        </header>
        <div class="flex flex-col px-3.5 pb-3">
          <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 border-b py-2.5">
            <div>
              <div>Base URL</div>
              <div class="font-mono text-[10px] text-muted-foreground">JUNCTIO_BASE_URL</div>
            </div>
            <Input :model-value="settings?.baseUrl ?? ''" readonly class="h-8 font-mono text-xs" />
          </div>
          <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 border-b py-2.5">
            <div>
              <div>Authorization server</div>
              <div class="font-mono text-[10px] text-muted-foreground">JUNCTIO_OAUTH_ISSUER</div>
            </div>
            <Input
              :model-value="settings?.oauthIssuer ?? 'built-in'"
              readonly
              class="h-8 font-mono text-xs"
            />
          </div>
          <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 py-2.5">
            <div>Version</div>
            <Input :model-value="settings?.version ?? ''" readonly class="h-8 font-mono text-xs" />
          </div>
        </div>
      </section>

      <section class="overflow-hidden rounded-lg border bg-card">
        <header class="flex items-baseline justify-between border-b px-3.5 py-2.5">
          <span class="font-medium">Child processes</span>
          <span class="text-xs text-muted-foreground">stdio servers</span>
        </header>
        <div class="flex flex-col px-3.5 pb-3">
          <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 py-2.5">
            <Label for="path">PATH</Label>
            <Input id="path" v-model="draft.runtimePath" class="h-8 font-mono text-xs" />
          </div>
          <p class="pb-1 text-xs leading-relaxed text-muted-foreground">
            The only PATH a child process sees. Nothing else from the gateway environment is inherited.
          </p>
        </div>
      </section>

      <section class="overflow-hidden rounded-lg border bg-card">
        <header class="flex items-baseline justify-between border-b px-3.5 py-2.5">
          <span class="font-medium">Aggregation</span>
          <span class="text-xs text-muted-foreground">applies to every namespace</span>
        </header>
        <div class="flex flex-col px-3.5 pb-3">
          <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 border-b py-2.5">
            <Label for="separator">Tool separator</Label>
            <Input id="separator" v-model="draft.toolSeparator" class="h-8 w-24 font-mono text-xs" />
          </div>
          <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 py-2.5">
            <Label for="retention">Request log retention</Label>
            <div class="flex items-center gap-2">
              <Input
                id="retention"
                v-model.number="draft.requestLogRetentionDays"
                type="number"
                min="1"
                max="365"
               
                class="h-8 w-24 font-mono text-xs"
              />
              <span class="text-muted-foreground">days</span>
            </div>
          </div>
        </div>
      </section>

      <section class="overflow-hidden rounded-lg border bg-card">
        <header class="flex items-baseline justify-between border-b px-3.5 py-2.5">
          <span class="font-medium">Downstream auth</span>
          <span class="text-xs text-muted-foreground">clients → gateway</span>
        </header>
        <div class="flex flex-col px-3.5 pb-3">
          <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 py-2.5">
            <Label for="query-param">API key in query</Label>
            <Switch id="query-param" v-model="draft.apiKeyQueryParam" />
          </div>
          <p class="pb-1 text-xs leading-relaxed text-muted-foreground">
            Off by default. Turn it on only for a client that cannot send headers — keys in URLs end up in proxy logs.
          </p>
        </div>
      </section>
    </div>

    <section v-if="builtinAs" class="max-w-5xl overflow-hidden rounded-lg border bg-card">
      <header class="flex items-baseline justify-between border-b px-3.5 py-2.5">
        <span class="font-medium">Connected clients</span>
        <span class="text-xs text-muted-foreground">registered against the built-in authorization server</span>
      </header>
      <p v-if="clients.length === 0" class="px-3.5 py-6 text-center text-muted-foreground">
        No client has completed an authorization flow yet.
      </p>
      <Table v-else>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Redirect</TableHead>
            <TableHead>Tokens</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="client in clients" :key="client.clientId">
            <TableCell class="max-w-[220px]">
              <div class="truncate font-medium">{{ client.clientName ?? "Unnamed client" }}</div>
              <div class="truncate font-mono text-[11px] text-muted-foreground">{{ client.clientId }}</div>
            </TableCell>
            <TableCell class="font-mono text-xs text-muted-foreground">
              <div class="max-w-[240px] truncate">{{ client.redirectUris[0] ?? "—" }}</div>
            </TableCell>
            <TableCell class="font-mono text-muted-foreground">{{ client.tokenCount }}</TableCell>
            <TableCell class="whitespace-nowrap text-muted-foreground">{{ relativeTime(client.lastUsedAt) }}</TableCell>
            <TableCell class="text-right">
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-muted-foreground hover:border-destructive/50 hover:text-destructive"
                @click="revokeClient(client)"
              >
                Revoke
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>
  </div>
</template>
