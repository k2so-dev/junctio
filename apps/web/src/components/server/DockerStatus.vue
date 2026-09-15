<script setup lang="ts">
import type { DockerStatusDto } from "@junctio/schema";
import { Loader2, RefreshCw } from "@lucide/vue";
import { onMounted, ref } from "vue";
import CodeBlock from "@/components/CodeBlock.vue";
import StatusDot from "@/components/StatusDot.vue";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

defineProps<{ compact?: boolean }>();

const COMPOSE = `services:
  junctio:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    group_add:
      - "\${DOCKER_GID}"`;

const status = ref<DockerStatusDto | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    status.value = await api.docker.status();
  } catch {
    status.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-2.5 rounded-lg border bg-card p-3.5">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <StatusDot :status="status?.available ? 'running' : 'failed'" />
        <span class="truncate">
          {{ status?.available ? `Docker ${status.version}` : "Docker unreachable" }}
        </span>
      </div>
      <Button variant="ghost" size="sm" class="h-6 shrink-0 px-2 text-xs" :disabled="loading" @click="load">
        <component :is="loading ? Loader2 : RefreshCw" :class="['size-3', loading && 'animate-spin']" />
        Check
      </Button>
    </div>

    <div class="flex justify-between gap-3 text-muted-foreground">
      <span>Socket</span>
      <span class="truncate text-right font-mono text-foreground">{{ status?.socket ?? "—" }}</span>
    </div>
    <div v-if="status?.available" class="flex justify-between gap-3 text-muted-foreground">
      <span>Engine API</span>
      <span class="font-mono text-foreground">{{ status.apiVersion }}</span>
    </div>

    <template v-if="status && !status.available">
      <p class="text-xs leading-relaxed text-warning">{{ status.error }}</p>
      <template v-if="!compact">
        <CodeBlock title="compose.docker.yml" :code="COMPOSE" />
        <p class="text-xs leading-relaxed text-muted-foreground">
          Read the group id with
          <span class="font-mono text-foreground">stat -c %g /var/run/docker.sock</span>. Reaching that socket is
          equivalent to root on the host, so mount it only if you run container servers.
        </p>
      </template>
    </template>
  </div>
</template>
