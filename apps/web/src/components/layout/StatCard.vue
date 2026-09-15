<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import { ArrowUpRight } from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type Tone, TONE_BORDER, TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

withDefaults(
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
</script>

<template>
  <Card
    class="@container/card gap-3 bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card"
    data-slot="stat-card"
  >
    <CardHeader>
      <CardDescription>{{ label }}</CardDescription>
      <CardTitle class="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
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
    <CardFooter class="flex-col items-start gap-1 text-sm">
      <slot name="footer">
        <div v-if="footer" class="line-clamp-1 text-muted-foreground">{{ footer }}</div>
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
