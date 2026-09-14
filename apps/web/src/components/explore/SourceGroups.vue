<script setup lang="ts">
import { ChevronRight } from "@lucide/vue";
import SourceCard from "@/components/explore/SourceCard.vue";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { sourceSections } from "@/lib/sources";

const sections = sourceSections();
</script>

<template>
  <div class="flex flex-col gap-7">
    <template v-for="section in sections" :key="section.id">
      <Collapsible v-if="section.collapsed" :default-open="false" class="flex flex-col gap-3">
        <CollapsibleTrigger class="group flex items-center gap-2 self-start text-left">
          <ChevronRight class="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span class="font-medium">{{ section.title }}</span>
          <span class="font-mono text-xs text-muted-foreground">{{ section.sources.length }}</span>
        </CollapsibleTrigger>
        <CollapsibleContent class="flex flex-col gap-3">
          <p class="text-xs text-muted-foreground">{{ section.description }}</p>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SourceCard v-for="source in section.sources" :key="source.id" :source="source" />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <section v-else class="flex flex-col gap-3">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="font-medium">{{ section.title }}</h2>
            <span class="font-mono text-xs text-muted-foreground">{{ section.sources.length }}</span>
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground">{{ section.description }}</p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SourceCard v-for="source in section.sources" :key="source.id" :source="source" />
        </div>
      </section>
    </template>
  </div>
</template>
