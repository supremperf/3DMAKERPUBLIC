import type {
  DesktopBridge,
  AISettings,
  ProxyRequest,
  ProxyResponse,
  GenerationRecord,
  GenerationSummary,
  LocalAIProbe,
} from "../shared";
declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
async function call<T>(action: string, payload?: unknown): Promise<T> {
  const response = await fetch("/__3dmaker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-3DMaker-Client": "studio",
    },
    body: JSON.stringify({ action, payload }),
  });
  let data: { result: T; error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Le service local est indisponible. Lancez l’application Electron ou npm run dev:web.",
    );
  }
  if (!response.ok || data.error)
    throw new Error(data.error || "Le service local a rencontré une erreur.");
  return data.result;
}
export const bridge = {
  probeLocalAI: (): Promise<LocalAIProbe> =>
    window.desktop ? window.desktop.probeLocalAI() : call("probeLocalAI"),
  getSettings: (): Promise<AISettings> =>
    window.desktop ? window.desktop.getSettings() : call("getSettings"),
  saveSettings: (s: AISettings): Promise<void> =>
    window.desktop ? window.desktop.saveSettings(s) : call("saveSettings", s),
  request: (r: ProxyRequest): Promise<ProxyResponse> =>
    window.desktop ? window.desktop.request(r) : call("request", r),
  fetchAsset: (url: string): Promise<{ base64: string; mime: string }> =>
    window.desktop ? window.desktop.fetchAsset(url) : call("fetchAsset", url),
  getGenerations: (): Promise<GenerationSummary[]> =>
    window.desktop ? window.desktop.getGenerations() : call("getGenerations"),
  getGeneration: (id: string): Promise<GenerationRecord> =>
    window.desktop
      ? window.desktop.getGeneration(id)
      : call("getGeneration", id),
  putGeneration: (r: GenerationRecord): Promise<void> =>
    window.desktop ? window.desktop.putGeneration(r) : call("putGeneration", r),
  deleteGeneration: (id: string): Promise<void> =>
    window.desktop
      ? window.desktop.deleteGeneration(id)
      : call("deleteGeneration", id),
};
export function bytesToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
export async function saveBytes(
  name: string,
  content: Uint8Array | ArrayBuffer | string,
): Promise<boolean> {
  const bytes =
    typeof content === "string"
      ? new TextEncoder().encode(content)
      : content instanceof Uint8Array
        ? content
        : new Uint8Array(content);
  if (window.desktop)
    return window.desktop.saveFile(name, bytesToBase64(bytes), [
      {
        name: name.split(".").pop()!.toUpperCase(),
        extensions: [name.split(".").pop()!],
      },
    ]);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
export async function chooseFiles(
  accept: string,
  multiple = false,
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener(
      "change",
      () => resolve(Array.from(input.files || [])),
      { once: true },
    );
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}
export function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Le fichier ne peut pas être lu."));
    reader.readAsDataURL(file);
  });
}
