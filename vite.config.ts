import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

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
  plugins: [react(), tailwindcss(), spa404()],
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
