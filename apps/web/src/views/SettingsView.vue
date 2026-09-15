<script setup lang="ts">
import type {
  AuditActionMap,
  AuditOverviewDto,
  OAuthClientDto,
  SanctionAction,
  SanctionSeverity
} from "@junctio/schema";
import { Loader2 } from "@lucide/vue";
import { computed, onMounted, reactive, ref } from "vue";
import { toast } from "vue-sonner";
import CodeBlock from "@/components/CodeBlock.vue";
import PageHeader from "@/components/PageHeader.vue";
import DockerStatus from "@/components/server/DockerStatus.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import ServerAudit from "@/components/server/ServerAudit.vue";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { CLIENTS } from "@/lib/clients";
import { relativeTime } from "@/lib/format";
import { ACTION_LABEL } from "@/lib/status";
import { DEFAULT_ACTIONS } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

const ADMIN_SLUG = "junctio-admin";
const ADMIN_ENV_KEY = "JUNCTIO_ADMIN_TOKEN";
const ADMIN_TOKEN = `$${ADMIN_ENV_KEY}`;

const { settings, refreshSettings } = useSession();

const draft = reactive({
  toolSeparator: "__",
  runtimePath: "",
  apiKeyQueryParam: false,
  requestLogRetentionDays: 7,
  adminMcp: false,
  auditEnabled: false,
  auditIntervalHours: 24,
  auditActions: { ...DEFAULT_ACTIONS } as AuditActionMap
});

const SEVERITIES: SanctionSeverity[] = ["critical", "high", "moderate", "low"];
const ACTIONS: SanctionAction[] = ["ignore", "report", "quarantine", "disable"];

const audit = ref<AuditOverviewDto | null>(null);
const auditBusy = ref(false);

async function loadAudit() {
  try {
    audit.value = await api.audit.overview();
  } catch {
    audit.value = null;
  }
}

async function runAudit() {
  auditBusy.value = true;
  try {
    await api.audit.run();
    toast.success("Audit started");
    setTimeout(loadAudit, 1500);
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    auditBusy.value = false;
  }
}

const adminClient = ref("claude-code");

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
    draft.requestLogRetentionDays !== current.requestLogRetentionDays ||
    draft.adminMcp !== current.adminMcp ||
    draft.auditEnabled !== current.auditEnabled ||
    draft.auditIntervalHours !== current.auditIntervalHours ||
    SEVERITIES.some((severity) => draft.auditActions[severity] !== current.auditActions[severity])
  );
});

const adminGuide = computed(() => {
  const current = settings.value;
  const spec = CLIENTS.find((item) => item.value === adminClient.value);
  if (!current || !spec) return null;
  const kind = spec.prefers === "oauth" && builtinAs.value ? "oauth" : "key";
  return spec.build({
    url: current.adminMcpUrl,
    slug: ADMIN_SLUG,
    kind,
    token: ADMIN_TOKEN,
    queryUrl: null,
    envKey: ADMIN_ENV_KEY
  });
});

function reset() {
  const current = settings.value;
  if (!current) return;
  draft.toolSeparator = current.toolSeparator;
  draft.runtimePath = current.runtimePath;
  draft.apiKeyQueryParam = current.apiKeyQueryParam;
  draft.requestLogRetentionDays = current.requestLogRetentionDays;
  draft.adminMcp = current.adminMcp;
  draft.auditEnabled = current.auditEnabled;
  draft.auditIntervalHours = current.auditIntervalHours;
  draft.auditActions = { ...current.auditActions };
}

