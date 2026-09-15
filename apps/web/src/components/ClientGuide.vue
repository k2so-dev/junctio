<script setup lang="ts">
import type { ClientGuide } from "@/lib/clients";
import CodeBlock from "@/components/CodeBlock.vue";

defineProps<{ guide: ClientGuide | null }>();
</script>

<template>
  <template v-if="guide">
    <p v-if="guide.blocker" class="rounded-lg border border-warning/50 bg-warning/8 p-3 text-xs leading-relaxed">
      {{ guide.blocker }}
    </p>
    <template v-else>
      <CodeBlock v-for="block in guide.blocks" :key="block.title" :title="block.title" :code="block.code" copyable />
      <ul class="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
        <li v-for="step in guide.steps" :key="step">{{ step }}</li>
      </ul>
    </template>
  </template>
</template>
