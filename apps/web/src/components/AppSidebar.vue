<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import LogoMark from "@/components/layout/LogoMark.vue";
import NavMain from "@/components/layout/NavMain.vue";
import NavSecondary from "@/components/layout/NavSecondary.vue";
import NavUser from "@/components/layout/NavUser.vue";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar
} from "@/components/ui/sidebar";
import { type NavBadge, NAV_GROUPS } from "@/lib/nav";
import { useSession } from "@/stores/session";

const router = useRouter();
const { isMobile, setOpenMobile } = useSidebar();
const { health, startHealthPolling, stopHealthPolling, refreshHealth } = useSession();

const BADGE_DESTRUCTIVE =
  "bg-destructive text-white peer-hover/menu-button:text-white peer-data-[active=true]/menu-button:text-white";
const BADGE_WARNING =
  "bg-warning/15 text-warning peer-hover/menu-button:text-warning peer-data-[active=true]/menu-button:text-warning";

const badges = computed<Record<string, NavBadge | null>>(() => {
  const current = health.value;
  const servers = current ? { text: String(current.servers.total) } : null;

  if (!current || !current.audit.enabled) return { servers, security: null };

  const count = current.audit.vulnerable || current.audit.quarantined;
  if (count === 0) return { servers, security: null };

  const quarantined = current.audit.quarantined > 0 || current.servers.quarantined > 0;
  return {
    servers,
    security: {
      text: String(count),
      class: quarantined ? BADGE_DESTRUCTIVE : BADGE_WARNING,
      dot: quarantined ? "bg-destructive" : "bg-warning"
    }
  };
});

const stopAfterEach = router.afterEach(() => {
  if (isMobile.value) setOpenMobile(false);
});

onMounted(() => {
  void refreshHealth();
  startHealthPolling();
});

onUnmounted(() => {
  stopHealthPolling();
  stopAfterEach();
});
</script>

<template>
  <Sidebar variant="inset" collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child>
            <RouterLink :to="{ name: 'overview' }" class="group-data-[collapsible=icon]:justify-center">
              <LogoMark class="size-8! shrink-0" />
              <span class="truncate text-base font-semibold group-data-[collapsible=icon]:hidden">Junctio</span>
            </RouterLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <NavMain :groups="NAV_GROUPS" :badges="badges" />
      <NavSecondary />
    </SidebarContent>

    <SidebarFooter>
      <NavUser />
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
