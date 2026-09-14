<script setup lang="ts">
import type { RuntimeKind, ServerInput, UpstreamAuthMode } from "@junctio/schema";
import { ArrowLeft, Eye, EyeOff, Loader2, Plus, X } from "@lucide/vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import CodeBlock from "@/components/CodeBlock.vue";
import SearchSelect from "@/components/SearchSelect.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const { settings } = useSession();

const id = computed(() => (typeof route.params.id === "string" ? route.params.id : null));
const editing = computed(() => id.value !== null);

const form = reactive({
  name: "",
  transport: "stdio" as "stdio" | "http",
  runtime: "npx" as RuntimeKind,
  args: "",
  env: [] as { key: string; value: string }[],
  cwd: "",
  url: "",
  authorization: "",
  authMode: "none" as UpstreamAuthMode,
  oauthScope: "",
  warm: false,
  idleTimeoutSec: 900
});

const showEnv = ref(false);
const prefilledFrom = ref<string | null>(null);
const prefilledBy = ref<"registry" | "import">("registry");
const preview = ref("");
const busy = ref(false);
const loading = ref(false);
const fieldErrors = ref<Record<string, string>>({});

const RUNTIMES = [
  { value: "npx" as const, label: "npx", hint: "npx <args>" },
  { value: "bunx" as const, label: "bunx", hint: "bunx <args>" },
  { value: "uvx" as const, label: "uvx", hint: "uvx <args>" },
  { value: "node" as const, label: "node", hint: "node <args>" },
  { value: "uv" as const, label: "uv", hint: "uv <args>" },
  { value: "custom" as const, label: "custom", hint: "<executable> <args>" }
];

const RUNTIME_SEEDS: Partial<Record<RuntimeKind, string>> = { npx: "-y", uv: "run" };

const ARG_PLACEHOLDERS: Record<RuntimeKind, string> = {
  npx: "-y\n@modelcontextprotocol/server-filesystem\n/data",
  bunx: "mcp-server\n--flag",
  uvx: "mcp-server-fetch",
  node: "/data/server.js",
  uv: "run\nmain.py",
  custom: "/usr/local/bin/my-server\n--flag"
};

const AUTH_MODES: { value: UpstreamAuthMode; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "Public server, no credentials." },
  { value: "header", label: "Static header", hint: "A token you paste once. Encrypted at rest." },
  { value: "oauth", label: "OAuth", hint: "Discovery, DCR and automatic refresh." }
];

function seedArgs(runtime: RuntimeKind, previous: RuntimeKind) {
  const seed = RUNTIME_SEEDS[runtime] ?? "";
  const stale = RUNTIME_SEEDS[previous] ?? "";
  const lines = form.args.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (stale !== "" && lines[0] === stale) lines.shift();
  if (seed !== "" && lines[0] !== seed) lines.unshift(seed);
  form.args = lines.join("\n");
}

const argsWarning = computed(() => {
  const first = form.args.split("\n").map((line) => line.trim()).find((line) => line !== "");
  if (!first || form.runtime === "npx" || form.runtime === "custom") return null;
  if (first !== "-y" && first !== "--yes") return null;
  return `${form.runtime} has no ${first} flag — only npx does. It would be taken as the package name.`;
});

function toInput(): ServerInput {
  const env: Record<string, string> = {};
  for (const entry of form.env) if (entry.key.trim() !== "") env[entry.key.trim()] = entry.value;
  const headers: Record<string, string> = {};
  if (form.transport === "http" && form.authMode === "header" && form.authorization !== "") {
    headers.Authorization = form.authorization;
  }
  return {
    name: form.name,
    transport: form.transport,
    runtime: form.transport === "http" ? "custom" : form.runtime,
    args: form.args.split("\n").map((line) => line.trim()).filter((line) => line !== ""),
    env,
    cwd: form.cwd.trim() === "" ? null : form.cwd.trim(),
    url: form.transport === "http" ? form.url : null,
    headers,
    authMode: form.transport === "http" ? form.authMode : "none",
    oauthScope: form.oauthScope.trim() === "" ? null : form.oauthScope.trim(),
    enabled: true,
    warm: form.warm,
    idleTimeoutSec: form.idleTimeoutSec
  };
}

