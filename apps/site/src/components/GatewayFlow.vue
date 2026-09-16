<script setup lang="ts">
import { Bot, Code2, Database, GitBranch, Globe, Terminal } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";

type Client = { id: string; label: string; icon: typeof Terminal; auth: string; y: number };
type Upstream = { id: string; label: string; icon: typeof GitBranch; y: number };

const clients: Client[] = [
  { id: "claude-code", label: "Claude Code", icon: Terminal, auth: "API key", y: 30 },
  { id: "cursor", label: "Cursor", icon: Code2, auth: "API key", y: 120 },
  { id: "claude-ai", label: "claude.ai", icon: Bot, auth: "OAuth", y: 210 }
];

const upstreams: Upstream[] = [
  { id: "github", label: "GitHub", icon: GitBranch, y: 30 },
  { id: "postgres", label: "Postgres", icon: Database, y: 120 },
  { id: "remote", label: "Remote MCP", icon: Globe, y: 210 }
];

const GATEWAY = { x: 190, y: 88, w: 150, h: 64 };
const CLIENT_W = 140;
const UPSTREAM_X = 400;

const active = ref<string | null>(null);
const tick = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => {
    tick.value += 1;
  }, 2600);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

function inbound(client: Client): string {
  const x0 = CLIENT_W;
  const y0 = client.y + 20;
  const x1 = GATEWAY.x;
  const y1 = GATEWAY.y + GATEWAY.h / 2;
  const cx = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
}

function outbound(upstream: Upstream): string {
  const x0 = GATEWAY.x + GATEWAY.w;
  const y0 = GATEWAY.y + GATEWAY.h / 2;
  const x1 = UPSTREAM_X;
  const y1 = upstream.y + 20;
  const cx = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
}

const routes = computed(() =>
  clients.map((client, index) => {
    const upstream = upstreams[(index + tick.value) % upstreams.length]!;
    return {
      id: client.id,
      path: `${inbound(client)} ${outbound(upstream).replace(/^M [\d.]+ [\d.]+ /, "L ")}`,
      delay: `${index * 0.9}s`,
      dimmed: active.value !== null && active.value !== client.id
    };
  })
);

const focusedClient = computed(() => clients.find((client) => client.id === active.value) ?? null);
</script>

<template>
  <div class="relative w-full select-none pb-8" role="img" aria-label="Clients connect to one Junctio endpoint, which fans out to upstream MCP servers">
    <svg viewBox="0 0 540 250" class="h-auto w-full overflow-visible">
      <g class="stroke-border" fill="none" stroke-width="1.25">
        <path v-for="client in clients" :key="`in-${client.id}`" :d="inbound(client)" />
        <path v-for="upstream in upstreams" :key="`out-${upstream.id}`" :d="outbound(upstream)" />
      </g>
      <foreignObject
        v-for="client in clients"
        :key="client.id"
        :x="0"
        :y="client.y"
        :width="CLIENT_W"
        height="40"
      >
        <button
          type="button"
          class="flex h-10 w-full items-center gap-2 rounded-lg border bg-card px-3 text-left text-[13px] font-medium transition-colors hover:border-foreground/40"
          :class="active === client.id ? 'border-foreground/60' : ''"
          @mouseenter="active = client.id"
          @mouseleave="active = null"
          @focus="active = client.id"
          @blur="active = null"
        >
          <component :is="client.icon" class="size-4 shrink-0 text-muted-foreground" />
          <span class="truncate">{{ client.label }}</span>
        </button>
      </foreignObject>
      <foreignObject :x="GATEWAY.x" :y="GATEWAY.y" :width="GATEWAY.w" :height="GATEWAY.h">
        <div class="flex h-16 flex-col justify-center rounded-lg border-2 border-foreground bg-card px-3.5">
          <span class="text-sm font-semibold">Junctio</span>
          <span class="text-xs text-muted-foreground">
            {{ focusedClient ? `${focusedClient.auth} · one endpoint` : "API key · OAuth · one endpoint" }}
          </span>
        </div>
      </foreignObject>
      <foreignObject
        v-for="upstream in upstreams"
        :key="upstream.id"
        :x="UPSTREAM_X"
        :y="upstream.y"
        :width="140"
        height="40"
      >
        <div class="flex h-10 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium">
          <component :is="upstream.icon" class="size-4 shrink-0 text-muted-foreground" />
          <span class="truncate">{{ upstream.label }}</span>
        </div>
      </foreignObject>
      <g v-for="route in routes" :key="route.id" class="flow-dot transition-opacity" :class="route.dimmed ? 'opacity-15' : ''">
        <circle r="4" class="fill-foreground">
          <animateMotion :path="route.path" dur="2.6s" repeatCount="indefinite" :begin="route.delay" />
        </circle>
      </g>
    </svg>
    <div class="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground">
      <span class="mr-1.5 inline-block size-1.5 rounded-full bg-success align-middle"></span>upstream token refreshed 41 s before expiry
    </div>
  </div>
</template>
