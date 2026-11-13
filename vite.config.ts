import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Порт 1420 ждёт Tauri (см. src-tauri/tauri.conf.json → build.devUrl)
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
