<script setup lang="ts">
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

defineProps<{ title: string; description?: string; flush?: boolean }>();
</script>

<template>
  <Card class="gap-0 overflow-hidden py-0">
    <CardHeader class="gap-1 border-b py-3 [.border-b]:pb-3">
      <CardTitle class="text-sm font-medium">{{ title }}</CardTitle>
      <CardDescription v-if="description || $slots.description" class="text-xs">
        <slot name="description">{{ description }}</slot>
      </CardDescription>
      <CardAction v-if="$slots.action">
        <slot name="action" />
      </CardAction>
    </CardHeader>
    <CardContent :class="flush ? 'px-0 py-0' : 'divide-y px-4 py-0'">
      <slot />
    </CardContent>
    <CardFooter v-if="$slots.footer" class="flex justify-end gap-2 border-t py-3">
      <slot name="footer" />
    </CardFooter>
  </Card>
</template>
