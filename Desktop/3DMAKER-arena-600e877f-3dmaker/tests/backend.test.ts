import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalBackend,
  assertHttpUrl,
  validateSettings,
} from "../electron/backend";
import { DEFAULT_AI_SETTINGS, type GenerationRecord } from "../src/shared";
let directory: string;
let backend: LocalBackend;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "3dmaker-test-"));
  backend = new LocalBackend(
    directory,
    (text) => `encrypted:${text}`,
    (text) => text.replace(/^encrypted:/, ""),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
describe("Pont IA sécurisé et stockage local", () => {
  it("détecte un vrai serveur local sans lui envoyer une clé cloud", async () => {
    const settings = structuredClone(DEFAULT_AI_SETTINGS);
    settings.chat.apiKey = "cle-privee-cloud";
    await backend.saveSettings(settings);
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _options?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: "qwen3:8b" }] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await backend.probeLocalAI()).toEqual({
      available: true,
      models: ["qwen3:8b"],
    });
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:11434/v1/models");
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("headers.Authorization");
  });
  it("ne prétend pas détecter un modèle si le serveur local est absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Connexion refusée");
      }),
    );
    expect(await backend.probeLocalAI()).toEqual({
      available: false,
      models: [],
    });
  });
  it("refuse une profondeur de raisonnement inconnue", () => {
    const settings = structuredClone(DEFAULT_AI_SETTINGS);
    (settings.chat as unknown as { reasoning: string }).reasoning =
      "imaginaire";
    expect(() => validateSettings(settings)).toThrow("Options");
  });
  it("retourne une configuration vide sans clé inventée", async () => {
    const settings = await backend.getSettings();
    expect(settings.image.apiKey).toBe("");
    expect(settings.chat.apiKey).toBe("");
  });
  it("chiffre les clés en écriture et les récupère sans perte", async () => {
    const settings = structuredClone(DEFAULT_AI_SETTINGS);
    settings.image.apiKey = "cle-test";
    await backend.saveSettings(settings);
    expect(await readFile(join(directory, "settings.json"), "utf8")).toContain(
      "encrypted:cle-test",
    );
    expect((await backend.getSettings()).image.apiKey).toBe("cle-test");
  });
  it("refuse les protocoles de fichiers et les URL avec identifiants", () => {
    expect(() => assertHttpUrl("file:///etc/passwd")).toThrow("HTTP");
    expect(() => assertHttpUrl("https://user:password@example.com")).toThrow(
      "identifiants",
    );
    expect(assertHttpUrl("http://localhost:11434/v1").hostname).toBe(
      "localhost",
    );
  });
  it("valide les limites des paramètres", () => {
    const s = structuredClone(DEFAULT_AI_SETTINGS);
    s.image.targetPolygons = 400000;
    expect(() => validateSettings(s)).toThrow("polygones");
  });
  it("n’envoie pas une clé API à une origine non configurée", async () => {
    const s = structuredClone(DEFAULT_AI_SETTINGS);
    s.chat.apiKey = "cle-privee";
    await backend.saveSettings(s);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      backend.request({
        service: "chat",
        method: "POST",
        url: "https://evil.example.com/chat",
      }),
    ).rejects.toThrow("serveur configuré");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("exécute une requête OpenAI-compatible avec l’authentification serveur", async () => {
    const s = structuredClone(DEFAULT_AI_SETTINGS);
    s.chat.apiKey = "cle-privee";
    await backend.saveSettings(s);
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _options?: RequestInit) =>
        new Response(JSON.stringify({ choices: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await backend.request({
      service: "chat",
      method: "POST",
      url: `${s.chat.endpoint}/chat/completions`,
      body: { model: s.chat.model },
    });
    expect(response.data).toEqual({ choices: [] });
    const options = fetch.mock.calls[0][1] as RequestInit;
    expect(options.headers).toMatchObject({
      Authorization: "Bearer cle-privee",
    });
    expect(JSON.parse(options.body as string).model).toBe(s.chat.model);
  });
  it("authentifie Claude avec x-api-key et anthropic-version, sans Bearer", async () => {
    const s = structuredClone(DEFAULT_AI_SETTINGS);
    s.chat = {
      ...s.chat,
      protocol: "anthropic",
      endpoint: "https://api.anthropic.com/v1",
      model: "claude-sonnet-5-5",
      apiKey: "test-anthropic-only",
    };
    await backend.saveSettings(s);
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _options?: RequestInit) =>
        new Response(JSON.stringify({ content: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    for (const method of ["GET", "POST"] as const)
      await backend.request({
        service: "chat",
        method,
        url: `${s.chat.endpoint}/${method === "GET" ? "models" : "messages"}`,
        ...(method === "POST" ? { body: { model: s.chat.model } } : {}),
      });
    for (const [, options] of fetch.mock.calls) {
      expect(options?.headers).toMatchObject({
        "x-api-key": "test-anthropic-only",
        "anthropic-version": "2023-06-01",
      });
      expect(options?.headers).not.toHaveProperty("Authorization");
    }
  });
  it("ne transfère pas une clé Claude à une autre origine", async () => {
    const s = structuredClone(DEFAULT_AI_SETTINGS);
    s.chat = {
      ...s.chat,
      protocol: "anthropic",
      endpoint: "https://api.anthropic.com/v1",
      apiKey: "test-anthropic-only",
    };
    await backend.saveSettings(s);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      backend.request({
        service: "chat",
        method: "POST",
        url: "https://api.venice.ai/api/v1/messages",
      }),
    ).rejects.toThrow("serveur configuré");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("utilise Bearer pour Venice même si la précédente configuration était Claude", async () => {
    const s = structuredClone(DEFAULT_AI_SETTINGS);
    s.chat = {
      ...s.chat,
      protocol: "openai",
      endpoint: "https://api.venice.ai/api/v1",
      apiKey: "test-venice-only",
      model: "default",
    };
    await backend.saveSettings(s);
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _options?: RequestInit) =>
        new Response(JSON.stringify({ choices: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await backend.request({
      service: "chat",
      method: "POST",
      body: { model: "default" },
    });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-venice-only",
    });
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty("x-api-key");
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty(
      "anthropic-version",
    );
  });
  it("ne change pas l’authentification photo quand Claude est sélectionné", async () => {
    const s = structuredClone(DEFAULT_AI_SETTINGS);
    s.chat.protocol = "anthropic";
    s.image.apiKey = "test-image-only";
    await backend.saveSettings(s);
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _options?: RequestInit) =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    await backend.request({ service: "image", method: "POST", body: {} });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-image-only",
    });
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty("x-api-key");
  });
  it("rejette un format d’API inconnu", () => {
    const s = structuredClone(DEFAULT_AI_SETTINGS);
    (s.chat as unknown as { protocol: string }).protocol = "arbitraire";
    expect(() => validateSettings(s)).toThrow("Options IA");
  });
  it("traduit les erreurs API pour l’utilisateur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"error":{"message":"Invalid key"}}', { status: 401 }),
      ),
    );
    await expect(
      backend.request({ service: "image", method: "POST", body: {} }),
    ).rejects.toThrow("Clé API absente ou invalide");
  });
  it("préserve les octets d’un retour binaire GLB", async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes, {
            headers: { "content-type": "model/gltf-binary" },
          }),
      ),
    );
    const result = await backend.request({
      service: "image",
      method: "POST",
      responseType: "binary",
      body: {},
    });
    expect(Buffer.from(result.base64!, "base64")).toEqual(Buffer.from(bytes));
  });
  it("enregistre, liste, recharge et supprime une génération", async () => {
    const record: GenerationRecord = {
      id: "test-1",
      name: "Cube",
      image: "data:image/png;base64,AAAA",
      date: new Date().toISOString(),
      provider: "generic",
      modelBase64: "Z2xURg==",
      mime: "model/gltf-binary",
    };
    await backend.putGeneration(record);
    expect(await backend.getGenerations()).toHaveLength(1);
    expect((await backend.getGenerations())[0]).not.toHaveProperty(
      "modelBase64",
    );
    expect((await backend.getGeneration(record.id)).modelBase64).toBe(
      record.modelBase64,
    );
    await backend.deleteGeneration(record.id);
    expect(await backend.getGenerations()).toHaveLength(0);
    await expect(backend.deleteGeneration("../settings")).rejects.toThrow(
      "invalide",
    );
  });
});
