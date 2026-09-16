<script setup lang="ts">
import { Check, Copy } from "@lucide/vue";
import { ref } from "vue";

const props = defineProps<{ command: string; label?: string }>();
const copied = ref(false);

async function copy() {
  try {
    await navigator.clipboard.writeText(props.command);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {}
}
</script>

<template>
  <div class="flex items-center gap-2 overflow-hidden rounded-lg border bg-card pl-3.5 font-mono text-[13px]">
    <span class="select-none text-muted-foreground">$</span>
    <code class="min-w-0 flex-1 truncate py-2.5">{{ command }}</code>
    <button
      type="button"
      class="flex h-full shrink-0 items-center gap-1.5 border-l px-3 py-2.5 font-sans text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      :aria-label="label ?? 'Copy command'"
      @click="copy"
    >
      <Check v-if="copied" class="size-3.5" />
      <Copy v-else class="size-3.5" />
      {{ copied ? "Copied" : "Copy" }}
    </button>
  </div>
</template>
