import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// PORT — defaults to 3000; on Replit the workflow provides it automatically.
const port = Number(process.env.PORT ?? "3000");

// BASE_PATH — defaults to "/" for standalone/external deployments.
// On Replit this is provided automatically by the workspace routing layer.
const basePath = process.env.BASE_PATH ?? "/";

// API_URL — the backend to proxy /api requests to in development.
// Defaults to localhost:8080 (same machine, different port).
// Override with API_URL=http://my-api-host:8080 for remote backends.
const apiUrl = process.env.API_URL ?? "http://localhost:8080";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: false,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: apiUrl,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
