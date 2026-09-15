<script setup lang="ts">
import { Label } from "@/components/ui/label";

defineProps<{ label: string; hint?: string; for?: string }>();
</script>

<template>
  <div class="grid gap-2 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-4">
    <div class="grid gap-0.5">
      <Label :for="$props.for" class="font-normal">{{ label }}</Label>
      <span v-if="hint" class="font-mono text-[10px] text-muted-foreground">{{ hint }}</span>
    </div>
    <div class="min-w-0">
      <slot />
      <p v-if="$slots.description" class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        <slot name="description" />
      </p>
    </div>
  </div>
</template>
