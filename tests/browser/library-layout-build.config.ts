import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config.ts";

// Disposable fixture build, separate from the application's release bundle.
export default mergeConfig(
  base,
  defineConfig({
    build: {
      target: "chrome105",
      outDir: ".scratch/library-layout-build",
      rollupOptions: { input: "tests/browser/fixtures/ui-stability.html" },
    },
  }),
);
