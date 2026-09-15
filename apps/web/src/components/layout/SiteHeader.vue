<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export interface Crumb {
  label: string;
  to?: RouteLocationRaw;
}

defineProps<{ title?: string; breadcrumbs?: Crumb[] }>();
</script>

<template>
  <header
    class="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)"
  >
    <div class="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
      <SidebarTrigger class="-ml-1" />
      <Separator orientation="vertical" class="mx-2 data-[orientation=vertical]:h-4" />

      <Breadcrumb v-if="breadcrumbs?.length" class="min-w-0">
        <BreadcrumbList class="flex-nowrap">
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.label">
            <BreadcrumbItem class="min-w-0">
              <BreadcrumbLink v-if="crumb.to && index < breadcrumbs.length - 1" as-child>
                <RouterLink :to="crumb.to">{{ crumb.label }}</RouterLink>
              </BreadcrumbLink>
              <BreadcrumbPage v-else class="truncate text-foreground">{{ crumb.label }}</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator v-if="index < breadcrumbs.length - 1" />
          </template>
        </BreadcrumbList>
      </Breadcrumb>

      <slot v-else name="title">
        <h1 class="truncate text-base font-medium">{{ title }}</h1>
      </slot>

      <div class="ml-auto flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>
