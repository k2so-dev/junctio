<script setup lang="ts">
import type { NamespaceDto, ServerDto, ToolDto } from "@junctio/schema";
import { ChevronRight, Loader2, RefreshCw } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import EmptyState from "@/components/EmptyState.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { statusMeta } from "@/lib/status";
import { useSession } from "@/stores/session";

const props = defineProps<{ server: ServerDto; namespaces: NamespaceDto[] }>();

const { settings } = useSession();

const tools = ref<ToolDto[]>([]);
const fetchedAt = ref<number | null>(null);
const loading = ref(true);
const failed = ref(false);

async function load(refresh = false) {
  loading.value = true;
  failed.value = false;
  try {
    const catalog = await api.servers.tools(props.server.id, refresh);
    tools.value = catalog.tools;
    fetchedAt.value = catalog.fetchedAt;
    if (refresh) toast.success("Catalog refreshed");
  } catch (error) {
    failed.value = true;
    if (refresh && error instanceof ApiError) toast.error(error.message);
  } finally {
    loading.value = false;
  }
}

function annotation(tool: ToolDto, key: string): boolean {
  return Boolean((tool.annotations as Record<string, unknown> | null)?.[key]);
}

function exposedAs(tool: ToolDto): { name: string; namespace: string }[] {
  const separator = settings.value?.toolSeparator ?? "__";
  return props.namespaces.flatMap((namespace) =>
    namespace.servers
      .filter((member) => member.serverId === props.server.id && member.enabled)
      .map((member) => ({ name: `${member.prefix}${separator}${tool.name}`, namespace: namespace.name }))
  );
}

onMounted(() => void load());
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-muted-foreground">
        {{ tools.length }} tools · cache invalidated on notifications/tools/list_changed and on config change
        <span v-if="fetchedAt"> · fetched {{ relativeTime(fetchedAt) }}</span>
      </p>
      <Button variant="outline" size="sm" class="h-7" :disabled="loading" @click="load(true)">
        <component :is="loading ? Loader2 : RefreshCw" :class="loading && 'animate-spin'" class="size-3" />
        Refresh cache
      </Button>
    </div>

    <EmptyState
      v-if="failed"
      dashed
      title="Tool list unavailable"
      :description="`The server is ${statusMeta(server.status).label.toLowerCase()}. Clients keep seeing the last successful list until it recovers.`"
    />

    <div v-else class="overflow-hidden rounded-lg border bg-card">
      <Collapsible v-for="tool in tools" :key="tool.name" class="border-b last:border-b-0">
        <CollapsibleTrigger
          class="group grid w-full grid-cols-[16px_minmax(180px,1fr)_minmax(200px,2fr)_120px] items-center gap-3 px-3.5 py-2.5 text-left hover:bg-accent/40"
        >
          <ChevronRight class="size-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span class="truncate font-mono text-xs">{{ tool.name }}</span>
          <span class="truncate text-muted-foreground">{{ tool.description ?? "—" }}</span>
          <span class="flex flex-wrap justify-end gap-1">
            <Badge v-if="annotation(tool, 'readOnlyHint')" variant="outline" class="text-[10px]">read-only</Badge>
            <Badge v-if="annotation(tool, 'destructiveHint')" variant="outline" class="border-destructive/50 text-[10px] text-destructive">
              destructive
            </Badge>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div class="grid gap-4 px-3.5 pb-3.5 pl-10 md:grid-cols-2">
            <div>
              <div class="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Input schema
              </div>
              <pre class="overflow-x-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre>
            </div>
            <div>
              <div class="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Exposed as</div>
              <div v-for="exposed in exposedAs(tool)" :key="exposed.namespace" class="py-0.5 font-mono text-xs">
                {{ exposed.name }}
                <span class="text-muted-foreground">· {{ exposed.namespace }}</span>
              </div>
              <p v-if="exposedAs(tool).length === 0" class="text-xs text-muted-foreground">
                Not part of any namespace yet.
              </p>
              <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                Hide, rename or rewrite the description per namespace in Namespaces → Tools.
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div v-if="!loading && tools.length === 0" class="p-9 text-center text-muted-foreground">
        This server exposes no tools.
      </div>
    </div>
  </div>
</template>
