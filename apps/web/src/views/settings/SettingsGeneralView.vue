<script setup lang="ts">
import { Loader2 } from "@lucide/vue";
import PageLayout from "@/components/layout/PageLayout.vue";
import DockerStatus from "@/components/server/DockerStatus.vue";
import SettingsRow from "@/components/settings/SettingsRow.vue";
import SettingsSection from "@/components/settings/SettingsSection.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsDraft } from "@/composables/useSettingsDraft";

const { draft, dirty, busy, reset, save, settings } = useSettingsDraft([
  "toolSeparator",
  "requestLogRetentionDays",
  "runtimePath"
] as const);
</script>

<template>
  <PageLayout :breadcrumbs="[{ label: 'Settings' }, { label: 'General' }]">
    <template #actions>
      <Button variant="outline" size="sm" :disabled="!dirty" @click="reset">Discard</Button>
      <Button size="sm" :disabled="!dirty || busy" @click="save">
        <Loader2 v-if="busy" class="animate-spin" />
        Save changes
      </Button>
    </template>

    <div class="grid max-w-5xl items-start gap-4 lg:grid-cols-2">
      <SettingsSection title="Gateway" description="Read-only, set through the environment.">
        <SettingsRow label="Base URL" hint="JUNCTIO_BASE_URL">
          <Input :model-value="settings?.baseUrl ?? ''" readonly class="h-8 font-mono text-xs" />
        </SettingsRow>
        <SettingsRow label="Authorization server" hint="JUNCTIO_OAUTH_ISSUER">
          <Input :model-value="settings?.oauthIssuer ?? 'built-in'" readonly class="h-8 font-mono text-xs" />
        </SettingsRow>
        <SettingsRow label="Version">
          <Input :model-value="settings?.version ?? ''" readonly class="h-8 font-mono text-xs" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Aggregation" description="Applies to every namespace.">
        <SettingsRow label="Tool separator" for="separator">
          <Input id="separator" v-model="draft.toolSeparator" class="h-8 w-24 font-mono text-xs" />
        </SettingsRow>
        <SettingsRow label="Request log retention" for="retention">
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
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Child processes" description="stdio servers.">
        <SettingsRow label="PATH" for="path">
          <Input id="path" v-model="draft.runtimePath" class="h-8 font-mono text-xs" />
          <template #description>
            The only PATH a child process sees. Nothing else from the gateway environment is inherited.
          </template>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Docker" description="JUNCTIO_DOCKER_SOCKET">
        <div class="flex flex-col gap-2 py-3">
          <DockerStatus />
          <p class="text-xs leading-relaxed text-muted-foreground">
            Needed only by servers with the docker runtime. The gateway talks to the daemon over this socket instead of
            shipping a docker client.
          </p>
        </div>
      </SettingsSection>
    </div>

    <p class="max-w-5xl text-xs leading-relaxed text-muted-foreground">
      Settings are stored in SQLite. Environment variables (<span class="font-mono text-foreground">JUNCTIO_*</span>)
      take precedence and are shown read-only.
    </p>
  </PageLayout>
</template>
