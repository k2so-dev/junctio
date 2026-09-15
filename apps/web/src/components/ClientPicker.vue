<script setup lang="ts">
import { CLIENTS } from "@/lib/clients";
import { cn } from "@/lib/utils";

const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="flex flex-wrap gap-1.5">
    <button
      v-for="item in CLIENTS"
      :key="item.value"
      type="button"
      :title="item.hint"
      :class="
        cn(
          'rounded-md border px-2.5 py-1 text-xs transition-colors hover:border-ring',
          model === item.value ? 'border-primary bg-accent font-medium' : 'bg-card text-muted-foreground'
        )
      "
      @click="model = item.value"
    >
      {{ item.label }}
    </button>
  </div>
</template>
