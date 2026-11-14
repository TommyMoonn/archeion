import type { Config } from "@docusaurus/types";

const config: Config = {
  title: "Archeion",
  url: "https://tommymoonn.github.io",
  baseUrl: "/archeion/",
  organizationName: "TommyMoonn",
  projectName: "archeion",
  onBrokenLinks: "throw",
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
        },
        blog: false,
      },
    ],
  ],
};

export default config;
