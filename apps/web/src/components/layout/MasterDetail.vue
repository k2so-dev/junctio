<script setup lang="ts" generic="T extends { id: string }">
import { RouterLink } from "vue-router";
import { cn } from "@/lib/utils";

defineProps<{
  items: T[];
  selectedId: string | null;
  routeName: string;
}>();
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside class="hidden w-64 shrink-0 flex-col gap-0.5 overflow-auto border-r p-2 md:flex">
      <RouterLink
        v-for="item in items"
        :key="item.id"
        :to="{ name: routeName, params: { id: item.id } }"
        :class="
          cn(
            'flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-2 hover:bg-accent',
            item.id === selectedId && 'bg-accent'
          )
        "
      >
        <slot name="item" :item="item" />
      </RouterLink>
    </aside>

    <div v-if="$slots.detail && selectedId" class="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-6">
      <slot name="detail" />
    </div>
    <div v-else class="flex flex-1 items-center justify-center p-6">
      <slot name="empty" />
    </div>
  </div>
</template>
