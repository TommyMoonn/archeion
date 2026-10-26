import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";
export default mergeConfig(
  base,
  defineConfig({
    build: {
      target: "chrome105",
      outDir: ".scratch/async-utility-build",
      rollupOptions: { input: "tests/browser/fixtures/ui-stability.html" },
    },
  }),
);
