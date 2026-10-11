import { createServer } from "vite";
import { context } from "esbuild";
import { spawn, type ChildProcess } from "node:child_process";
import electron from "electron";
const server = await createServer();
await server.listen();
const main = await context({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.cjs",
  bundle: true,
  platform: "node",
  target: "node26",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
const preload = await context({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  platform: "node",
  target: "node26",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
await main.rebuild();
await preload.rebuild();
await main.watch();
await preload.watch();
let child: ChildProcess;
const url = `http://localhost:${server.config.server.port}`;
console.log(`3DMAKER : interface ${url}, lancement d’Electron…`);
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  VITE_DEV_SERVER_URL: url,
};
delete childEnvironment.ELECTRON_RUN_AS_NODE;
child = spawn(
  electron as unknown as string,
  [
    ".",
    ...(process.env.ELECTRON_DISABLE_SANDBOX === "1" ? ["--no-sandbox"] : []),
  ],
  { stdio: "inherit", env: childEnvironment },
);
let exiting = false;
async function cleanup(code = 0) {
  if (exiting) return;
  exiting = true;
  child?.kill();
  await Promise.all([server.close(), main.dispose(), preload.dispose()]);
  process.exit(code);
}
child.on("exit", (code) => void cleanup(code || 0));
child.on("error", (error) => {
  console.error("Electron ne peut pas démarrer :", error.message);
  void cleanup(1);
});
process.on("SIGINT", () => void cleanup());
process.on("SIGTERM", () => void cleanup());
