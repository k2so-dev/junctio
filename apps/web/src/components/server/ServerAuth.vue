<script setup lang="ts">
import type { ServerDto } from "@junctio/schema";
import { ExternalLink, Loader2, RefreshCw, Trash2 } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { toast } from "vue-sonner";
import DefinitionList from "@/components/DefinitionList.vue";
import EmptyState from "@/components/EmptyState.vue";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { countdown, relativeTime } from "@/lib/format";
import { TONE_BG, TONE_BORDER, TONE_TEXT, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

const props = defineProps<{ server: ServerDto }>();
const emit = defineEmits<{ changed: [] }>();

const now = ref(Date.now());
const refreshing = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const oauth = computed(() => props.server.oauth);

const remaining = computed(() => {
  const expiresAt = oauth.value?.expiresAt;
  return expiresAt === null || expiresAt === undefined ? null : expiresAt - now.value;
});

const tone = computed<Tone>(() => {
  const status = oauth.value?.status;
  if (status === "needs_reauth") return "destructive";
  if (status === "no_refresh") return "warning";
  if (status === "expiring") return "warning";
  return "success";
});

const tokenStatus = computed(() => {
  switch (oauth.value?.status) {
    case "needs_reauth":
      return "Needs re-auth";
    case "no_refresh":
      return "No refresh token";
    case "expiring":
      return "Refreshing soon";
    default:
      return "Healthy";
  }
});

const countdownHint = computed(() => {
  if (!oauth.value) return "";
  if (oauth.value.status === "needs_reauth") return "Sign in again to restore this connection.";
  if (!oauth.value.hasRefreshToken) return "No refresh token — a manual re-login will be required.";
  return "The scheduler refreshes before this reaches zero.";
});

const rows = computed(() => {
  const info = oauth.value;
  if (!info) return [];
  return [
    { label: "Mode", value: "OAuth 2.1 with PKCE" },
    { label: "Scope", value: info.scope ?? "not requested" },
    { label: "Refresh token", value: info.hasRefreshToken ? "present" : "absent" },
    { label: "Expires at", value: info.expiresAt ? new Date(info.expiresAt).toISOString() : "unknown" },
    { label: "Last refresh", value: relativeTime(info.lastRefreshAt) },
    {
      label: "Last error",
      value: info.lastError ?? "none",
      tone: info.lastError ? "text-destructive" : undefined
    }
  ];
});

async function start() {
  try {
    const { authorizationUrl } = await api.servers.oauthStart(props.server.id);
    window.location.href = authorizationUrl;
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

async function refreshNow() {
  refreshing.value = true;
  try {
    const result = await api.servers.oauthRefresh(props.server.id);
    if (result.refreshed) toast.success("Access token refreshed");
    else toast.warning("Refresh did not run — check the status below");
    emit("changed");
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  } finally {
    refreshing.value = false;
  }
}

async function revoke() {
  try {
    await api.servers.oauthClear(props.server.id);
    toast.success("Stored tokens cleared");
    emit("changed");
  } catch (error) {
    if (error instanceof ApiError) toast.error(error.message);
  }
}

onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});
</script>

<template>
  <EmptyState
    v-if="server.transport === 'stdio'"
    dashed
    title="No upstream auth"
    description="A stdio server runs as a child process and inherits credentials from the environment you configured, not from an authorization server."
  />

  <div v-else-if="server.authMode === 'none'" class="max-w-xl">
    <EmptyState dashed title="No upstream auth" description="This server is configured as public." />
  </div>

  <div v-else-if="server.authMode === 'header'" class="flex max-w-xl flex-col gap-3.5">
    <DefinitionList
      :items="[
        { label: 'Mode', value: 'Static header' },
        { label: 'Authorization', value: server.headers.Authorization ?? 'not set' },
        { label: 'Storage', value: 'AES-GCM, key from JUNCTIO_SECRET' }
      ]"
    />
    <p class="leading-relaxed text-muted-foreground">
      Static tokens do not expire on their own. If the upstream starts returning 401 the server keeps failing until you
      paste a new token.
    </p>
    <Button variant="outline" size="sm" class="self-start" as-child>
      <RouterLink :to="{ name: 'server-edit', params: { id: server.id } }">Rotate token</RouterLink>
    </Button>
  </div>

  <div v-else class="grid items-start gap-5 lg:grid-cols-[minmax(300px,1.2fr)_minmax(260px,1fr)]">
    <div class="flex flex-col gap-3.5">
      <div :class="cn('flex flex-col gap-3.5 rounded-lg border bg-card p-4.5', TONE_BORDER[tone])">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xs text-muted-foreground">Access token</div>
            <div :class="cn('mt-1 font-mono text-3xl tracking-tight', TONE_TEXT[tone])">
              {{ remaining === null ? "—" : countdown(remaining) }}
            </div>
            <div class="mt-1 text-muted-foreground">{{ countdownHint }}</div>
          </div>
          <span
            :class="
              cn(
                'inline-flex h-6 items-center gap-2 rounded-full border px-2.5 text-xs font-medium',
                TONE_BORDER[tone],
                TONE_TEXT[tone]
              )
            "
          >
            <span :class="cn('size-[6px] rounded-full', TONE_BG[tone])" />
            {{ tokenStatus }}
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="oauth?.hasRefreshToken"
            variant="outline"
            size="sm"
            :disabled="refreshing"
            @click="refreshNow"
          >
            <component :is="refreshing ? Loader2 : RefreshCw" :class="refreshing && 'animate-spin'" />
            Refresh now
          </Button>
          <Button size="sm" :variant="oauth?.status === 'ok' ? 'outline' : 'default'" @click="start">
            <ExternalLink />
            Re-login
          </Button>
          <Button variant="ghost" size="sm" class="text-muted-foreground hover:text-destructive" @click="revoke">
            <Trash2 />
            Revoke
          </Button>
        </div>
      </div>
      <DefinitionList :items="rows" />
    </div>

    <div class="flex flex-col gap-3.5">
      <div
        v-if="oauth && oauth.status !== 'ok'"
        :class="cn('rounded-lg border p-3.5', TONE_BORDER[tone], tone === 'destructive' ? 'bg-destructive/8' : 'bg-warning/8')"
      >
        <div :class="cn('font-medium', TONE_TEXT[tone])">{{ tokenStatus }}</div>
        <p class="mt-1 leading-relaxed">
          {{
            oauth.status === "needs_reauth"
              ? "The authorization server rejected the refresh token. Tools from this server are hidden from clients until you sign in again."
              : "This provider issued no refresh token. When the access token expires you will have to sign in again by hand."
          }}
        </p>
      </div>
      <p class="text-xs leading-relaxed text-muted-foreground">
        The scheduler runs every 60s and refreshes when
        <span class="font-mono text-foreground">expires_at − now &lt; max(5 min, 20% TTL)</span>. A 401 from the
        upstream triggers one refresh and one retry; a second 401 marks the server
        <span class="text-warning">needs re-auth</span>.
      </p>
    </div>
  </div>
</template>