async function refreshPreview() {
  if (form.transport === "http") {
    preview.value = form.url === "" ? "https://…/mcp" : form.url;
    return;
  }
  try {
    const result = await api.servers.preview({ ...toInput(), name: form.name === "" ? "preview" : form.name });
    preview.value = result.preview;
  } catch {
    preview.value = "Fill in the fields to see the exact command.";
  }
}

watch(
  () => form.runtime,
  (runtime, previous) => seedArgs(runtime, previous)
);

watch(
  () => [form.transport, form.runtime, form.args, form.url] as const,
  () => void refreshPreview(),
  { immediate: false }
);

function addEnv() {
  form.env.push({ key: "", value: "" });
}

function removeEnv(index: number) {
  form.env.splice(index, 1);
}

function applyDraft(draft: ServerInput, source: string, origin: "registry" | "import") {
  form.name = draft.name;
  form.transport = draft.transport;
  form.runtime = draft.runtime;
  form.args = draft.args.join("\n");
  form.env = Object.entries(draft.env).map(([key, value]) => ({ key, value }));
  if (form.env.length === 0) addEnv();
  form.cwd = draft.cwd ?? "";
  form.url = draft.url ?? "";
  form.authMode = draft.authMode;
  form.authorization = draft.headers.Authorization ?? "";
  form.oauthScope = draft.oauthScope ?? "";
  prefilledFrom.value = source;
  prefilledBy.value = origin;
  void refreshPreview();
}

type PendingDraft = { draft: ServerInput; source: string; origin: "registry" | "import" };

function pendingDraft(): PendingDraft | null {
  const state = window.history.state as { draft?: unknown; source?: unknown; origin?: unknown } | null;
  if (typeof state?.draft !== "string") return null;
  try {
    return {
      draft: JSON.parse(state.draft) as ServerInput,
      source: String(state.source ?? "the registry"),
      origin: state.origin === "import" ? "import" : "registry"
    };
  } catch {
    return null;
  }
}

async function load() {
  if (!id.value) {
    const pending = pendingDraft();
    if (pending) {
      applyDraft(pending.draft, pending.source, pending.origin);
      return;
    }
    form.args = RUNTIME_SEEDS[form.runtime] ?? "";
    addEnv();
    void refreshPreview();
    return;
  }
  loading.value = true;
  try {
    const server = await api.servers.get(id.value);
    form.name = server.name;
    form.transport = server.transport;
    form.runtime = server.runtime;
    form.args = server.args.join("\n");
    form.env = Object.entries(server.env).map(([key, value]) => ({ key, value }));
    if (form.env.length === 0) addEnv();
    form.cwd = server.cwd ?? "";
    form.url = server.url ?? "";
    form.authMode = server.authMode;
    form.authorization = server.headers.Authorization ?? "";
    form.oauthScope = server.oauthScope ?? "";
    form.warm = server.warm;
    form.idleTimeoutSec = server.idleTimeoutSec;
    preview.value = server.commandPreview;
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    loading.value = false;
  }
}

function applyErrors(details: unknown) {
  fieldErrors.value = {};
  const issues = (details as { issues?: { path: (string | number)[]; message: string }[] } | null)?.issues;
  if (!issues) return;
  for (const issue of issues) fieldErrors.value[String(issue.path[0] ?? "")] = issue.message;
}

