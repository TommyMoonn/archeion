import tailwindcss from "@tailwindcss/postcss";
import type { Config, Plugin } from "@docusaurus/types";
import type { Options as ClassicOptions } from "@docusaurus/preset-classic";
import docsSearchPlugin from "./plugins/search";

const config: Config = {
  title: "Archeion",
  url: "https://tommymoonn.github.io",
  baseUrl: "/archeion/",
  trailingSlash: true,
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
    image: "assets/archeion-preview.png",
    metadata: [{ name: "twitter:card", content: "summary_large_image" }],
    // Keep the preset navbar home destination aligned with the project site.
    navbar: {
      logo: {
        src: "assets/images/archeion-icon.png",
        alt: "Archeion",
        href: "pathname:///",
        target: "_self",
      },
    },
    colorMode: { defaultMode: "dark", respectPrefersColorScheme: false },
  },
  plugins: [
    docsSearchPlugin,
    function tailwindPlugin(): Plugin {
      return {
        name: "archeion-tailwind",
        configurePostCss(options) {
          options.plugins.push(tailwindcss());
          return options;
        },
        injectHtmlTags() {
          return {
            headTags: [
              {
                tagName: "script",
                innerHTML: "document.documentElement.setAttribute('data-site-fonts-loading','');",
              },
            ],
            // This parser-blocking script runs after the stylesheet and static body,
            // independently of React's deferred bundle. Reveal the complete layout
            // once its local fonts decode; script-free HTML stays visible normally.
            postBodyTags: [
              {
                tagName: "script",
                innerHTML:
                  "(function(){function show(){document.documentElement.removeAttribute('data-site-fonts-loading');}Promise.all([document.fonts.load('400 16px \"Inter Variable\"'),document.fonts.load('400 16px Literata')]).then(show,show);})();",
              },
            ],
          };
        },
        configureWebpack(config) {
          // Docusaurus 3 owns font URLs through url-loader. Embed the critical
          // typefaces in its render-blocking stylesheet to prevent late reflow.
          const fonts = config.module?.rules?.find(
            (rule) =>
              rule &&
              typeof rule === "object" &&
              rule.test instanceof RegExp &&
              rule.test.test("font.woff2"),
          );
          if (!fonts || typeof fonts !== "object" || !Array.isArray(fonts.use))
            throw new Error("Expected Docusaurus's font loader rule");
          const loader = fonts.use.find(
            (entry) => entry && typeof entry === "object" && entry.loader?.includes("url-loader"),
          );
          if (
            !loader ||
            typeof loader !== "object" ||
            typeof loader.options !== "object" ||
            loader.options === null
          )
            throw new Error("Expected configurable Docusaurus font URL loader");
          loader.options.limit = Number.MAX_SAFE_INTEGER;
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
        sitemap: {
          ignorePatterns: ["**/404.html"],
        },
        theme: { customCss: "./src/css/custom.css" },
      } satisfies ClassicOptions,
    ],
  ],
};

export default config;
