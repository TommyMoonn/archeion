import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";

export default mergeConfig(
  base,
  defineConfig({
    build: {
      target: "chrome105",
      outDir: ".scratch/dialog-geometry-build",
      rollupOptions: { input: "tests/browser/fixtures/dialog-geometry.html" },
    },
  }),
);
