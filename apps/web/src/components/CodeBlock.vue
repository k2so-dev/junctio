<script setup lang="ts">
import { Check, Copy } from "@lucide/vue";
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const props = defineProps<{ title?: string; code: string; copyable?: boolean; class?: string }>();

const copied = ref(false);

async function copy() {
  await navigator.clipboard.writeText(props.code);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1600);
}
</script>

<template>
  <div :class="cn('overflow-hidden rounded-lg border bg-card', props.class)">
    <div v-if="title || copyable" class="flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-3.5">
      <span class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{{ title }}</span>
      <Button v-if="copyable" variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="copy">
        <component :is="copied ? Check : Copy" class="size-3" />
        {{ copied ? "Copied" : "Copy" }}
      </Button>
    </div>
    <pre class="overflow-x-auto p-3.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{{ code }}</pre>
  </div>
</template>
