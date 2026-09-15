<script setup lang="ts">
import type { SourceDto } from "@junctio/schema";
import { ArrowUpRight } from "@lucide/vue";
import { computed } from "vue";
import { Badge } from "@/components/ui/badge";
import { sourceHue, sourceIcon, sourceInitials } from "@/lib/sources";

const props = defineProps<{ source: SourceDto }>();

const icon = computed(() => sourceIcon(props.source));
const initials = computed(() => sourceInitials(props.source));
const tint = computed(() => `oklch(0.62 0.16 ${sourceHue(props.source)})`);
</script>

<template>
  <a
    :href="source.url"
    target="_blank"
    rel="noreferrer noopener"
    class="group relative isolate flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-ring"
  >
    <img
      v-if="icon"
      :src="icon"
      alt=""
      aria-hidden="true"
      loading="lazy"
      class="pointer-events-none absolute inset-0 -z-10 size-full scale-[1.8] object-cover opacity-45 blur-2xl saturate-200 transition-transform duration-500 group-hover:scale-[2.1]"
    />
    <div
      v-else
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 -z-10 opacity-35 blur-2xl"
      :style="{ background: tint }"
    />
    <div class="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-card/75 backdrop-blur-xl" />

    <div class="flex items-start gap-3 p-4">
      <div
        class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg"
        :class="icon ? 'bg-background' : 'border bg-background/80'"
      >
        <img v-if="icon" :src="icon" alt="" aria-hidden="true" loading="lazy" class="size-full object-cover" />
        <span v-else class="text-xs font-semibold" :style="{ color: tint }">{{ initials }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate font-medium">{{ source.name }}</span>
          <Badge v-if="source.api" variant="secondary" class="shrink-0 text-[10px]">API</Badge>
          <ArrowUpRight
            class="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
        <p class="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{{ source.description }}</p>
        <p class="mt-1.5 truncate font-mono text-[11px] text-muted-foreground/80">{{ source.host }}</p>
      </div>
    </div>
  </a>
</template>
