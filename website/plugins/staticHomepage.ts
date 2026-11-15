import type { createWebpackDevServer } from "@docusaurus/core/lib/commands/start/webpack";
import type { LoadContext, Plugin } from "@docusaurus/types";

type DevelopmentServer = Awaited<ReturnType<typeof createWebpackDevServer>>;

export default function staticHomepagePlugin({ baseUrl }: LoadContext): Plugin {
  return {
    name: "archeion-static-homepage",
    configureWebpack(config, isServer) {
      if (isServer || config.mode !== "development") return;
      // Docusaurus 3 emits its development shell as index.html even with pages
      // disabled. Rename that shell so CopyPlugin can preserve the static index.
      const htmlPlugin = config.plugins?.find(
        (plugin) => plugin && plugin.constructor.name === "HtmlWebpackPlugin",
      );
      if (
        !htmlPlugin ||
        !("userOptions" in htmlPlugin) ||
        typeof htmlPlugin.userOptions !== "object" ||
        htmlPlugin.userOptions === null ||
        !("filename" in htmlPlugin.userOptions) ||
        htmlPlugin.userOptions.filename !== "index.html"
      ) {
        throw new Error("Expected Docusaurus's development HTML shell at index.html");
      }
      const shell = `${baseUrl}__docs-dev.html`;
      htmlPlugin.userOptions.filename = "__docs-dev.html";
      const onListening = (server: DevelopmentServer) => {
        const fallback = server.options.historyApiFallback;
        if (!fallback || typeof fallback !== "object" || !fallback.rewrites) {
          throw new Error("Expected Docusaurus's development history fallback");
        }
        // The history middleware reads this shared rule list on each request.
        // Put docs before the core catch-all; retain all core middleware/callbacks.
        const rewrites = [
          { from: new RegExp(`^${baseUrl}(?:docs(?:/|$)|404[.]html$)`), to: shell },
          ...fallback.rewrites,
        ];
        // The declaration is readonly; the pinned middleware uses a mutable
        // options object. Fail explicitly if that runtime contract changes.
        if (!Reflect.set(fallback, "rewrites", rewrites)) {
          throw new Error("Cannot configure Docusaurus's development history fallback");
        }
      };
      return { name: config.name, devServer: { onListening } };
    },
  };
}
