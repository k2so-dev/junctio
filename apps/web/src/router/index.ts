import { createRouter, createWebHistory } from "vue-router";
import { useSession } from "@/stores/session";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/servers" },
    { path: "/login", name: "login", component: () => import("@/views/LoginView.vue"), meta: { public: true } },
    { path: "/servers", name: "servers", component: () => import("@/views/ServersView.vue") },
    { path: "/servers/new", name: "server-new", component: () => import("@/views/ServerFormView.vue") },
    { path: "/servers/:id", name: "server", component: () => import("@/views/ServerDetailView.vue") },
    { path: "/servers/:id/edit", name: "server-edit", component: () => import("@/views/ServerFormView.vue") },
    { path: "/namespaces/:id?", name: "namespaces", component: () => import("@/views/NamespacesView.vue") },
    { path: "/endpoints/:id?", name: "endpoints", component: () => import("@/views/EndpointsView.vue") },
    { path: "/api-keys", name: "api-keys", component: () => import("@/views/ApiKeysView.vue") },
    { path: "/request-log", name: "request-log", component: () => import("@/views/RequestLogView.vue") },
    { path: "/settings", name: "settings", component: () => import("@/views/SettingsView.vue") },
    { path: "/consent", name: "consent", component: () => import("@/views/ConsentView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/servers" }
  ]
});

router.beforeEach(async (to) => {
  const { session, ready, refreshSession } = useSession();
  if (!ready.value) await refreshSession();
  const authenticated = session.value?.authenticated ?? false;
  if (!authenticated && !to.meta.public) return { name: "login", query: { next: to.fullPath } };
  if (authenticated && to.name === "login") return { path: "/servers" };
  return true;
});

export default router;
