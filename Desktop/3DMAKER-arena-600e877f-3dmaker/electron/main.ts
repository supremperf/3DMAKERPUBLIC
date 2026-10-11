import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  session,
  Menu,
  protocol,
  net,
  type IpcMainInvokeEvent,
} from "electron";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve, sep, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalBackend } from "./backend";
import type { AISettings, GenerationRecord, ProxyRequest } from "../src/shared";

app.setName("3DMAKER");
app.commandLine.appendSwitch("lang", "fr");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);
let window: BrowserWindow | null = null;
let documentDirty = false;
let closingConfirmed = false;
let closingDialog = false;
const devUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
const MAX_FILE_SIZE = 180 * 1024 * 1024;
function trusted(event: IpcMainInvokeEvent) {
  if (event.sender !== window?.webContents)
    throw new Error("Source de la requête non autorisée.");
  const url = event.senderFrame?.url || "";
  if (
    devUrl
      ? new URL(url).origin !== new URL(devUrl).origin
      : !url.startsWith("app://studio/")
  )
    throw new Error("Origine non autorisée.");
}
async function createWindow() {
  closingConfirmed = false;
  documentDirty = false;
  closingDialog = false;
  window = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1080,
    minHeight: 720,
    fullscreen: true,
    backgroundColor: "#121316",
    title: "3DMAKER",
    icon: join(__dirname, devUrl ? "../public/icon.ico" : "../dist/icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (
      devUrl
        ? new URL(url).origin !== new URL(devUrl).origin
        : !url.startsWith("app://studio/")
    )
      event.preventDefault();
  });
  window.on("close", (event) => {
    if (!documentDirty || closingConfirmed) return;
    event.preventDefault();
    if (closingDialog) return;
    closingDialog = true;
    void dialog
      .showMessageBox(window!, {
        type: "warning",
        title: "3DMAKER — Modifications non enregistrées",
        message: "Votre projet contient des modifications non enregistrées.",
        detail:
          "Enregistrez avec Ctrl S pour conserver un fichier projet. La sauvegarde automatique locale n’est pas un remplacement du fichier projet.",
        buttons: ["Rester dans 3DMAKER", "Quitter sans enregistrer"],
        defaultId: 0,
        cancelId: 0,
      })
      .then((result) => {
        closingDialog = false;
        if (result.response === 1) {
          closingConfirmed = true;
          window?.close();
        }
      });
  });
  window.on("closed", () => {
    window = null;
  });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadURL("app://studio/index.html");
}
app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    if (!devUrl) {
      const root = resolve(__dirname, "../dist");
      protocol.handle("app", async (request) => {
        const url = new URL(request.url);
        if (url.hostname !== "studio")
          return new Response("Origine non autorisée.", { status: 403 });
        let path: string;
        try {
          path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        } catch {
          return new Response("Chemin invalide.", { status: 400 });
        }
        if (!path.startsWith(`${root}${sep}`))
          return new Response("Accès non autorisé.", { status: 403 });
        try {
          return await net.fetch(pathToFileURL(path).href);
        } catch {
          return new Response("Fichier introuvable.", { status: 404 });
        }
      });
    }
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    if (!devUrl)
      session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; media-src 'self' blob: data:",
            ],
          },
        }),
      );
    const backend = new LocalBackend(
      join(app.getPath("userData"), "data"),
      (text) => {
        if (!text) return "";
        if (!safeStorage.isEncryptionAvailable())
          throw new Error(
            "Le chiffrement sécurisé du système est indisponible. Activez le trousseau système avant d’enregistrer une clé API.",
          );
        return safeStorage.encryptString(text).toString("base64");
      },
      (text) =>
        text ? safeStorage.decryptString(Buffer.from(text, "base64")) : "",
    );
    const handle = <Args extends unknown[], Result>(
      channel: string,
      fn: (...args: Args) => Result,
    ) =>
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        trusted(event);
        return fn(...(args as Args));
      });
    handle("settings:get", () => backend.getSettings());
    handle("settings:save", (value: AISettings) => backend.saveSettings(value));
    handle("ai:local", () => backend.probeLocalAI());
    handle("ai:request", (value: ProxyRequest) => backend.request(value));
    handle("ai:asset", (url: string) => backend.fetchAsset(url));
    handle("generations:list", () => backend.getGenerations());
    handle("generations:get", (id: string) => backend.getGeneration(id));
    handle("generations:put", (record: GenerationRecord) =>
      backend.putGeneration(record),
    );
    handle("generations:delete", (id: string) => backend.deleteGeneration(id));
    handle("file:open", async (filters: Electron.FileFilter[]) => {
      const result = await dialog.showOpenDialog(window!, {
        filters,
        properties: ["openFile"],
      });
      if (result.canceled) return null;
      const path = result.filePaths[0];
      if ((await stat(path)).size > MAX_FILE_SIZE)
        throw new Error("Le fichier est trop volumineux (180 Mo maximum).");
      const data = await readFile(path);
      if (data.length > MAX_FILE_SIZE)
        throw new Error("Le fichier est trop volumineux (180 Mo maximum).");
      return {
        name: path.split(/[\\/]/).pop()!,
        base64: data.toString("base64"),
      };
    });
    handle(
      "file:save",
      async (
        name: string,
        base64: string,
        filters: Electron.FileFilter[] = [],
      ) => {
        if (
          typeof name !== "string" ||
          typeof base64 !== "string" ||
          base64.length > MAX_FILE_SIZE * 1.4
        )
          throw new Error("Fichier invalide ou trop volumineux.");
        const result = await dialog.showSaveDialog(window!, {
          defaultPath: name.replace(/[\\/]/g, "_"),
          filters,
        });
        if (result.canceled || !result.filePath) return false;
        await writeFile(result.filePath, Buffer.from(base64, "base64"));
        return true;
      },
    );
    handle(
      "file:bundle",
      async (name: string, files: { path: string; base64: string }[]) => {
        if (!Array.isArray(files) || files.length > 500 || !files.length)
          throw new Error("Export multifichier invalide.");
        if (
          files.reduce(
            (sum, f) =>
              sum +
              (typeof f.base64 === "string"
                ? f.base64.length
                : MAX_FILE_SIZE * 2),
            0,
          ) >
          MAX_FILE_SIZE * 1.4
        )
          throw new Error("L’export dépasse 180 Mo.");
        const result = await dialog.showSaveDialog(window!, {
          defaultPath: name.replace(/[\\/]/g, "_"),
          filters: [{ name: "Objet Wavefront", extensions: ["obj"] }],
        });
        if (result.canceled || !result.filePath) return false;
        const directory = dirname(result.filePath);
        const destinations = files.map((file) => {
          if (typeof file.path !== "string" || /(^[\\/]|:|\0)/.test(file.path))
            throw new Error("Chemin d’export invalide.");
          const path =
            file.path === name
              ? result.filePath!
              : resolve(directory, file.path);
          if (!path.startsWith(`${directory}${sep}`))
            throw new Error("Le fichier doit rester dans le dossier d’export.");
          return { path, base64: file.base64 };
        });
        for (const file of destinations) {
          await mkdir(dirname(file.path), { recursive: true });
          await writeFile(file.path, Buffer.from(file.base64, "base64"));
        }
        return true;
      },
    );
    ipcMain.on("project:dirty", (event, dirty) => {
      if (event.sender === window?.webContents && typeof dirty === "boolean")
        documentDirty = dirty;
    });
    handle("window:fullscreen", () => {
      window?.setFullScreen(!window.isFullScreen());
    });
    ipcMain.on("window:action", (event, action) => {
      if (event.sender !== window?.webContents) return;
      if (action === "minimize") window?.minimize();
      if (action === "maximize") {
        if (window?.isFullScreen()) {
          window.setFullScreen(false);
          window.maximize();
        } else if (window?.isMaximized()) window.unmaximize();
        else window?.maximize();
      }
      if (action === "close") window?.close();
    });
    await createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) void createWindow();
    });
  })
  .catch((error) => {
    dialog.showErrorBox("3DMAKER — Démarrage impossible", String(error));
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
