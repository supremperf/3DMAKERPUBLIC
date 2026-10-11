import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../src/shared";
const bridge: DesktopBridge = {
  platform: process.platform,
  probeLocalAI: () => ipcRenderer.invoke("ai:local"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  request: (request) => ipcRenderer.invoke("ai:request", request),
  fetchAsset: (url) => ipcRenderer.invoke("ai:asset", url),
  openFile: (filters) => ipcRenderer.invoke("file:open", filters),
  saveFile: (name, base64, filters) =>
    ipcRenderer.invoke("file:save", name, base64, filters),
  saveBundle: (name, files) => ipcRenderer.invoke("file:bundle", name, files),
  setDirty: (dirty) => ipcRenderer.send("project:dirty", dirty),
  getGenerations: () => ipcRenderer.invoke("generations:list"),
  getGeneration: (id) => ipcRenderer.invoke("generations:get", id),
  putGeneration: (record) => ipcRenderer.invoke("generations:put", record),
  deleteGeneration: (id) => ipcRenderer.invoke("generations:delete", id),
  setFullscreen: () => ipcRenderer.invoke("window:fullscreen"),
  windowAction: (action) => ipcRenderer.send("window:action", action),
};
contextBridge.exposeInMainWorld("desktop", bridge);
