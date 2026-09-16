<script setup lang="ts">
import { ChevronRight, ExternalLink, Settings2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import GithubMark from "@/components/layout/GithubMark.vue";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar
} from "@/components/ui/sidebar";
import { REPOSITORY_URL, SETTINGS_ITEMS } from "@/lib/nav";

const route = useRoute();
const router = useRouter();
const { state, isMobile } = useSidebar();

const onSettings = computed(() => String(route.name ?? "").startsWith("settings"));
const open = ref(true);

watch(onSettings, (value) => {
  if (value) open.value = true;
});

function onTriggerClick(event: MouseEvent) {
  if (state.value === "collapsed" && !isMobile.value) {
    event.preventDefault();
    void router.push({ name: "settings-general" });
  }
}
</script>

<template>
  <SidebarGroup class="pt-0">
    <SidebarGroupContent>
      <SidebarMenu>
        <Collapsible v-model:open="open" as-child class="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger as-child>
              <SidebarMenuButton tooltip="Settings" :is-active="onSettings" @click="onTriggerClick">
                <Settings2 />
                <span>Settings</span>
                <ChevronRight
                  class="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                <SidebarMenuSubItem v-for="item in SETTINGS_ITEMS" :key="item.name">
                  <SidebarMenuSubButton as-child :is-active="route.name === item.name">
                    <RouterLink :to="{ name: item.name }">
                      <span>{{ item.label }}</span>
                    </RouterLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>

        <SidebarMenuItem>
          <SidebarMenuButton as-child tooltip="GitHub">
            <a :href="REPOSITORY_URL" target="_blank" rel="noreferrer">
              <GithubMark />
              <span>GitHub</span>
              <ExternalLink class="ml-auto size-3.5! text-muted-foreground" />
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
