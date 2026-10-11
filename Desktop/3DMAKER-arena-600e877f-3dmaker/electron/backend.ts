import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  unlink,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_AI_SETTINGS,
  upgradeAISettings,
  type LocalAIProbe,
  type AISettings,
  type GenerationRecord,
  type GenerationSummary,
  type ProxyRequest,
  type ProxyResponse,
} from "../src/shared.ts";

const MAX_RESPONSE_BYTES = 180 * 1024 * 1024;
export function assertHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "URL invalide. Indiquez une adresse complète commençant par https:// ou http://.",
    );
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Seules les adresses HTTP et HTTPS sans identifiants intégrés sont autorisées.",
    );
  return url;
}
export function validateSettings(value: AISettings): AISettings {
  value = upgradeAISettings(value);
  if (!value?.image || !value?.chat)
    throw new Error("Configuration IA invalide.");
  assertHttpUrl(value.image.endpoint);
  assertHttpUrl(value.chat.endpoint);
  if (!["meshy", "luma", "stability", "generic"].includes(value.image.provider))
    throw new Error("Fournisseur IA inconnu.");
  if (!["low", "medium", "high"].includes(value.image.quality))
    throw new Error("Qualité du maillage invalide.");
  if (
    !Number.isFinite(value.image.targetPolygons) ||
    value.image.targetPolygons < 100 ||
    value.image.targetPolygons > 300000
  )
    throw new Error("Choisissez entre 100 et 300 000 polygones.");
  if (
    typeof value.image.texture !== "boolean" ||
    !["openai", "anthropic"].includes(value.chat.protocol) ||
    typeof value.chat.jsonMode !== "boolean" ||
    typeof value.chat.review !== "boolean" ||
    typeof value.chat.vision !== "boolean" ||
    !["low", "medium", "high"].includes(value.chat.reasoning)
  )
    throw new Error("Options IA invalides.");
  if (!value.chat.model.trim() || !value.image.model.trim())
    throw new Error("Indiquez un nom de modèle.");
  if (
    !Number.isFinite(value.chat.temperature) ||
    value.chat.temperature < 0 ||
    value.chat.temperature > 2
  )
    throw new Error("La température doit être comprise entre 0 et 2.");
  for (const key of [
    value.image.apiKey,
    value.chat.apiKey,
    value.image.model,
    value.chat.model,
  ])
    if (typeof key !== "string" || key.length > 4096)
      throw new Error("Configuration IA invalide.");
  return value;
}
export class LocalBackend {
  constructor(
    private directory: string,
    private encrypt: (text: string) => string = (text) => text,
    private decrypt: (text: string) => string = (text) => text,
  ) {}
  private async atomicWrite(file: string, data: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, file);
  }
  async getSettings(): Promise<AISettings> {
    try {
      const saved = JSON.parse(
        await readFile(join(this.directory, "settings.json"), "utf8"),
      ) as AISettings;
      saved.image.apiKey = this.decrypt(saved.image.apiKey);
      saved.chat.apiKey = this.decrypt(saved.chat.apiKey);
      return validateSettings(saved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return structuredClone(DEFAULT_AI_SETTINGS);
      throw new Error(
        "Les paramètres IA ne peuvent pas être lus. Vérifiez les droits du dossier de configuration.",
      );
    }
  }
  async saveSettings(settings: AISettings) {
    const safe = structuredClone(validateSettings(settings));
    safe.image.apiKey = this.encrypt(safe.image.apiKey);
    safe.chat.apiKey = this.encrypt(safe.chat.apiKey);
    await this.atomicWrite(
      join(this.directory, "settings.json"),
      JSON.stringify(safe, null, 2),
    );
  }
  async probeLocalAI(): Promise<LocalAIProbe> {
    // Endpoint fixe : aucun port arbitraire ni transfert de clé cloud.
    try {
      const response = await fetch("http://127.0.0.1:11434/v1/models", {
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (!response.ok) return { available: false, models: [] };
      const data = JSON.parse(
        (await readLimited(response)).toString("utf8"),
      ) as { data?: { id?: unknown }[] };
      const models = Array.isArray(data.data)
        ? data.data
            .flatMap((m) =>
              typeof m.id === "string" && m.id.length < 150 ? [m.id] : [],
            )
            .slice(0, 100)
        : [];
      return { available: models.length > 0, models };
    } catch {
      return { available: false, models: [] };
    }
  }
  async request(request: ProxyRequest): Promise<ProxyResponse> {
    const settings = await this.getSettings();
    if (
      !["image", "chat"].includes(request.service) ||
      !["GET", "POST", "DELETE"].includes(request.method)
    )
      throw new Error("Requête IA non autorisée.");
    const service = settings[request.service];
    const base = assertHttpUrl(service.endpoint);
    const url = assertHttpUrl(request.url || service.endpoint);
    if (url.origin !== base.origin)
      throw new Error("La requête doit rester sur le serveur configuré.");
    const headers: Record<string, string> = {};
    if (request.service === "chat" && settings.chat.protocol === "anthropic") {
      // La clé n’est pas fournie par le renderer et ne quitte jamais l’origine validée.
      headers["anthropic-version"] = "2023-06-01";
      if (service.apiKey) headers["x-api-key"] = service.apiKey;
    } else if (service.apiKey)
      headers.Authorization = `Bearer ${service.apiKey}`;
    let body: BodyInit | undefined;
    if (request.form) {
      const form = new FormData();
      for (const entry of request.form) {
        if (entry.filename)
          form.append(
            entry.name,
            new Blob([Buffer.from(entry.value, "base64")], {
              type: entry.mime || "application/octet-stream",
            }),
            entry.filename,
          );
        else form.append(entry.name, entry.value);
      }
      body = form;
    } else if (request.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(request.body);
    }
    if (request.service === "image" && settings.image.provider === "stability")
      headers.Accept = "model/gltf-binary";
    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(
          Math.min(request.timeoutMs || 120000, 300000),
        ),
        redirect: "error",
      });
    } catch (error) {
      if (
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
      )
        throw new Error(
          "Le serveur IA a mis trop de temps à répondre. Vous pouvez réessayer.",
        );
      throw new Error(
        "Impossible de joindre le serveur IA. Vérifiez la connexion et l’URL du service.",
      );
    }
    if (!response.ok) {
      const raw = (await readLimited(response)).toString("utf8").slice(0, 1500);
      let detail = raw;
      try {
        const value = JSON.parse(raw);
        detail = value.message || value.error?.message || value.error || raw;
      } catch {
        /* Le fournisseur peut retourner une erreur en texte brut. */
      }
      const translations: Record<number, string> = {
        401: "Clé API absente ou invalide",
        403: "Accès refusé par le fournisseur",
        402: "Crédits insuffisants",
        429: "Limite de requêtes atteinte",
        404: "Endpoint ou modèle introuvable",
        413: "Image trop volumineuse",
      };
      throw new Error(
        `${translations[response.status] || `Erreur du service IA (${response.status})`}. ${String(detail).slice(0, 500)}`,
      );
    }
    if (
      request.responseType === "binary" ||
      !response.headers.get("content-type")?.includes("json")
    ) {
      const data = await readLimited(response);
      return {
        status: response.status,
        base64: data.toString("base64"),
        mime: response.headers.get("content-type") || "model/gltf-binary",
      };
    }
    const text = (await readLimited(response)).toString("utf8");
    try {
      return { status: response.status, data: JSON.parse(text) };
    } catch {
      throw new Error(
        "Le serveur IA n’a pas retourné un JSON valide. Vérifiez l’endpoint configuré.",
      );
    }
  }
  async fetchAsset(value: string) {
    const url = assertHttpUrl(value);
    const settings = await this.getSettings();
    const sameProvider = url.origin === new URL(settings.image.endpoint).origin;
    const headers: Record<string, string> =
      sameProvider && settings.image.apiKey
        ? { Authorization: `Bearer ${settings.image.apiKey}` }
        : {};
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(
        `Téléchargement du modèle impossible (${response.status}).`,
      );
    return {
      base64: (await readLimited(response)).toString("base64"),
      mime: response.headers.get("content-type") || "application/octet-stream",
    };
  }
  async getGenerations(): Promise<GenerationSummary[]> {
    const dir = join(this.directory, "generations");
    await mkdir(dir, { recursive: true });
    const summaries: GenerationSummary[] = [];
    for (const file of (await readdir(dir)).filter((f) =>
      /^[a-zA-Z0-9-]+\.json$/.test(f),
    )) {
      try {
        const record = JSON.parse(
          await readFile(join(dir, file), "utf8"),
        ) as GenerationRecord;
        const { modelBase64: _model, ...summary } = record;
        if (typeof summary.id === "string" && typeof summary.date === "string")
          summaries.push(summary);
      } catch {
        /* Un fichier interrompu n’empêche pas de charger les autres générations. */
      }
    }
    return summaries.sort((a, b) => b.date.localeCompare(a.date));
  }
  async getGeneration(id: string): Promise<GenerationRecord> {
    if (!/^[a-zA-Z0-9-]+$/.test(id))
      throw new Error("Identifiant de génération invalide.");
    try {
      const record = JSON.parse(
        await readFile(
          join(this.directory, "generations", `${id}.json`),
          "utf8",
        ),
      ) as GenerationRecord;
      return record.modelBase64
        ? record
        : {
            ...record,
            modelBase64: (
              await readFile(join(this.directory, "generations", `${id}.model`))
            ).toString("base64"),
          };
    } catch {
      throw new Error(
        "Cette génération n’est plus disponible sur cet appareil.",
      );
    }
  }
  async putGeneration(record: GenerationRecord) {
    if (
      !/^[a-zA-Z0-9-]+$/.test(record.id) ||
      !record.modelBase64 ||
      !record.image ||
      record.modelBase64.length > MAX_RESPONSE_BYTES * 1.4
    )
      throw new Error("Génération invalide ou trop volumineuse.");
    const dir = join(this.directory, "generations");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const { modelBase64, ...summary } = record;
    const temporary = join(dir, `${record.id}.${randomUUID()}.tmp`);
    await writeFile(temporary, Buffer.from(modelBase64, "base64"), {
      mode: 0o600,
    });
    await rename(temporary, join(dir, `${record.id}.model`));
    await this.atomicWrite(
      join(dir, `${record.id}.json`),
      JSON.stringify(summary),
    );
  }
  async deleteGeneration(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Identifiant invalide.");
    for (const extension of ["json", "model"]) {
      try {
        await unlink(join(this.directory, "generations", `${id}.${extension}`));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  }
}
async function readLimited(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Le fichier dépasse la limite de 180 Mo.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export const newRequestId = () => randomUUID();
