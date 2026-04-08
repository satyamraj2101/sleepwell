import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// The Vite proxy solves the CORS problem in development.
// All requests to /leah-proxy/* are forwarded to the appropriate Leah API.
// The target is dynamically set via request headers injected by leahClient.ts.
// In production, deploy a minimal Express reverse proxy (see src/server/proxy.ts).

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Old Prod API proxy — capturing instance from path: /leah-old-api/{instance}/...
      "/leah-old-api": ({
        target: "https://cloudstaging5.contractpod.com",
        changeOrigin: true,
        secure: false, // false = skip TLS cert verification (needed for prod instances)
        router: (req: any) => {
          const m = req.url?.match(/^\/leah-old-api\/([^/]+)/);
          if (m) return `https://${m[1]}`;
        },
        rewrite: (p: string) => p.replace(/^\/leah-old-api\/[^/]+/, "/cpaimt_api"),
        configure: (proxy: any) => {
          proxy.on("proxyReq", (proxyReq: any, req: any) => {
            const m = req.url?.match(/^\/leah-old-api\/([^/]+)/);
            if (m) proxyReq.setHeader("host", m[1]);
          });
        },
      } as any),
      // New Cloud API proxy — capturing instance from path: /leah-new-api/{instance}/...
      "/leah-new-api": ({
        target: "https://cpai-productapi-stg5.azurewebsites.net",
        changeOrigin: true,
        secure: false,
        router: (req: any) => {
          const m = req.url?.match(/^\/leah-new-api\/([^/]+)/);
          if (m) return `https://${m[1]}`;
        },
        rewrite: (p: string) => p.replace(/^\/leah-new-api\/[^/]+/, ""),
        configure: (proxy: any) => {
          proxy.on("proxyReq", (proxyReq: any, req: any) => {
            const m = req.url?.match(/^\/leah-new-api\/([^/]+)/);
            if (m) proxyReq.setHeader("host", m[1]);
          });
        },
      } as any),
      // Auth API proxy — capturing instance from path: /leah-auth/{instance}/...
      "/leah-auth": ({
        target: "https://cloudstaging5.contractpod.com",
        changeOrigin: true,
        secure: false,
        router: (req: any) => {
          const m = req.url?.match(/^\/leah-auth\/([^/]+)/);
          if (m) return `https://${m[1]}`;
        },
        rewrite: (p: string) => p.replace(/^\/leah-auth\/[^/]+/, "/cpaimt_auth"),
        configure: (proxy: any) => {
          proxy.on("proxyReq", (proxyReq: any, req: any) => {
            const m = req.url?.match(/^\/leah-auth\/([^/]+)/);
            if (m) proxyReq.setHeader("host", m[1]);
          });
        },
      } as any),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          table: ["@tanstack/react-table"],
          ui: ["lucide-react", "sonner"],
          export: ["xlsx", "jspdf"],
        },
      },
    },
  },
});
