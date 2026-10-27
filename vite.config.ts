import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const base = "/projects/vocabulary-app/";

// Workers Assets `not_found_handling: "404-page"` walks up from the request path to the
// nearest 404.html, so a copy of index.html there makes SPA deep links render the app.
function spa404(): Plugin {
  return {
    name: "spa-404",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const index = bundle["index.html"];
        if (index?.type !== "asset") throw new Error("spa-404: index.html missing from the bundle");
        this.emitFile({ type: "asset", fileName: "404.html", source: index.source });
      },
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    spa404(),
    VitePWA({
      // src/pwa.tsx registers the worker itself, to pass updateViaCache: "none".
      injectRegister: false,
      registerType: "prompt",
      manifest: {
        name: "Vocabulary",
        short_name: "Vocabulary",
        description: "Find your level, then learn English and French words test-first.",
        start_url: base,
        scope: base,
        display: "standalone",
        // Honoured by installed apps on Android; iOS has no way for a web app to lock rotation.
        orientation: "portrait",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: `${base}pwa-192.png`, sizes: "192x192", type: "image/png" },
          { src: `${base}pwa-512.png`, sizes: "512x512", type: "image/png" },
          { src: `${base}pwa-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app shell only: every API call needs the network (grading, scheduling).
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [new RegExp(`^${base}api/`)],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // Mirrors the URL path so Workers Assets serves files without rewriting.
    outDir: `dist${base}`,
    emptyOutDir: true,
  },
  server: {
    proxy: {
      [`${base}api`]: "http://localhost:8787",
    },
  },
});
