import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { LocalBackend } from "./electron/backend.ts";
import { join } from "node:path";
import { homedir } from "node:os";

function developmentBridge(): Plugin {
  const backend = new LocalBackend(
    process.env.THREEDMAKER_PREVIEW_DATA || join(homedir(), ".3dmaker-preview"),
  );
  return {
    name: "3dmaker-development-bridge",
    configureServer(server) {
      server.middlewares.use("/__3dmaker", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (
          req.method !== "POST" ||
          req.headers["x-3dmaker-client"] !== "studio"
        ) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "Accès non autorisé." }));
          return;
        }
        try {
          let raw = "";
          for await (const chunk of req) {
            raw += chunk.toString();
            if (raw.length > 240 * 1024 * 1024)
              throw new Error("Requête trop volumineuse.");
          }
          const { action, payload } = JSON.parse(raw);
          let result: unknown;
          switch (action) {
            case "probeLocalAI":
              result = await backend.probeLocalAI();
              break;
            case "getSettings":
              result = await backend.getSettings();
              break;
            case "saveSettings":
              result = await backend.saveSettings(payload);
              break;
            case "request":
              result = await backend.request(payload);
              break;
            case "fetchAsset":
              result = await backend.fetchAsset(payload);
              break;
            case "getGenerations":
              result = await backend.getGenerations();
              break;
            case "getGeneration":
              result = await backend.getGeneration(payload);
              break;
            case "putGeneration":
              result = await backend.putGeneration(payload);
              break;
            case "deleteGeneration":
              result = await backend.deleteGeneration(payload);
              break;
            default:
              throw new Error("Action inconnue.");
          }
          res.end(JSON.stringify({ result: result ?? null }));
        } catch (error) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    },
  };
}
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), developmentBridge()],
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "zustand",
      "three",
      "three-bvh-csg",
      "three-mesh-bvh",
      "meshoptimizer",
      "lucide-react",
      "three/addons/loaders/HDRLoader.js",
      "three/addons/loaders/GLTFLoader.js",
      "three/addons/loaders/DRACOLoader.js",
      "three/addons/loaders/FBXLoader.js",
      "three/addons/loaders/OBJLoader.js",
      "three/addons/loaders/MTLLoader.js",
      "three/addons/loaders/STLLoader.js",
      "three/addons/exporters/GLTFExporter.js",
      "three/addons/exporters/OBJExporter.js",
      "three/addons/exporters/STLExporter.js",
    ],
  },
  server: { host: "0.0.0.0", port: 5173, strictPort: true, allowedHosts: true },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes("/node_modules/three/")
            ? "three"
            : /\/node_modules\/(react|react-dom|zustand)\//.test(id)
              ? "react"
              : undefined,
      },
    },
  },
});
