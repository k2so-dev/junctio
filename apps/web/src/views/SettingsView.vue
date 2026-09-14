<script setup lang="ts">
import { Loader2 } from "@lucide/vue";
import { computed, onMounted, reactive, ref } from "vue";
import { toast } from "vue-sonner";
import PageHeader from "@/components/PageHeader.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { useSession } from "@/stores/session";

const { settings, refreshSettings } = useSession();

const draft = reactive({
  toolSeparator: "__",
  runtimePath: "",
  apiKeyQueryParam: false,
  requestLogRetentionDays: 7
});

const busy = ref(false);

const readOnly = computed(() => settings.value?.configReadOnly ?? false);

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
        <Button size="sm" :disabled="!dirty || busy || readOnly" @click="save">
          <Loader2 v-if="busy" class="animate-spin" />
          Save changes
        </Button>
      </template>
    </PageHeader>

    <p v-if="readOnly" class="rounded-lg border border-warning/50 bg-warning/8 p-3.5 leading-relaxed">
      <span class="font-medium text-warning">GitOps mode.</span>
      Configuration is loaded from a file, so this screen is view-only.
    </p>

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
              <div>OAuth issuer</div>
              <div class="font-mono text-[10px] text-muted-foreground">JUNCTIO_OAUTH_ISSUER</div>
            </div>
            <Input :model-value="settings?.oauthIssuer ?? 'not configured'" readonly class="h-8 font-mono text-xs" />
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
            <Input id="path" v-model="draft.runtimePath" :disabled="readOnly" class="h-8 font-mono text-xs" />
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
            <Input id="separator" v-model="draft.toolSeparator" :disabled="readOnly" class="h-8 w-24 font-mono text-xs" />
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
                :disabled="readOnly"
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
            <Switch id="query-param" v-model="draft.apiKeyQueryParam" :disabled="readOnly" />
          </div>
          <p class="pb-1 text-xs leading-relaxed text-muted-foreground">
            Off by default. Turn it on only for a client that cannot send headers — keys in URLs end up in proxy logs.
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
