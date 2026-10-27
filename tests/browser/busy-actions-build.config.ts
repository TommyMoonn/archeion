import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";

export default mergeConfig(
  base,
  defineConfig({
    build: {
      target: "chrome105",
      outDir: ".scratch/busy-actions-build",
      rollupOptions: {
        input: ["tests/browser/fixtures/index.html", "tests/browser/fixtures/dialog-geometry.html"],
      },
    },
  }),
);
