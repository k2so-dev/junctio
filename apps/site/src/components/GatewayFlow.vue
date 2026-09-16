<script setup lang="ts">
import { Bot, Code2, Database, GitBranch, Globe, Terminal } from "@lucide/vue";
import { computed, ref } from "vue";

type Client = { id: string; label: string; icon: typeof Terminal; auth: string; y: number };
type Upstream = { id: string; label: string; icon: typeof GitBranch; y: number };

const clients: Client[] = [
  { id: "claude-code", label: "Claude Code", icon: Terminal, auth: "API key", y: 30 },
  { id: "cursor", label: "Cursor", icon: Code2, auth: "API key", y: 122 },
  { id: "claude-ai", label: "claude.ai", icon: Bot, auth: "OAuth", y: 214 }
];

const upstreams: Upstream[] = [
  { id: "github", label: "GitHub", icon: GitBranch, y: 30 },
  { id: "postgres", label: "Postgres", icon: Database, y: 122 },
  { id: "remote", label: "Remote MCP", icon: Globe, y: 214 }
];

const GATEWAY = { x: 196, y: 110, w: 148, h: 64 };
const CLIENT_W = 140;
const UPSTREAM_X = 400;
const CARD_H = 40;
const MID_Y = GATEWAY.y + GATEWAY.h / 2;
const PAIRS = [
  { client: 0, upstream: 2 },
  { client: 1, upstream: 1 },
  { client: 2, upstream: 0 }
];
const DURATION = 3.6;

const active = ref<string | null>(null);

function inbound(client: Client): string {
  const y0 = client.y + CARD_H / 2;
  const cx = (CLIENT_W + GATEWAY.x) / 2;
  return `M ${CLIENT_W} ${y0} C ${cx} ${y0}, ${cx} ${MID_Y}, ${GATEWAY.x} ${MID_Y}`;
}

function outbound(upstream: Upstream): string {
  const x0 = GATEWAY.x + GATEWAY.w;
  const y1 = upstream.y + CARD_H / 2;
  const cx = (x0 + UPSTREAM_X) / 2;
  return `M ${x0} ${MID_Y} C ${cx} ${MID_Y}, ${cx} ${y1}, ${UPSTREAM_X} ${y1}`;
}

const routes = computed(() =>
  PAIRS.map((pair, index) => {
    const client = clients[pair.client]!;
    const upstream = upstreams[pair.upstream]!;
    const tail = outbound(upstream).replace(/^M [\d.]+ [\d.]+/, `L ${GATEWAY.x + GATEWAY.w} ${MID_Y}`);
    return {
      id: client.id,
      style: {
        offsetPath: `path('${inbound(client)} ${tail}')`,
        animation: `flow-dot ${DURATION}s linear ${(index * DURATION) / PAIRS.length}s infinite backwards`
      }
    };
  })
);

const focused = computed(() => clients.find((client) => client.id === active.value) ?? null);
</script>

<template>
  <div
    class="relative w-full select-none pb-8"
    role="img"
    aria-label="Clients connect to one Junctio endpoint, which fans out to upstream MCP servers"
  >
    <svg viewBox="0 0 540 254" class="h-auto w-full overflow-visible">
      <g class="stroke-border" fill="none" stroke-width="1.25">
        <path v-for="client in clients" :key="`in-${client.id}`" :d="inbound(client)" />
        <path v-for="upstream in upstreams" :key="`out-${upstream.id}`" :d="outbound(upstream)" />
      </g>
      <circle
        v-for="route in routes"
        :key="route.id"
        r="4"
        class="flow-dot fill-foreground transition-opacity duration-300"
        :class="active !== null && active !== route.id ? 'opacity-10' : ''"
        :style="route.style"
      />
      <foreignObject v-for="client in clients" :key="client.id" :x="0" :y="client.y" :width="CLIENT_W" :height="CARD_H">
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
            {{ focused ? `${focused.auth} · one endpoint` : "API key · OAuth · one endpoint" }}
          </span>
        </div>
      </foreignObject>
      <foreignObject
        v-for="upstream in upstreams"
        :key="upstream.id"
        :x="UPSTREAM_X"
        :y="upstream.y"
        :width="140"
        :height="CARD_H"
      >
        <div class="flex h-10 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium">
          <component :is="upstream.icon" class="size-4 shrink-0 text-muted-foreground" />
          <span class="truncate">{{ upstream.label }}</span>
        </div>
      </foreignObject>
    </svg>
    <div
      class="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground"
    >
      <span class="mr-1.5 inline-block size-1.5 rounded-full bg-success align-middle"></span>upstream token refreshed 41 s
      before expiry
    </div>
  </div>
</template>
