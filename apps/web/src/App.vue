<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppSidebar from "@/components/AppSidebar.vue";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
  <SidebarProvider v-if="shell">
    <AppSidebar />
    <SidebarInset class="min-w-0 overflow-hidden">
      <header class="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:hidden">
        <SidebarTrigger />
        <span class="font-medium">junctio</span>
      </header>
      <RouterView />
    </SidebarInset>
  </SidebarProvider>
  <RouterView v-else />
  <Toaster position="bottom-right" rich-colors />
</template>
