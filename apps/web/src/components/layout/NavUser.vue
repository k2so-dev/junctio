<script setup lang="ts">
import { Activity, ChevronsUpDown, ExternalLink, LogOut, RefreshCw } from "@lucide/vue";
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { uptime } from "@/lib/format";
import { REPOSITORY_URL } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

const router = useRouter();
const { isMobile } = useSidebar();
const { health, settings, refreshHealth, logout } = useSession();

const degraded = computed(() => health.value === null || health.value.status !== "ok");

const primary = computed(() => {
  if (!health.value) return "Gateway unreachable";
  const { running, total } = health.value.servers;
  return `${running}/${total} running`;
});

const secondary = computed(() => {
  if (!health.value) return origin.value;
  return `up ${uptime(health.value.uptimeSec)} · ${origin.value}`;
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

async function signOut() {
  await logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <div
              :class="
                cn(
                  'flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg',
                  degraded ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                )
              "
            >
              <Activity class="size-4" />
            </div>
            <div class="grid flex-1 text-left leading-tight">
              <span class="truncate font-medium">{{ primary }}</span>
              <span class="truncate font-mono text-[11px] text-muted-foreground">{{ secondary }}</span>
            </div>
            <ChevronsUpDown class="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-(--reka-dropdown-menu-trigger-width) min-w-56 rounded-lg"
          :side="isMobile ? 'bottom' : 'right'"
          :side-offset="4"
          align="end"
        >
          <DropdownMenuLabel class="font-normal">
            <div class="grid gap-0.5">
              <span class="truncate font-mono text-xs">{{ origin }}</span>
              <a
                :href="`${REPOSITORY_URL}/releases`"
                target="_blank"
                rel="noreferrer"
                class="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Junctio v{{ settings?.version ?? "—" }}
                <ExternalLink class="size-3" />
              </a>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="refreshHealth">
            <RefreshCw />
            Refresh health
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="signOut">
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
