import { defineConfig, mergeConfig } from "vite";
// Match the repository's extensionless TypeScript config-import convention.
import base from "../../vite.config";

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
