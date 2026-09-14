<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h1 class="text-lg font-semibold tracking-tight">{{ title }}</h1>
      <p v-if="description" class="mt-1 text-muted-foreground">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
