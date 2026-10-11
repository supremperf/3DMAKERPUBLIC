import { abortable } from "./abort";
import { bridge, bytesToBase64 } from "./bridge";
import { embedGLTFAssets, importModel } from "../engine/io";
import { uid, type GenerationProgress, type SceneNode } from "../types";
import type { AISettings, GenerationRecord, ProxyResponse } from "../shared";
import { base64ToBytes } from "./bridge";

export interface ModelResult {
  base64: string;
  mime: string;
  name: string;
}
export interface TaskPayload {
  id?: string;
  result?: string;
  task_id?: string;
  status?: string;
  state?: string;
  progress?: number;
  model_urls?: { glb?: string; gltf?: string };
  model_url?: string;
  download_url?: string;
  glb?: string;
  model_base64?: string;
  mime?: string;
  error?: string | { message?: string };
  task_error?: { message?: string };
  assets?: { glb?: string; mesh?: string };
  output?: { model_url?: string; glb?: string };
}
const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted)
    throw new DOMException("Suivi de la génération annulé.", "AbortError");
};
async function delay(ms: number, signal: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", stop);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Annulé", "AbortError"));
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}
export function parseTask(payload: TaskPayload): {
  taskId?: string;
  status: string;
  url?: string;
  progress?: number;
  error?: string;
  base64?: string;
} {
  if (!payload || typeof payload !== "object")
    throw new Error("Réponse IA invalide : un objet JSON était attendu.");
  return {
    taskId: payload.id || payload.task_id || payload.result,
    status: String(payload.status || payload.state || "").toLowerCase(),
    url:
      payload.model_urls?.glb ||
      payload.model_urls?.gltf ||
      payload.model_url ||
      payload.download_url ||
      payload.glb ||
      payload.assets?.glb ||
      payload.assets?.mesh ||
      payload.output?.glb ||
      payload.output?.model_url,
    progress:
      typeof payload.progress === "number"
        ? Math.max(0, Math.min(100, payload.progress))
        : undefined,
    error:
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message || payload.task_error?.message,
    base64: payload.model_base64,
  };
}
function responseModel(response: ProxyResponse): ModelResult | null {
  if (response.base64)
    return {
      base64: response.base64,
      mime: response.mime || "model/gltf-binary",
      name: "modele.glb",
    };
  if (
    response.data &&
    typeof response.data === "object" &&
    "asset" in response.data
  )
    return {
      base64: bytesToBase64(
        new TextEncoder().encode(JSON.stringify(response.data)),
      ),
      mime: "model/gltf+json",
      name: "modele.gltf",
    };
  return null;
}
async function resolveModel(
  result: ModelResult,
  source: string,
): Promise<ModelResult> {
  const embedded = await embedGLTFAssets(result.base64, source);
  return {
    ...result,
    ...embedded,
    mime: embedded.name.endsWith(".gltf")
      ? "model/gltf+json"
      : "model/gltf-binary",
  };
}
export async function generateModel(
  image: string,
  settings: AISettings,
  signal: AbortSignal,
  onProgress: (value: GenerationProgress) => void,
): Promise<ModelResult> {
  const config = settings.image;
  throwIfAborted(signal);
  const request = (value: Parameters<typeof bridge.request>[0]) =>
    abortable(bridge.request(value), signal);
  if (["meshy", "stability"].includes(config.provider) && !config.apiKey)
    throw new Error(
      "Ajoutez votre clé API dans les paramètres IA avant de générer un modèle.",
    );
  const match = image.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/s);
  if (!match) throw new Error("Choisissez une photo PNG ou JPG valide.");
  onProgress({
    status: "running",
    percent: 5,
    message: "Téléversement de la photo…",
  });
  let response: ProxyResponse;
  if (config.provider === "stability") {
    onProgress({
      status: "running",
      percent: 25,
      message: "Analyse et reconstruction du maillage…",
    });
    response = await request({
      service: "image",
      method: "POST",
      responseType: "binary",
      timeoutMs: 300000,
      form: [
        {
          name: "image",
          value: match[2],
          filename: match[1] === "image/png" ? "photo.png" : "photo.jpg",
          mime: match[1],
        },
        {
          name: "texture_resolution",
          value:
            config.quality === "high"
              ? "2048"
              : config.quality === "medium"
                ? "1024"
                : "512",
        },
        { name: "remesh", value: "triangle" },
        {
          name: "vertex_count",
          value: String(Math.floor(config.targetPolygons / 2)),
        },
      ],
    });
  } else if (config.provider === "meshy")
    response = await request({
      service: "image",
      method: "POST",
      body: {
        image_url: image,
        ai_model: config.model,
        topology: "triangle",
        target_polycount: Math.max(
          100,
          Math.round(
            (config.targetPolygons *
              { low: 0.35, medium: 0.65, high: 1 }[config.quality]) /
              100,
          ) * 100,
        ),
        should_texture: config.texture,
        enable_pbr: config.texture,
      },
    });
  else
    response = await request({
      service: "image",
      method: "POST",
      body: {
        image,
        model: config.model,
        quality: config.quality,
        target_polygons: config.targetPolygons,
        texture: config.texture,
        format: "glb",
      },
    });
  throwIfAborted(signal);
  const direct = responseModel(response);
  if (direct) return abortable(resolveModel(direct, config.endpoint), signal);
  let task = parseTask(response.data as TaskPayload);
  const taskId = task.taskId;
  const start = Date.now();
  while (!task.url && !task.base64) {
    if (
      ["failed", "error", "cancelled", "canceled", "expired"].includes(
        task.status,
      )
    )
      throw new Error(
        task.error ||
          "La reconstruction a échoué chez le fournisseur. Essayez une photo plus nette sur fond uni.",
      );
    if (!taskId || typeof taskId !== "string")
      throw new Error(
        "La réponse doit contenir un identifiant de tâche, une URL de modèle GLB/GLTF ou model_base64.",
      );
    if (Date.now() - start > 20 * 60 * 1000)
      throw new Error(
        `Le délai de suivi a été dépassé. La tâche ${taskId} peut encore être en cours chez le fournisseur ; vérifiez son tableau de bord avant de réessayer.`,
      );
    const percent = task.progress !== undefined ? 10 + task.progress * 0.8 : 20;
    onProgress({
      status: "running",
      percent,
      taskId,
      message: ["pending", "queued", ""].includes(task.status)
        ? "En attente du fournisseur…"
        : task.progress !== undefined && task.progress < 35
          ? "Analyse de la profondeur…"
          : "Reconstruction du maillage…",
    });
    await delay(4000, signal);
    throwIfAborted(signal);
    const endpoint = `${config.endpoint.replace(/\/$/, "")}/${encodeURIComponent(taskId)}`;
    const poll = await request({
      service: "image",
      method: "GET",
      url: endpoint,
    });
    throwIfAborted(signal);
    const model = responseModel(poll);
    if (model) return abortable(resolveModel(model, config.endpoint), signal);
    task = parseTask(poll.data as TaskPayload);
  }
  if (task.base64)
    return abortable(
      resolveModel(
        { base64: task.base64, mime: "model/gltf-binary", name: "modele.glb" },
        config.endpoint,
      ),
      signal,
    );
  onProgress({
    status: "running",
    percent: 92,
    message: "Téléchargement du modèle 3D…",
    taskId,
  });
  const downloaded = await abortable(bridge.fetchAsset(task.url!), signal);
  throwIfAborted(signal);
  const embedded = await abortable(
    embedGLTFAssets(downloaded.base64, task.url!),
    signal,
  );
  return {
    ...downloaded,
    ...embedded,
    mime: embedded.name.endsWith(".gltf")
      ? "model/gltf+json"
      : "model/gltf-binary",
  };
}
export async function modelNodes(
  result: ModelResult,
  name: string,
): Promise<SceneNode[]> {
  const nodes = await importModel(
    base64ToBytes(result.base64).buffer,
    result.name,
    [],
    true,
  );
  return nodes.map((node, i) => ({
    ...node,
    name:
      nodes.length === 1
        ? name.slice(0, 120)
        : `${name.slice(0, 100)} · ${i + 1}`,
  }));
}
export function generationRecord(
  image: string,
  result: ModelResult,
  name: string,
  provider: string,
): GenerationRecord {
  return {
    id: uid(),
    name,
    date: new Date().toISOString(),
    image,
    modelBase64: result.base64,
    mime: result.mime,
    provider,
  };
}
export async function prepareImage(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Importez un PNG ou JPG de moins de 20 Mo.");
  const bitmap = await createImageBitmap(file);
  if (bitmap.width < 64 || bitmap.height < 64) {
    bitmap.close();
    throw new Error("La photo doit mesurer au moins 64 × 64 pixels.");
  }
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(file.type, 0.92);
}
export const imageProviderNames = {
  meshy: "Meshy",
  stability: "Stability Fast 3D",
  luma: "Luma · passerelle",
  generic: "API personnalisée",
};
export const imageProviderDefaults = {
  meshy: {
    endpoint: "https://api.meshy.ai/openapi/v1/image-to-3d",
    model: "meshy-6",
  },
  stability: {
    endpoint: "https://api.stability.ai/v2beta/3d/fast-3d",
    model: "fast-3d",
  },
  luma: { endpoint: "http://localhost:8000/image-to-3d", model: "luma" },
  generic: { endpoint: "http://localhost:8000/image-to-3d", model: "default" },
};
