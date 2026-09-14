<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface Definition {
  label: string;
  value: string;
  tone?: string;
}

defineProps<{ items: Definition[]; class?: string }>();
</script>

<template>
  <div :class="cn('rounded-lg border bg-card px-3.5', $props.class)">
    <div
      v-for="(item, index) in items"
      :key="item.label"
      class="grid grid-cols-[150px_minmax(0,1fr)] items-baseline gap-3 py-2.5"
      :class="index < items.length - 1 && 'border-b'"
    >
      <span class="text-muted-foreground">{{ item.label }}</span>
      <span :class="cn('font-mono text-xs break-all', item.tone ?? 'text-foreground')">{{ item.value }}</span>
    </div>
  </div>
</template>
