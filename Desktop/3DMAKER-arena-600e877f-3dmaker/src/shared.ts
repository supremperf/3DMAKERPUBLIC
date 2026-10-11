export type AIProvider = "meshy" | "luma" | "stability" | "generic";
export type ChatProtocol = "openai" | "anthropic";
export interface AISettings {
  image: {
    provider: AIProvider;
    endpoint: string;
    apiKey: string;
    model: string;
    quality: "low" | "medium" | "high";
    targetPolygons: number;
    texture: boolean;
  };
  chat: {
    protocol: ChatProtocol;
    endpoint: string;
    apiKey: string;
    model: string;
    jsonMode: boolean;
    temperature: number;
    review: boolean;
    vision: boolean;
    reasoning: "low" | "medium" | "high";
  };
}
export const DEFAULT_AI_SETTINGS: AISettings = {
  image: {
    provider: "meshy",
    endpoint: "https://api.meshy.ai/openapi/v1/image-to-3d",
    apiKey: "",
    model: "meshy-6",
    quality: "high",
    targetPolygons: 30000,
    texture: true,
  },
  chat: {
    protocol: "openai",
    endpoint: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-6-sol",
    jsonMode: true,
    temperature: 0.3,
    review: true,
    vision: true,
    reasoning: "high",
  },
};
export interface LocalAIProbe {
  available: boolean;
  models: string[];
}
export interface ProxyRequest {
  service: "image" | "chat";
  url?: string;
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
  form?: { name: string; value: string; filename?: string; mime?: string }[];
  responseType?: "json" | "binary";
  timeoutMs?: number;
}
export interface ProxyResponse {
  status: number;
  data?: unknown;
  base64?: string;
  mime?: string;
}
export interface GenerationRecord {
  id: string;
  name: string;
  date: string;
  image: string;
  modelBase64: string;
  mime: string;
  provider: string;
}
export type GenerationSummary = Omit<GenerationRecord, "modelBase64">;
export interface DesktopBridge {
  platform: string;
  getSettings(): Promise<AISettings>;
  saveSettings(settings: AISettings): Promise<void>;
  probeLocalAI(): Promise<LocalAIProbe>;
  request(request: ProxyRequest): Promise<ProxyResponse>;
  fetchAsset(url: string): Promise<{ base64: string; mime: string }>;
  openFile(
    filters: { name: string; extensions: string[] }[],
  ): Promise<{ name: string; base64: string } | null>;
  saveFile(
    name: string,
    base64: string,
    filters?: { name: string; extensions: string[] }[],
  ): Promise<boolean>;
  saveBundle(
    name: string,
    files: { path: string; base64: string }[],
  ): Promise<boolean>;
  setDirty(dirty: boolean): void;
  getGenerations(): Promise<GenerationSummary[]>;
  getGeneration(id: string): Promise<GenerationRecord>;
  putGeneration(record: GenerationRecord): Promise<void>;
  deleteGeneration(id: string): Promise<void>;
  setFullscreen(): Promise<void>;
  windowAction(action: "minimize" | "maximize" | "close"): void;
}

/** Complète les paramètres des anciennes versions sans écraser les clés ou endpoints personnels. */
export function upgradeAISettings(value: AISettings): AISettings {
  if (!value?.image || !value?.chat)
    throw new Error("Configuration IA invalide.");
  return {
    image: { ...DEFAULT_AI_SETTINGS.image, ...value.image },
    chat: {
      ...DEFAULT_AI_SETTINGS.chat,
      ...value.chat,
      protocol: value.chat.protocol ?? inferChatProtocol(value.chat.endpoint),
    },
  };
}

/** Les anciennes configurations Claude utilisant l’origine officielle passent au format natif. */
export function inferChatProtocol(endpoint: string): ChatProtocol {
  try {
    return new URL(endpoint).hostname === "api.anthropic.com"
      ? "anthropic"
      : "openai";
  } catch {
    return "openai";
  }
}
