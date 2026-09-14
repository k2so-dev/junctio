<script setup lang="ts">
import type { ConsentRequestDto } from "@junctio/schema";
import { Loader2, ShieldCheck } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";

const route = useRoute();

const request = ref<ConsentRequestDto | null>(null);
const error = ref<string | null>(null);
const busy = ref<"approve" | "deny" | null>(null);
const loading = ref(true);

const requestId = computed(() => (typeof route.query.request === "string" ? route.query.request : null));

const origin = computed(() => {
  if (!request.value) return "";
  try {
    return new URL(request.value.redirectUri).origin;
  } catch {
    return request.value.redirectUri;
  }
});

async function decide(action: "approve" | "deny") {
  const id = requestId.value;
  if (!id) return;
  busy.value = action;
  try {
    const result = action === "approve" ? await api.oauth.approve(id) : await api.oauth.deny(id);
    window.location.href = result.redirectUrl;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : "the request could not be completed";
    busy.value = null;
  }
}

onMounted(async () => {
  const id = requestId.value;
  if (!id) {
    error.value = "no authorization request in the link";
    loading.value = false;
    return;
  }
  try {
    request.value = await api.oauth.request(id);
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : "the authorization request is unknown or expired";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="flex min-h-svh w-full items-center justify-center p-6">
    <div class="w-full max-w-md rounded-xl border bg-card p-6">
      <div v-if="loading" class="flex items-center gap-2 text-muted-foreground">
        <Loader2 class="size-4 animate-spin" />
        Loading the request…
      </div>

      <div v-else-if="error" class="flex flex-col gap-4">
        <h1 class="text-lg font-semibold tracking-tight">Authorization failed</h1>
        <p class="leading-relaxed text-muted-foreground">{{ error }}</p>
        <Button variant="outline" size="sm" class="self-start" as-child>
          <RouterLink to="/servers">Back to the gateway</RouterLink>
        </Button>
      </div>

      <div v-else-if="request" class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <div class="flex size-9 items-center justify-center rounded-lg border">
            <ShieldCheck class="size-4" />
          </div>
          <h1 class="text-lg font-semibold tracking-tight">Authorize this client</h1>
          <p class="leading-relaxed text-muted-foreground">
            <span class="font-medium text-foreground">{{ request.clientName ?? "An unnamed client" }}</span>
            wants access to this gateway. Approve only if you started this yourself.
          </p>
        </div>

        <div class="flex flex-col rounded-lg border px-3.5">
          <div class="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3 border-b py-2.5">
            <span class="text-muted-foreground">Endpoint</span>
            <span class="truncate font-mono text-xs">{{ request.endpointSlug ? `/mcp/${request.endpointSlug}` : "every endpoint" }}</span>
          </div>
          <div class="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3 border-b py-2.5">
            <span class="text-muted-foreground">Redirects to</span>
            <span class="truncate font-mono text-xs">{{ origin }}</span>
          </div>
          <div class="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3 py-2.5">
            <span class="text-muted-foreground">Client ID</span>
            <span class="truncate font-mono text-xs text-muted-foreground">{{ request.clientId }}</span>
          </div>
        </div>

        <p v-if="request.scopes.length > 0" class="text-xs leading-relaxed text-muted-foreground">
          Requested scopes: <span class="font-mono">{{ request.scopes.join(" ") }}</span>
        </p>

        <p class="rounded-lg border border-warning/50 bg-warning/8 p-3 text-xs leading-relaxed">
          Approving grants every tool in the namespace behind that endpoint. You can revoke the client later in Settings.
        </p>

        <div class="flex gap-2">
          <Button class="flex-1" :disabled="busy !== null" @click="decide('approve')">
            <Loader2 v-if="busy === 'approve'" class="animate-spin" />
            Approve
          </Button>
          <Button variant="outline" class="flex-1" :disabled="busy !== null" @click="decide('deny')">
            <Loader2 v-if="busy === 'deny'" class="animate-spin" />
            Deny
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