async function submit() {
  busy.value = true;
  fieldErrors.value = {};
  try {
    const input = toInput();
    if (editing.value && id.value) {
      await api.servers.patch(id.value, input);
      toast.success(`${input.name} updated`);
      await router.push({ name: "server", params: { id: id.value } });
    } else {
      const created = await api.servers.create(input);
      toast.success(`${created.name} added`);
      await router.push({ name: "server", params: { id: created.id } });
    }
  } catch (error) {
    if (error instanceof ApiError) {
      applyErrors(error.details);
      toast.error(error.message);
    }
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-auto p-6">
    <Button variant="ghost" size="sm" class="mb-3 -ml-2 self-start text-muted-foreground" @click="router.back()">
      <ArrowLeft />
      Servers
    </Button>

    <h1 class="text-lg font-semibold tracking-tight">{{ editing ? "Edit server" : "Add server" }}</h1>
    <p class="mt-1 text-muted-foreground">
      The process gets an explicit PATH and only the env you set here. Nothing from the gateway leaks in.
    </p>
    <p v-if="prefilledFrom" class="mt-2 rounded-lg border bg-card px-3 py-2 text-muted-foreground">
      {{ prefilledBy === "import" ? "Prefilled from the config you pasted, entry" : "Prefilled from the registry entry" }}
      <span class="font-mono text-foreground">{{ prefilledFrom }}</span
      >. Nothing is saved until you press save, so fill in the secrets and check the command first.
    </p>
    <div class="mb-6" />

    <div class="grid items-start gap-7 lg:grid-cols-[minmax(320px,540px)_minmax(280px,1fr)]">
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="name">Name</Label>
          <Input id="name" v-model="form.name" placeholder="e.g. filesystem" />
          <p v-if="fieldErrors.name" class="text-xs text-destructive">{{ fieldErrors.name }}</p>
        </div>

        <div class="grid gap-2">
          <Label>Transport</Label>
          <Tabs v-model="form.transport">
            <TabsList>
              <TabsTrigger value="stdio">stdio</TabsTrigger>
              <TabsTrigger value="http">Streamable HTTP</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <template v-if="form.transport === 'stdio'">
          <div class="grid gap-2 sm:max-w-[220px]">
            <Label>Runtime</Label>
            <SearchSelect v-model="form.runtime" :options="RUNTIMES" />
          </div>

          <div class="grid gap-2">
            <Label for="args">
              Arguments
              <span class="font-normal text-muted-foreground">— one per line</span>
            </Label>
            <Textarea
              id="args"
              v-model="form.args"
              rows="4"
              :placeholder="ARG_PLACEHOLDERS[form.runtime]"
              class="font-mono text-xs"
            />
            <p v-if="fieldErrors.args" class="text-xs text-destructive">{{ fieldErrors.args }}</p>
            <p v-else-if="argsWarning" class="text-xs text-warning">{{ argsWarning }}</p>
          </div>

          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>Environment</Label>
              <Button type="button" variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="showEnv = !showEnv">
                <component :is="showEnv ? EyeOff : Eye" class="size-3" />
                {{ showEnv ? "Hide values" : "Show values" }}
              </Button>
            </div>
            <div
              v-for="(entry, index) in form.env"
              :key="index"
              class="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2"
            >
              <Input v-model="entry.key" placeholder="KEY" class="h-8 font-mono text-xs" />
              <Input
                v-model="entry.value"
                :type="showEnv ? 'text' : 'password'"
                placeholder="value"
                class="h-8 font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" class="size-8" @click="removeEnv(index)">
                <X class="size-3.5" />
              </Button>
            </div>
            <Button type="button" variant="outline" size="sm" class="h-7 self-start border-dashed" @click="addEnv">
              <Plus class="size-3" />
              Add variable
            </Button>
          </div>

          <div class="grid gap-2">
            <Label for="cwd">
              Working directory
              <span class="font-normal text-muted-foreground">— optional</span>
            </Label>
            <Input id="cwd" v-model="form.cwd" placeholder="/data" class="font-mono text-xs" />
          </div>
        </template>

        <template v-else>
          <div class="grid gap-2">
            <Label for="url">URL</Label>
            <Input id="url" v-model="form.url" placeholder="https://mcp.linear.app/mcp" class="font-mono text-xs" />
            <p v-if="fieldErrors.url" class="text-xs text-destructive">{{ fieldErrors.url }}</p>
          </div>

          <div class="grid gap-2">
            <Label>Auth</Label>
            <div class="grid gap-2 sm:grid-cols-3">
              <button
                v-for="mode in AUTH_MODES"
                :key="mode.value"
                type="button"
                :class="
                  cn(
                    'rounded-lg border p-3 text-left transition-colors hover:border-ring',
                    form.authMode === mode.value ? 'border-primary bg-accent' : 'bg-card'
                  )
                "
                @click="form.authMode = mode.value"
              >
                <div class="font-medium">{{ mode.label }}</div>
                <div class="mt-0.5 text-xs leading-snug text-muted-foreground">{{ mode.hint }}</div>
              </button>
            </div>
          </div>

          <div v-if="form.authMode === 'header'" class="grid gap-2">
            <Label for="authorization">Authorization header</Label>
            <Input
              id="authorization"
              v-model="form.authorization"
              type="password"
              placeholder="Bearer sntrys_…"
              class="font-mono text-xs"
            />
          </div>

          <template v-if="form.authMode === 'oauth'">
            <div class="grid gap-2">
              <Label for="scope">
                Scope
                <span class="font-normal text-muted-foreground">— optional</span>
              </Label>
              <Input id="scope" v-model="form.oauthScope" placeholder="read write" class="font-mono text-xs" />
            </div>
            <p class="rounded-lg border bg-card p-3 leading-relaxed text-muted-foreground">
              Discovery (RFC 9728 → 8414) and dynamic client registration run when you start the flow. You sign in at
              the provider once; after that the gateway refreshes tokens on its own.
            </p>
          </template>
        </template>

        <template v-if="form.transport === 'stdio'">
          <div class="flex items-center gap-3 pt-1">
            <Switch v-model="form.warm" />
            <span>
              <span class="font-medium">Warm start</span>
              <span class="text-muted-foreground"> — spawn at boot instead of on first request</span>
            </span>
          </div>

          <div class="flex items-center gap-3">
            <Label for="idle" class="w-40 shrink-0">Idle timeout</Label>
            <Input
              id="idle"
              v-model.number="form.idleTimeoutSec"
              type="number"
              min="0"
              class="h-8 w-28 font-mono text-xs"
            />
            <span class="text-muted-foreground">seconds, 0 = never</span>
          </div>
        </template>

        <div class="flex gap-2 border-t pt-4">
          <Button type="submit" :disabled="busy || loading">
            <Loader2 v-if="busy" class="animate-spin" />
            {{ editing ? "Save changes" : "Save server" }}
          </Button>
          <Button type="button" variant="outline" @click="router.back()">Cancel</Button>
        </div>
      </form>

      <div class="flex flex-col gap-3 lg:sticky lg:top-6">
        <CodeBlock :title="form.transport === 'stdio' ? 'Resulting command' : 'Endpoint'" :code="preview" />
        <div
          v-if="form.transport === 'stdio'"
          class="flex flex-col gap-2 rounded-lg border bg-card p-3.5 text-muted-foreground"
        >
          <div class="flex justify-between gap-3">
            <span>PATH</span>
            <span class="text-right font-mono break-all text-foreground">{{ settings?.runtimePath ?? "—" }}</span>
          </div>
          <div class="flex justify-between gap-3">
            <span>Idle timeout</span>
            <span class="font-mono text-foreground">
              {{ form.idleTimeoutSec === 0 ? "never" : `${form.idleTimeoutSec}s` }}
            </span>
          </div>
          <div class="flex justify-between gap-3">
            <span>Restart policy</span>
            <span class="font-mono text-foreground">backoff 1s→60s, 10 tries</span>
          </div>
          <div class="flex justify-between gap-3">
            <span>Inherited env</span>
            <span class="font-mono text-foreground">none</span>
          </div>
        </div>
        <div v-else class="flex flex-col gap-2 rounded-lg border bg-card p-3.5 text-muted-foreground">
          <div class="flex justify-between gap-3">
            <span>Protocol</span>
            <span class="font-mono text-foreground">Streamable HTTP</span>
          </div>
          <div class="flex justify-between gap-3">
            <span>On 401</span>
            <span class="font-mono text-foreground">refresh once, retry once</span>
          </div>
          <div class="flex justify-between gap-3">
            <span>Callback</span>
            <span class="text-right font-mono break-all text-foreground">/oauth/upstream/callback</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
