<script setup lang="ts">
defineProps<{ title: string; description?: string; dashed?: boolean }>();
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-2 rounded-lg border p-9 text-center"
    :class="dashed ? 'border-dashed' : 'bg-card'"
  >
    <p class="font-medium">{{ title }}</p>
    <p v-if="description" class="max-w-md text-muted-foreground">{{ description }}</p>
    <div class="mt-2">
      <slot />
    </div>
  </div>
</template>
