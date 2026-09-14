<script setup lang="ts">
import { RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ImportConfig from "@/components/explore/ImportConfig.vue";
import OfficialRegistry from "@/components/explore/OfficialRegistry.vue";
import SourceGroups from "@/components/explore/SourceGroups.vue";
import PageHeader from "@/components/PageHeader.vue";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DESCRIPTIONS: Record<string, string> = {
  official:
    "Servers published to the official MCP registry. The gateway asks for this list only while you are on this page, and keeps the answer for an hour.",
  sources:
    "Everywhere else people publish servers. The gateway indexes none of it, so browse there and come back with the config."
};

const route = useRoute();
const router = useRouter();

const registry = ref<InstanceType<typeof OfficialRegistry> | null>(null);

const tab = computed({
  get: () => (route.query.tab === "sources" ? "sources" : "official"),
  set: (value: string) => {
    void router.replace({ query: value === "official" ? {} : { tab: value } });
  }
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
    <PageHeader title="Explore" :description="DESCRIPTIONS[tab]">
      <template #actions>
        <Button
          v-if="tab === 'official'"
          size="sm"
          variant="outline"
          :disabled="registry?.loading"
          @click="registry?.load(true)"
        >
          <RefreshCw :class="registry?.loading ? 'animate-spin' : ''" />
          Refresh
        </Button>
      </template>
    </PageHeader>

    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="official">Official registry</TabsTrigger>
        <TabsTrigger value="sources">Other sources</TabsTrigger>
      </TabsList>
    </Tabs>

    <OfficialRegistry v-show="tab === 'official'" ref="registry" />

    <div v-if="tab === 'sources'" class="flex flex-col gap-7">
      <ImportConfig />
      <SourceGroups />
    </div>
  </div>
</template>
