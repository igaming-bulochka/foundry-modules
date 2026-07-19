import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "GlobeMap",
      formats: ["es"],
      fileName: () => "globe-map.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: (info) => {
          if (info.name?.endsWith(".css")) return "globe-map.css";
          return "assets/[name][extname]";
        },
      },
    },
    sourcemap: true,
    target: "es2022",
    cssCodeSplit: false,
    emptyOutDir: true,
  },
});
