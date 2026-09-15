<script setup lang="ts">
import { Loader2 } from "@lucide/vue";
import SettingsRow from "@/components/settings/SettingsRow.vue";
import SettingsSection from "@/components/settings/SettingsSection.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACTIONS, SEVERITIES } from "@/lib/audit";
import { ACTION_LABEL } from "@/lib/status";
import { useSettingsDraft } from "@/composables/useSettingsDraft";

const emit = defineEmits<{ saved: [] }>();

const { draft, dirty, busy, reset, save } = useSettingsDraft([
  "auditEnabled",
  "auditIntervalHours",
  "auditActions"
] as const);

async function submit() {
  if (await save()) emit("saved");
}
</script>

<template>
  <SettingsSection title="Policy" description="What the audit checks and what a finding does.">
    <SettingsRow label="Audit packages" for="audit-enabled">
      <Switch id="audit-enabled" v-model="draft.auditEnabled" />
      <template #description>
        Off by default. Turned on, the gateway resolves the packages every stdio server runs and checks them against the
        npm advisory database and OSV.dev. Those two are the only outbound calls it makes, and they carry package names
        and versions, nothing else. Container images, custom commands and remote servers cannot be audited.
      </template>
    </SettingsRow>

    <SettingsRow label="Run every" for="audit-interval">
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
    </SettingsRow>

    <div class="flex flex-col gap-2 py-3">
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
              <Select v-if="draft.auditActions" v-model="draft.auditActions[severity]">
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

    <template #footer>
      <Button variant="outline" size="sm" :disabled="!dirty" @click="reset">Discard</Button>
      <Button size="sm" :disabled="!dirty || busy" @click="submit">
        <Loader2 v-if="busy" class="animate-spin" />
        Save policy
      </Button>
    </template>
  </SettingsSection>
</template>
