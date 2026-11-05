import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Tauri loads the dev server at a fixed address, so the port must not move.
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    restoreMocks: true,
  },
});
