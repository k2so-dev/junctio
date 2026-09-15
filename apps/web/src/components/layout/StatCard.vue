<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import { ArrowUpRight } from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { computed } from "vue";
import { type Tone, TONE_BORDER, TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    label: string;
    value?: string | number | null;
    loading?: boolean;
    badge?: string | null;
    badgeTone?: Tone;
    footer?: string;
    hint?: string;
    to?: RouteLocationRaw;
    linkLabel?: string;
  }>(),
  { badgeTone: "muted" }
);

const valueClass = computed(() => {
  const text = String(props.value ?? "");
  if (text.length > 14) return "text-lg @[250px]/card:text-xl";
  if (text.length > 7) return "text-xl @[250px]/card:text-2xl";
  return "text-2xl @[250px]/card:text-3xl";
});
</script>

<template>
  <Card
    class="@container/card gap-3 bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card"
    data-slot="stat-card"
  >
    <CardHeader>
      <CardDescription>{{ label }}</CardDescription>
      <CardTitle :class="cn('font-semibold tabular-nums', valueClass)">
        <Skeleton v-if="loading" class="h-7 w-20" />
        <template v-else>{{ value ?? "—" }}</template>
      </CardTitle>
      <CardAction>
        <slot name="badge">
          <Badge
            v-if="badge"
            variant="outline"
            :class="cn('whitespace-nowrap', TONE_TEXT[badgeTone], TONE_BORDER[badgeTone])"
          >
            {{ badge }}
          </Badge>
        </slot>
      </CardAction>
    </CardHeader>
    <CardFooter class="flex-col items-start gap-1 text-xs">
      <slot name="footer">
        <div v-if="footer" class="line-clamp-2 text-muted-foreground">{{ footer }}</div>
      </slot>
      <RouterLink
        v-if="to"
        :to="to"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {{ linkLabel ?? "Open" }}
        <ArrowUpRight class="size-3" />
      </RouterLink>
    </CardFooter>
  </Card>
</template>
