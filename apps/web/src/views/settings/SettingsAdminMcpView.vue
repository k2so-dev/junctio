<script setup lang="ts">
import { Loader2 } from "@lucide/vue";
import { computed, ref } from "vue";
import CodeBlock from "@/components/CodeBlock.vue";
import PageLayout from "@/components/layout/PageLayout.vue";
import SettingsRow from "@/components/settings/SettingsRow.vue";
import SettingsSection from "@/components/settings/SettingsSection.vue";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CLIENTS } from "@/lib/clients";
import { cn } from "@/lib/utils";
import { useSettingsDraft } from "@/composables/useSettingsDraft";

const ADMIN_SLUG = "junctio-admin";
const ADMIN_ENV_KEY = "JUNCTIO_ADMIN_TOKEN";
const ADMIN_TOKEN = `$${ADMIN_ENV_KEY}`;

const { draft, dirty, busy, reset, save, settings } = useSettingsDraft(["adminMcp"] as const);

const adminClient = ref("claude-code");

const builtinAs = computed(() => settings.value?.authorizationServer === "builtin");

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
</script>

<template>
  <PageLayout :breadcrumbs="[{ label: 'Settings' }, { label: 'Management MCP' }]">
    <template #actions>
      <Button variant="outline" size="sm" :disabled="!dirty" @click="reset">Discard</Button>
      <Button size="sm" :disabled="!dirty || busy" @click="save">
        <Loader2 v-if="busy" class="animate-spin" />
        Save changes
      </Button>
    </template>

    <SettingsSection class="max-w-5xl" title="Management MCP" description="Let an agent run this gateway.">
      <SettingsRow label="Expose /mcp/_admin" for="admin-mcp">
        <Switch id="admin-mcp" v-model="draft.adminMcp" />
      </SettingsRow>
      <div class="flex flex-col gap-2 py-3">
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
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="settings?.adminMcp"
      class="max-w-5xl"
      title="Connect a client"
      description="Authenticate with JUNCTIO_ADMIN_TOKEN, or, on a client that cannot send headers, with the built-in authorization server, which asks for the admin password before it grants anything."
    >
      <div class="flex flex-col gap-3 py-4">
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
          <p
            v-if="adminGuide.blocker"
            class="rounded-lg border border-warning/50 bg-warning/8 p-3 text-xs leading-relaxed"
          >
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
      </div>
    </SettingsSection>

    <p v-else-if="draft.adminMcp" class="max-w-5xl text-xs text-muted-foreground">
      Save the change to see how to connect a client.
    </p>
  </PageLayout>
</template>
