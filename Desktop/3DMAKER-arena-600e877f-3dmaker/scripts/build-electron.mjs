import { build } from "esbuild";
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.cjs",
  bundle: true,
  platform: "node",
  target: "node26",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
await build({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  platform: "node",
  target: "node26",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
console.log("Electron : processus principal et preload compilés.");
