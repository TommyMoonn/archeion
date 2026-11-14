import tailwindcss from "@tailwindcss/postcss";
import type { Config, Plugin } from "@docusaurus/types";

const config: Config = {
  title: "Archeion",
  url: "https://tommymoonn.github.io",
  baseUrl: "/archeion/",
  organizationName: "TommyMoonn",
  projectName: "archeion",
  onBrokenLinks: "throw",
  // Keep the framework preference key explicit for the one-time legacy migration.
  storage: { type: "localStorage", namespace: false },
  headTags: [
    { tagName: "meta", attributes: { name: "theme-color", content: "#0b0b0c" } },
    {
      tagName: "script",
      attributes: {},
      // Runs in head, before Docusaurus's pre-body theme initialization and paint.
      innerHTML: `(function(){try{if(localStorage.getItem('theme')===null){var old=localStorage.getItem('archeion-docs-theme');if(old!==null)localStorage.setItem('theme',old==='light'?'light':'dark');}}catch(e){}})();`,
    },
  ],
  themeConfig: {
    colorMode: { defaultMode: "dark", respectPrefersColorScheme: false },
  },
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
          editUrl: "https://github.com/TommyMoonn/archeion/edit/main/website/",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      },
    ],
  ],
};

export default config;
