import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";
export default mergeConfig(
  base,
  defineConfig({
    build: {
      target: "chrome105",
      outDir: ".scratch/async-surfaces-build",
      rollupOptions: {
        input: [
          "tests/browser/fixtures/async-surfaces.html",
          "tests/browser/fixtures/dialog-geometry.html",
        ],
      },
    },
  }),
);
