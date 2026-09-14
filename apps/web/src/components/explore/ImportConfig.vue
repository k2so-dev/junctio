<script setup lang="ts">
import type { ParsedServer } from "@junctio/schema";
import { parseMcpConfig } from "@junctio/schema";
import { ClipboardPaste, TriangleAlert } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const PLACEHOLDER = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
    }
  }
}`;

const router = useRouter();

const text = ref("");

const parsed = computed(() => parseMcpConfig(text.value));

function add(entry: ParsedServer) {
  if (!entry.draft) return;
  void router.push({
    name: "server-new",
    state: { draft: JSON.stringify(entry.draft), source: entry.key, origin: "import" }
  });
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-xl border bg-card p-4">
    <div class="flex items-start gap-3">
      <ClipboardPaste class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div class="min-w-0">
        <div class="font-medium">Paste a config</div>
        <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Go anywhere below and come back with the snippet the site shows you. Both dialects are read, as are the
          install links VS Code and Cursor hand out. Nothing leaves this page: the config is parsed in your browser and
          nothing is saved until you press save on the next screen.
        </p>
      </div>
    </div>

    <Textarea
      v-model="text"
      rows="6"
      spellcheck="false"
      :placeholder="PLACEHOLDER"
      class="font-mono text-xs"
    />

    <Alert v-if="parsed.error" class="border-warning/50">
      <TriangleAlert class="text-warning" />
      <AlertDescription>{{ parsed.error }}</AlertDescription>
    </Alert>

    <div v-if="parsed.servers.length > 0" class="flex flex-col gap-2">
      <div
        v-for="entry in parsed.servers"
        :key="entry.key"
        class="flex items-start justify-between gap-3 rounded-lg border bg-background/50 p-3"
      >
        <div class="min-w-0">
          <div class="font-medium">{{ entry.key }}</div>
          <div v-if="entry.summary" class="truncate font-mono text-xs text-muted-foreground">{{ entry.summary }}</div>
          <ul v-if="entry.notes.length > 0" class="mt-1 flex flex-col gap-0.5">
            <li v-for="note in entry.notes" :key="note" class="text-xs text-warning">{{ note }}</li>
          </ul>
        </div>
        <Button size="sm" class="h-7 shrink-0" :disabled="!entry.draft" @click="add(entry)">Add</Button>
      </div>
      <Button variant="ghost" size="sm" class="h-7 self-start text-muted-foreground" @click="text = ''">Clear</Button>
    </div>
  </div>
</template>
