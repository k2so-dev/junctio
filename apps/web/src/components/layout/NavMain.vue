<script setup lang="ts">
import { useRoute } from "vue-router";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";
import { type NavBadge, type NavGroup, isItemActive } from "@/lib/nav";
import { cn } from "@/lib/utils";

defineProps<{ groups: NavGroup[]; badges?: Record<string, NavBadge | null> }>();

const route = useRoute();
</script>

<template>
  <SidebarGroup v-for="group in groups" :key="group.label">
    <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem v-for="item in group.items" :key="item.name">
          <SidebarMenuButton
            as-child
            :tooltip="item.label"
            :is-active="isItemActive(item, String(route.name ?? ''))"
          >
            <RouterLink :to="{ name: item.name }">
              <component :is="item.icon" />
              <span>{{ item.label }}</span>
            </RouterLink>
          </SidebarMenuButton>
          <SidebarMenuBadge v-if="badges?.[item.name]" :class="cn('font-mono', badges[item.name]!.class)">
            {{ badges[item.name]!.text }}
          </SidebarMenuBadge>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
