<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppSidebar from "@/components/AppSidebar.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useSession } from "@/stores/session";

const route = useRoute();
const { session, ready } = useSession();

const BARE_ROUTES = new Set(["login", "consent"]);

const shell = computed(
  () => ready.value && (session.value?.authenticated ?? false) && !BARE_ROUTES.has(String(route.name))
);
</script>

<template>
  <SidebarProvider
    v-if="shell"
    :style="{
      '--sidebar-width': 'calc(var(--spacing) * 68)',
      '--header-height': 'calc(var(--spacing) * 12)'
    }"
  >
    <AppSidebar />
    <SidebarInset class="flex h-svh min-w-0 flex-col overflow-hidden md:h-[calc(100svh-1rem)]">
      <RouterView />
    </SidebarInset>
  </SidebarProvider>
  <RouterView v-else />
  <Toaster position="bottom-right" rich-colors />
</template>
