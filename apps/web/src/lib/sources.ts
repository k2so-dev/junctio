import type { SourceDto, SourceGroup } from "@junctio/schema";
import catalog from "@/data/sources.json";

export type SourceSection = {
  id: SourceGroup;
  title: string;
  description: string;
  collapsed: boolean;
  sources: SourceDto[];
};

const SECTIONS: { id: SourceGroup; title: string; description: string; collapsed: boolean }[] = [
  {
    id: "canonical",
    title: "Canonical",
    description: "Kept by the people who write the protocol, or by GitHub on top of it.",
    collapsed: false
  },
  {
    id: "api",
    title: "Indexes with an API",
    description: "Large catalogs that publish machine-readable listings. One of these may become a tab of its own.",
    collapsed: false
  },
  {
    id: "catalogs",
    title: "Catalogs and lists",
    description: "Browse by hand, copy the config, paste it above.",
    collapsed: false
  },
  {
    id: "vendors",
    title: "Vendor integrations",
    description: "One company exposing its own products. Not a general catalog, and usually a hosted URL.",
    collapsed: false
  },
  {
    id: "regional",
    title: "Chinese markets",
    description: "A different set of servers: Amap, Baidu Map, WeChat, Alipay. Most pages are in Chinese.",
    collapsed: true
  }
];

export const SOURCES = catalog.sources as SourceDto[];

export function sourceSections(): SourceSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    sources: SOURCES.filter((source) => source.group === section.id)
  })).filter((section) => section.sources.length > 0);
}

export function sourceIcon(source: SourceDto): string | null {
  return source.icon === null ? null : `/sources/${source.icon}`;
}

export function sourceInitials(source: SourceDto): string {
  const letters = source.name.replace(/[^A-Za-z0-9]/g, "");
  return (letters.slice(0, 2) || "MC").toUpperCase();
}

export function sourceHue(source: SourceDto): number {
  let hash = 0;
  for (const char of source.id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
