import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    // Skip Cloudflare plugin on Vercel — it changes output structure
    // and requires the Workers runtime which Vercel doesn't support
    ...(process.env.NODE_ENV === "production" && !process.env.VERCEL
      ? [cloudflare()]
      : []),
  ],
  server: {
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
    // Same-origin API proxy. Without this, opening the dev server on the LAN
    // IP (http://192.168.178.82:5173) while the API lives on a different
    // origin (serve_rag is loopback-bound on :18000) is a cross-origin call
    // the browser blocks with CORS. Routing through Vite makes every request
    // same-origin (browser → :5173 → Vite → loopback backend), so no CORS and
    // cookies/auth work. Engaged only when the *_URL envs point at these
    // relative prefixes (see .env.local); absolute URLs bypass it entirely,
    // so this is inert for anyone still using a direct backend URL.
    proxy: {
      // serve_rag (RAG/query/sessions/upload/health/feedback) — strip /rag.
      "/rag": {
        target: "http://127.0.0.1:18000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rag/, ""),
      },
      // serve_rag auth endpoints, called same-origin as /auth/* (no rewrite).
      "/auth": {
        target: "http://127.0.0.1:18000",
        changeOrigin: true,
      },
      // serve_rag admin endpoints (Phase C: /admin/orgs, /admin/users/search …),
      // called same-origin as /admin/* (no rewrite).
      "/admin": {
        target: "http://127.0.0.1:18000",
        changeOrigin: true,
      },
      // DDiQ service on :18001 — its routes already live under /ddiq/*, so we
      // strip only the /ddiqsvc mount prefix.
      "/ddiqsvc": {
        target: "http://127.0.0.1:18001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ddiqsvc/, ""),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 5000,
    // Explicit output dir so Vercel always finds index.html at dist/
    outDir: "dist",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});