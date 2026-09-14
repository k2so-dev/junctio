<script setup lang="ts">
import { Boxes, Braces, KeyRound, Layers, LogOut, Plug, ScrollText, Settings2 } from "@lucide/vue";
import { computed, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { uptime } from "@/lib/format";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const { health, settings, startHealthPolling, stopHealthPolling, refreshHealth, logout } = useSession();

const items = [
  { name: "servers", label: "Servers", icon: Boxes },
  { name: "namespaces", label: "Namespaces", icon: Layers },
  { name: "endpoints", label: "Endpoints", icon: Plug },
  { name: "api-keys", label: "API Keys", icon: KeyRound },
  { name: "request-log", label: "Request log", icon: ScrollText },
  { name: "settings", label: "Settings", icon: Settings2 }
];

const counts = computed<Record<string, number | null>>(() => ({
  servers: health.value?.servers.total ?? null
}));

const degraded = computed(() => health.value?.status !== "ok");

const healthLine = computed(() => {
  if (!health.value) return "Gateway unreachable";
  const { running, total } = health.value.servers;
  return `${running}/${total} running · up ${uptime(health.value.uptimeSec)}`;
});

const origin = computed(() => {
  const base = settings.value?.baseUrl;
  if (!base) return window.location.host;
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
});

function isActive(name: string) {
  return route.name === name || (name === "servers" && String(route.name ?? "").startsWith("server"));
}

async function signOut() {
  await logout();
  router.push({ name: "login" });
}

onMounted(() => {
  void refreshHealth();
  startHealthPolling();
});
onUnmounted(stopHealthPolling);
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child>
            <RouterLink to="/servers">
              <div class="flex aspect-square size-7 items-center justify-center rounded-md bg-primary">
                <Braces class="size-4 text-primary-foreground" />
              </div>
              <div class="grid flex-1 text-left leading-tight">
                <span class="truncate font-semibold">junctio</span>
                <span class="truncate font-mono text-[11px] text-muted-foreground">
                  v{{ settings?.version ?? "—" }}
                </span>
              </div>
            </RouterLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in items" :key="item.name">
              <SidebarMenuButton as-child :is-active="isActive(item.name)" :tooltip="item.label">
                <RouterLink :to="{ name: item.name }">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </RouterLink>
              </SidebarMenuButton>
              <SidebarMenuBadge v-if="counts[item.name] !== null && counts[item.name] !== undefined" class="font-mono">
                {{ counts[item.name] }}
              </SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <div class="flex flex-col gap-1.5 px-2 py-1 group-data-[collapsible=icon]:hidden">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            class="size-[6px] shrink-0 rounded-full"
            :class="degraded ? 'bg-warning' : 'bg-success'"
          />
          <span class="truncate">{{ healthLine }}</span>
        </div>
        <div class="truncate font-mono text-[11px] text-muted-foreground/70">{{ origin }}</div>
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton as-child tooltip="Sign out">
            <Button variant="ghost" class="justify-start px-2 font-normal" @click="signOut">
              <LogOut />
              <span>Sign out</span>
            </Button>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>
</template>
