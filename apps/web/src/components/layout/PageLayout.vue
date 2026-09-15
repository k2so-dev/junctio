<script setup lang="ts">
import SiteHeader, { type Crumb } from "@/components/layout/SiteHeader.vue";

withDefaults(defineProps<{ title?: string; breadcrumbs?: Crumb[]; padded?: boolean }>(), { padded: true });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SiteHeader :title="title" :breadcrumbs="breadcrumbs">
      <template v-if="$slots.title" #title>
        <slot name="title" />
      </template>
      <template #actions>
        <slot name="actions" />
      </template>
    </SiteHeader>

    <div v-if="$slots.toolbar" class="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 lg:px-6">
      <slot name="toolbar" />
    </div>

    <div class="@container/main flex min-h-0 flex-1 flex-col overflow-auto">
      <div v-if="padded" class="flex flex-col gap-4 p-4 md:gap-6 md:p-6">
        <slot />
      </div>
      <slot v-else />
    </div>
  </div>
</template>
