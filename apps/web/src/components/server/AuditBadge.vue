<script setup lang="ts">
import type { AuditSummaryDto } from "@junctio/schema";
import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "@lucide/vue";
import { computed } from "vue";
import { Badge } from "@/components/ui/badge";
import { auditMeta, TONE_BORDER, TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    summary: AuditSummaryDto | null;
    quarantined?: boolean;
    label?: boolean;
    compact?: boolean;
    pill?: boolean;
    class?: string;
  }>(),
  { quarantined: false, label: true, compact: false, pill: false }
);

const short = computed(() => props.compact || props.pill);

const meta = computed(() => (props.summary ? auditMeta(props.summary, short.value) : null));

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
  if (props.pill) return props.summary?.status === "vulnerable" || props.summary?.status === "error";
  return !(props.compact && !props.quarantined && props.summary?.status === "ok");
});

const tooltip = computed(() => (props.quarantined ? `Quarantined: ${title.value}` : title.value));

const tone = computed(() => (props.quarantined ? "destructive" : (meta.value?.tone ?? "muted")));
</script>

<template>
  <Badge
    v-if="pill && showLabel"
    variant="outline"
    :title="tooltip"
    :class="
      cn(
        'h-5 max-w-full gap-1 px-1.5 py-0 text-[10px] font-medium',
        TONE_BORDER[tone],
        TONE_TEXT[tone],
        props.class
      )
    "
  >
    <component :is="icon" class="size-3 shrink-0" />
    <span class="truncate">{{ label }}</span>
  </Badge>
  <span
    v-else
    :title="tooltip"
    :class="cn('inline-flex max-w-full items-center gap-1.5 text-xs font-medium', TONE_TEXT[tone], props.class)"
  >
    <component :is="icon" class="size-3.5 shrink-0" />
    <span v-if="showLabel" class="truncate">{{ label }}</span>
  </span>
</template>
