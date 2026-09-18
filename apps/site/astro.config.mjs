import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import vue from "@astrojs/vue";
import tailwindcss from "@tailwindcss/vite";
import { rehypeDocLinks } from "./src/lib/rehype-doc-links.ts";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://junctio.org",
  trailingSlash: "always",
  integrations: [vue(), mdx(), sitemap()],
  markdown: {
    processor: unified({ rehypePlugins: [rehypeDocLinks] }),
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" }
    }
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      fs: { allow: ["../.."] }
    }
  }
});
