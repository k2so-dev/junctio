import type { HealthDto, SessionDto, SettingsDto } from "@junctio/schema";
import { readonly, ref } from "vue";
import { api } from "@/lib/api";

const session = ref<SessionDto | null>(null);
const settings = ref<SettingsDto | null>(null);
const health = ref<HealthDto | null>(null);
const ready = ref(false);

let healthTimer: ReturnType<typeof setInterval> | null = null;

async function refreshSession() {
  try {
    session.value = await api.session.get();
  } catch {
    session.value = { authenticated: false, needsSetup: false };
    ready.value = true;
    return;
  }
  if (session.value.authenticated) {
    await Promise.all([refreshSettings().catch(() => undefined), refreshHealth()]);
  }
  ready.value = true;
}

function forgetSession() {
  session.value = session.value ? { ...session.value, authenticated: false } : null;
  settings.value = null;
  health.value = null;
  stopHealthPolling();
}

async function refreshSettings() {
  settings.value = await api.settings.get();
}

async function refreshHealth() {
  try {
    health.value = await api.health();
  } catch {
    health.value = null;
  }
}

function startHealthPolling(intervalMs = 10_000) {
  if (healthTimer !== null) return;
  healthTimer = setInterval(refreshHealth, intervalMs);
}

function stopHealthPolling() {
  if (healthTimer === null) return;
  clearInterval(healthTimer);
  healthTimer = null;
}

async function login(password: string) {
  await api.session.login(password);
  await refreshSession();
}

async function setup(password: string) {
  await api.session.setup(password);
  await refreshSession();
}

async function logout() {
  await api.session.logout();
  stopHealthPolling();
  settings.value = null;
  health.value = null;
  await refreshSession();
}

export function useSession() {
  return {
    session: readonly(session),
    settings: readonly(settings),
    health: readonly(health),
    ready: readonly(ready),
    refreshSession,
    refreshSettings,
    refreshHealth,
    startHealthPolling,
    stopHealthPolling,
    login,
    setup,
    logout,
    forgetSession
  };
}
