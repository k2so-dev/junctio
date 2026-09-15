import { createRouter, createWebHistory } from "vue-router";
import { useSession } from "@/stores/session";
import { setUnauthorizedHandler } from "@/lib/api";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "overview", component: () => import("@/views/OverviewView.vue") },
    { path: "/login", name: "login", component: () => import("@/views/LoginView.vue"), meta: { public: true } },
    { path: "/servers", name: "servers", component: () => import("@/views/ServersView.vue") },
    { path: "/servers/new", name: "server-new", component: () => import("@/views/ServerFormView.vue") },
    { path: "/servers/:id", name: "server", component: () => import("@/views/ServerDetailView.vue") },
    { path: "/servers/:id/edit", name: "server-edit", component: () => import("@/views/ServerFormView.vue") },
    { path: "/explore", name: "explore", component: () => import("@/views/ExploreView.vue") },
    { path: "/namespaces/:id?", name: "namespaces", component: () => import("@/views/NamespacesView.vue") },
    { path: "/endpoints/:id?", name: "endpoints", component: () => import("@/views/EndpointsView.vue") },
    { path: "/api-keys", name: "api-keys", component: () => import("@/views/ApiKeysView.vue") },
    { path: "/request-log", name: "request-log", component: () => import("@/views/RequestLogView.vue") },
    { path: "/security", name: "security", component: () => import("@/views/SecurityView.vue") },
    { path: "/settings", name: "settings", redirect: { name: "settings-general" } },
    {
      path: "/settings/general",
      name: "settings-general",
      component: () => import("@/views/settings/SettingsGeneralView.vue")
    },
    {
      path: "/settings/access",
      name: "settings-access",
      component: () => import("@/views/settings/SettingsAccessView.vue")
    },
    {
      path: "/settings/admin-mcp",
      name: "settings-admin-mcp",
      component: () => import("@/views/settings/SettingsAdminMcpView.vue")
    },
    { path: "/consent", name: "consent", component: () => import("@/views/ConsentView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});

setUnauthorizedHandler(() => {
  const { session, forgetSession } = useSession();
  if (!session.value?.authenticated) return;
  forgetSession();
  const current = router.currentRoute.value;
  if (current.meta.public) return;
  void router.replace({ name: "login", query: { next: current.fullPath } });
});

router.beforeEach(async (to) => {
  const { session, ready, refreshSession } = useSession();
  if (!ready.value) await refreshSession();
  const authenticated = session.value?.authenticated ?? false;
  if (!authenticated && !to.meta.public) return { name: "login", query: { next: to.fullPath } };
  if (authenticated && to.name === "login") return { path: "/" };
  return true;
});

export default router;
