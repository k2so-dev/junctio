<script setup lang="ts">
import type { LogLineDto } from "@junctio/schema";
import { Pause, Play, Trash2 } from "@lucide/vue";
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { clockTime } from "@/lib/format";
import { api } from "@/lib/api";

const props = defineProps<{ serverId: string }>();

const lines = ref<LogLineDto[]>([]);
const paused = ref(false);
const connected = ref(false);
const viewport = ref<HTMLElement | null>(null);

let source: EventSource | null = null;

const STREAM_CLASS: Record<LogLineDto["stream"], string> = {
  stdout: "text-muted-foreground",
  stderr: "text-warning",
  system: "text-success"
};

function atBottom(): boolean {
  const element = viewport.value;
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < 40;
}

function connect() {
  source?.close();
  lines.value = [];
  source = new EventSource(api.servers.logStreamUrl(props.serverId));
  source.onopen = () => (connected.value = true);
  source.onerror = () => (connected.value = false);
  source.onmessage = (event) => {
    if (paused.value) return;
    const stick = atBottom();
    lines.value = [...lines.value, JSON.parse(event.data) as LogLineDto].slice(-500);
    if (stick) void scrollToEnd();
  };
}

async function scrollToEnd() {
  await nextTick();
  const element = viewport.value;
  if (element) element.scrollTop = element.scrollHeight;
}

watch(() => props.serverId, connect);

onMounted(connect);
onUnmounted(() => source?.close());
</script>

<template>
  <div class="flex min-h-[420px] flex-1 flex-col gap-2.5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3 text-muted-foreground">
        <span class="inline-flex items-center gap-2" :class="connected ? 'text-success' : 'text-muted-foreground'">
          <span class="size-[6px] rounded-full" :class="connected ? 'animate-pulse bg-success' : 'bg-muted-foreground'" />
          {{ connected ? (paused ? "Paused" : "Live") : "Disconnected" }}
        </span>
        <span class="font-mono text-xs">stdout + stderr · tail 200</span>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" class="h-7" @click="paused = !paused">
          <component :is="paused ? Play : Pause" class="size-3" />
          {{ paused ? "Resume" : "Pause" }}
        </Button>
        <Button variant="outline" size="sm" class="h-7" @click="lines = []">
          <Trash2 class="size-3" />
          Clear
        </Button>
      </div>
    </div>
    <div
      ref="viewport"
      class="min-h-0 flex-1 overflow-auto rounded-lg border bg-background py-2.5 font-mono text-xs leading-relaxed"
    >
      <div
        v-for="(line, index) in lines"
        :key="index"
        class="grid grid-cols-[76px_54px_minmax(0,1fr)] gap-3 px-3.5 hover:bg-accent/40"
      >
        <span class="text-muted-foreground/60">{{ clockTime(line.ts) }}</span>
        <span :class="STREAM_CLASS[line.stream]">{{ line.stream }}</span>
        <span class="break-words whitespace-pre-wrap">{{ line.line }}</span>
      </div>
      <div v-if="lines.length === 0" class="p-9 text-center text-muted-foreground">
        No output yet. Logs appear once the process writes something.
      </div>
    </div>
  </div>
</template>
