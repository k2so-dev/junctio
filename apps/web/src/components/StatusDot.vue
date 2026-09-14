<script setup lang="ts">
import type { ServerStatus } from "@junctio/schema";
import { computed } from "vue";
import { statusMeta, TONE_BG, TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

const props = withDefaults(defineProps<{ status: ServerStatus; label?: boolean; class?: string }>(), {
  label: true
});

const meta = computed(() => statusMeta(props.status));
</script>

<template>
  <span :class="cn('inline-flex items-center gap-2 font-medium', TONE_TEXT[meta.tone], props.class)">
    <span :class="cn('size-[7px] shrink-0 rounded-full', TONE_BG[meta.tone], meta.pulse && 'animate-pulse')" />
    <template v-if="label">{{ meta.label }}</template>
  </span>
</template>
