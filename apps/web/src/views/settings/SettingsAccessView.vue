<script setup lang="ts">
import type { OAuthClientDto } from "@junctio/schema";
import { Loader2 } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import PageLayout from "@/components/layout/PageLayout.vue";
import SettingsRow from "@/components/settings/SettingsRow.vue";
import SettingsSection from "@/components/settings/SettingsSection.vue";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useSettingsDraft } from "@/composables/useSettingsDraft";

const { draft, dirty, busy, reset, save, settings } = useSettingsDraft(["apiKeyQueryParam"] as const);

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

onMounted(loadClients);
</script>

<template>
  <PageLayout :breadcrumbs="[{ label: 'Settings' }, { label: 'Access' }]">
    <template #actions>
      <Button variant="outline" size="sm" :disabled="!dirty" @click="reset">Discard</Button>
      <Button size="sm" :disabled="!dirty || busy" @click="save">
        <Loader2 v-if="busy" class="animate-spin" />
        Save changes
      </Button>
    </template>

    <SettingsSection class="max-w-5xl" title="Downstream auth" description="Clients → gateway.">
      <SettingsRow label="API key in query" for="query-param">
        <Switch id="query-param" v-model="draft.apiKeyQueryParam" />
        <template #description>
          Off by default. Turn it on only for a client that cannot send headers — keys in URLs end up in proxy logs.
        </template>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      v-if="builtinAs"
      class="max-w-5xl"
      title="Connected clients"
      description="Registered against the built-in authorization server."
      flush
    >
      <p v-if="clients.length === 0" class="px-4 py-8 text-center text-muted-foreground">
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
    </SettingsSection>
  </PageLayout>
</template>
