import type { Component } from "vue";
import {
  Boxes,
  Compass,
  KeyRound,
  LayoutDashboard,
  Layers,
  Plug,
  ScrollText,
  ShieldCheck
} from "@lucide/vue";

export interface NavItem {
  name: string;
  label: string;
  icon: Component;
  match?: (routeName: string) => boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Gateway",
    items: [
      { name: "overview", label: "Overview", icon: LayoutDashboard },
      { name: "servers", label: "Servers", icon: Boxes, match: (name) => name.startsWith("server") },
      { name: "explore", label: "Explore", icon: Compass }
    ]
  },
  {
    label: "Routing",
    items: [
      { name: "namespaces", label: "Namespaces", icon: Layers },
      { name: "endpoints", label: "Endpoints", icon: Plug },
      { name: "api-keys", label: "API keys", icon: KeyRound }
    ]
  },
  {
    label: "Monitor",
    items: [
      { name: "request-log", label: "Request log", icon: ScrollText },
      { name: "security", label: "Security", icon: ShieldCheck }
    ]
  }
];

export const SETTINGS_ITEMS = [
  { name: "settings-general", label: "General" },
  { name: "settings-access", label: "Access" },
  { name: "settings-admin-mcp", label: "Management MCP" }
];

export function isItemActive(item: NavItem, routeName: string): boolean {
  return item.match ? item.match(routeName) : item.name === routeName;
}

export interface NavBadge {
  text: string;
  class?: string;
  dot?: string;
}
