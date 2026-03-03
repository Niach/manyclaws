import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  integrations: [
    starlight({
      title: "ManyClaws",
      customCss: ["./src/assets/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "docs/getting-started/install" },
          ],
        },
        {
          label: "Friends System",
          items: [
            { label: "Overview", slug: "docs/friends/overview" },
            { label: "Friend Portal", slug: "docs/friends/portal" },
            { label: "Cross-Platform Identity", slug: "docs/friends/identity" },
            { label: "Secrets", slug: "docs/friends/secrets" },
            { label: "Friend Namespaces", slug: "docs/friends/namespaces" },
            { label: "Memory System", slug: "docs/friends/memory" },
            { label: "Data Model", slug: "docs/friends/data-model" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Example Chats", slug: "docs/guides/examples" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { label: "Overview & Auth", slug: "docs/api/overview" },
            { label: "Agents", slug: "docs/api/agents" },
            { label: "Friends", slug: "docs/api/friends" },
            { label: "Authentication", slug: "docs/api/auth" },
            { label: "Portal", slug: "docs/api/portal" },
            { label: "Secrets", slug: "docs/api/secrets" },
            { label: "Cluster", slug: "docs/api/cluster" },
          ],
        },
      ],
    }),
    tailwind({ applyBaseStyles: false }),
  ],
});