async function save() {
  busy.value = true;
  try {
    await api.settings.patch({ ...draft, auditActions: { ...draft.auditActions } });
    await refreshSettings();
    await loadAudit();
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
  await loadAudit();
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
          <span class="font-medium">Docker</span>
          <span class="text-xs text-muted-foreground">JUNCTIO_DOCKER_SOCKET</span>
        </header>
        <div class="flex flex-col gap-2 px-3.5 py-3">
          <DockerStatus />
          <p class="text-xs leading-relaxed text-muted-foreground">
            Needed only by servers with the docker runtime. The gateway talks to the daemon over this socket instead of
            shipping a docker client.
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

    <section class="max-w-5xl overflow-hidden rounded-lg border bg-card">
      <header class="flex items-baseline justify-between border-b px-3.5 py-2.5">
        <span class="font-medium">Security audit</span>
        <span class="text-xs text-muted-foreground">upstream packages</span>
      </header>
      <div class="flex flex-col gap-3 px-3.5 py-3">
        <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
          <Label for="audit-enabled">Audit packages</Label>
          <Switch id="audit-enabled" v-model="draft.auditEnabled" />
        </div>
        <p class="text-xs leading-relaxed text-muted-foreground">
          Off by default. Turned on, the gateway resolves the packages every stdio server runs and checks them against
          the npm advisory database and OSV.dev. Those two are the only outbound calls it makes, and they carry package
          names and versions, nothing else. Container images, custom commands and remote servers cannot be audited.
        </p>

        <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
          <Label for="audit-interval">Run every</Label>
          <div class="flex items-center gap-2">
            <Input
              id="audit-interval"
              v-model.number="draft.auditIntervalHours"
              type="number"
              min="1"
              max="720"
              class="h-8 w-24 font-mono text-xs"
            />
            <span class="text-muted-foreground">hours</span>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <span class="font-medium">What a finding does</span>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-32">Severity</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="severity in SEVERITIES" :key="severity">
                <TableCell class="font-medium capitalize">{{ severity }}</TableCell>
                <TableCell>
                  <Select v-model="draft.auditActions[severity]">
                    <SelectTrigger class="h-8 w-60 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="action in ACTIONS" :key="action" :value="action">
                        {{ ACTION_LABEL[action] }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p class="text-xs leading-relaxed text-muted-foreground">
            A quarantined server is stopped and refuses new calls until a later audit comes back clean or you ignore the
            advisory on the server page. A disabled server stays off until you switch it back on. An advisory without a
            published severity counts as moderate and is shown as unknown.
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span class="text-xs text-muted-foreground">
            <template v-if="audit?.lastRun">
              Last run {{ relativeTime(audit.lastRun.finishedAt ?? audit.lastRun.startedAt) }} ·
              {{ audit.lastRun.vulnerable }} with advisories · {{ audit.lastRun.errors }} failed ·
              {{ audit.lastRun.unsupported }} not audited
            </template>
            <template v-else>Never run</template>
            <template v-if="audit?.nextRunAt"> · next {{ relativeTime(audit.nextRunAt) }}</template>
          </span>
          <Button variant="outline" size="sm" :disabled="!settings?.auditEnabled || auditBusy" @click="runAudit">
            <Loader2 v-if="auditBusy" class="animate-spin" />
            Audit all servers
          </Button>
        </div>

        <div class="border-t pt-3">
          <div class="mb-2 font-medium">The gateway itself</div>
          <ServerAudit target="self" :enabled="settings?.auditEnabled ?? false" @changed="loadAudit" />
        </div>
      </div>
    </section>

    <section class="max-w-5xl overflow-hidden rounded-lg border bg-card">
      <header class="flex items-baseline justify-between border-b px-3.5 py-2.5">
        <span class="font-medium">Management MCP</span>
        <span class="text-xs text-muted-foreground">let an agent run this gateway</span>
      </header>
      <div class="flex flex-col gap-3 px-3.5 py-3">
        <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
          <Label for="admin-mcp">Expose /mcp/_admin</Label>
          <Switch id="admin-mcp" v-model="draft.adminMcp" />
        </div>
        <p class="text-xs leading-relaxed text-muted-foreground">
          Off by default. Turned on, this gateway publishes an MCP server of its own that can add, edit and delete
          servers, namespaces and endpoints, install from the registry and read the logs. It cannot issue or revoke API
          keys, and it cannot switch itself off — that stays here. Every call lands in the request log without an
          endpoint.
        </p>
        <p class="text-xs leading-relaxed text-warning">
          An agent holding this can make the gateway run any command on its host. Hand it out the way you would hand out
          a shell.
        </p>

        <template v-if="settings?.adminMcp">
          <div class="border-t pt-3">
            <div class="font-medium">Connect a client</div>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Authenticate with
              <span class="font-mono text-foreground">JUNCTIO_ADMIN_TOKEN</span>, or, on a client that cannot send
              headers, with the built-in authorization server, which asks for the admin password before it grants
              anything.
            </p>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="item in CLIENTS"
              :key="item.value"
              type="button"
              :title="item.hint"
              :class="
                cn(
                  'rounded-md border px-2.5 py-1 text-xs transition-colors hover:border-ring',
                  adminClient === item.value ? 'border-primary bg-accent font-medium' : 'bg-card text-muted-foreground'
                )
              "
              @click="adminClient = item.value"
            >
              {{ item.label }}
            </button>
          </div>

          <template v-if="adminGuide">
            <p v-if="adminGuide.blocker" class="rounded-lg border border-warning/50 bg-warning/8 p-3 text-xs leading-relaxed">
              {{ adminGuide.blocker }}
            </p>
            <template v-else>
              <CodeBlock
                v-for="block in adminGuide.blocks"
                :key="block.title"
                :title="block.title"
                :code="block.code"
                copyable
              />
              <ul class="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                <li v-for="step in adminGuide.steps" :key="step">{{ step }}</li>
              </ul>
            </template>
          </template>
        </template>
        <p v-else-if="draft.adminMcp" class="text-xs text-muted-foreground">
          Save the change to see how to connect a client.
        </p>
      </div>
    </section>

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
