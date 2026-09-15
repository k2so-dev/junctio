<script setup lang="ts">
import type { AuditSummaryDto } from "@junctio/schema";
import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "@lucide/vue";
import { computed } from "vue";
import { auditMeta, TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    summary: AuditSummaryDto | null;
    quarantined?: boolean;
    label?: boolean;
    compact?: boolean;
    class?: string;
  }>(),
  { quarantined: false, label: true, compact: false }
);

const meta = computed(() => (props.summary ? auditMeta(props.summary, props.compact) : null));

const icon = computed(() => {
  if (props.quarantined) return ShieldX;
  if (!props.summary) return ShieldQuestion;
  if (props.summary.status === "ok") return ShieldCheck;
  if (props.summary.status === "vulnerable") return ShieldAlert;
  return ShieldQuestion;
});

const label = computed(() => {
  if (props.quarantined && props.summary?.status !== "vulnerable") return "Quarantined";
  return meta.value?.label ?? "Never audited";
});

const title = computed(() => (props.summary ? auditMeta(props.summary).label : "Never audited"));

const showLabel = computed(() => {
  if (!props.label) return false;
  return !(props.compact && !props.quarantined && props.summary?.status === "ok");
});

const tooltip = computed(() => (props.quarantined ? `Quarantined: ${title.value}` : title.value));

const tone = computed(() => (props.quarantined ? "destructive" : (meta.value?.tone ?? "muted")));
</script>

<template>
  <span
    :title="tooltip"
    :class="cn('inline-flex max-w-full items-center gap-1.5 text-xs font-medium', TONE_TEXT[tone], props.class)"
  >
    <component :is="icon" class="size-3.5 shrink-0" />
    <span v-if="showLabel" class="truncate">{{ label }}</span>
  </span>
</template>
