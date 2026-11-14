import tailwindcss from "@tailwindcss/postcss";
import type { Config, Plugin } from "@docusaurus/types";

const config: Config = {
  title: "Archeion",
  url: "https://tommymoonn.github.io",
  baseUrl: "/archeion/",
  organizationName: "TommyMoonn",
  projectName: "archeion",
  onBrokenLinks: "throw",
  plugins: [
    function tailwindPlugin(): Plugin {
      return {
        name: "archeion-tailwind",
        configurePostCss(options) {
          options.plugins.push(tailwindcss());
          return options;
        },
        configureWebpack() {
          return { resolve: { alias: { "@": `${__dirname}/src` } } };
        },
      };
    },
  ],
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      },
    ],
  ],
};

export default config;
