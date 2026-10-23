import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";

export default mergeConfig(
  base,
  defineConfig({
    build: {
      target: "chrome105",
      outDir: ".scratch/update-toast-build",
      rollupOptions: {
        input: ["tests/browser/fixtures/ui-stability.html", "tests/browser/fixtures/index.html"],
      },
    },
  }),
);
