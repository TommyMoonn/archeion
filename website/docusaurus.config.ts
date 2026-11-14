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
        docs: false,
        blog: false,
        pages: false,
      },
    ],
  ],
};

export default config;
