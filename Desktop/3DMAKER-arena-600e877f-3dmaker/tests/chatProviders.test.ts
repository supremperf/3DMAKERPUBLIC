import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  upgradeAISettings,
  type AISettings,
} from "../src/shared";
import {
  chatBase,
  chooseRecommendedModel,
  isChatConfigured,
  listChatModels,
  listChatModelDetails,
  getChatModelInfo,
  requestChatCompletion,
  testChatInference,
  updateChatEndpoint,
} from "../src/services/chatProviders";
import { bridge } from "../src/services/bridge";
vi.mock("../src/services/bridge", () => ({ bridge: { request: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
describe("IA préconfigurée, modèles réels et vérification", () => {
  it("n’invente aucune clé et configure la validation et le raisonnement", () => {
    expect(DEFAULT_AI_SETTINGS.chat.apiKey).toBe("");
    expect(DEFAULT_AI_SETTINGS.chat.review).toBe(true);
    expect(DEFAULT_AI_SETTINGS.chat.reasoning).toBe("high");
  });
  it("nécessite une clé pour OpenAI mais pas pour Ollama", () => {
    expect(isChatConfigured(DEFAULT_AI_SETTINGS.chat)).toBe(false);
    expect(
      isChatConfigured({
        ...DEFAULT_AI_SETTINGS.chat,
        endpoint: "http://127.0.0.1:11434/v1",
      }),
    ).toBe(true);
  });
  it("normalise les URL du chat", () => {
    expect(chatBase("https://example.com/v1/chat/completions/")).toBe(
      "https://example.com/v1",
    );
    expect(() => chatBase("file:///tmp/test")).toThrow("HTTP");
  });
  it("choisit une version récente et non un modèle audio, image ou mini", () => {
    expect(
      chooseRecommendedModel(
        [
          "gpt-image-1",
          "gpt-4.1",
          "gpt-6-sol",
          "gpt-6-astra",
          "gpt-6.1-sol",
          "gpt-6.1-mini",
          "tts-1",
        ],
        "https://api.openai.com/v1",
      ),
    ).toBe("gpt-6.1-sol");
  });
  it("ne choisit jamais un modèle inaccessible ou absent de la liste", () => {
    expect(
      chooseRecommendedModel(
        ["gpt-5.4-mini", "gpt-4.1"],
        "https://api.openai.com/v1",
      ),
    ).toBe("gpt-5.4-mini");
    expect(
      chooseRecommendedModel(
        ["whisper-1", "text-embedding-3-large"],
        "https://api.openai.com/v1",
      ),
    ).toBeUndefined();
  });
  it("reconnaît les modèles locaux sans forcer un nom inexistant", () => {
    expect(
      chooseRecommendedModel(
        ["nomic-embed-text", "qwen3:8b", "qwen3:30b"],
        "http://localhost:11434/v1",
      ),
    ).toBe("qwen3:30b");
  });
  it("ne transfère pas une clé au changement d’origine, même pendant la saisie", () => {
    const chat = { ...DEFAULT_AI_SETTINGS.chat, apiKey: "cle-personnelle" };
    expect(updateChatEndpoint(chat, "http://localhost:11434/v1").apiKey).toBe(
      "",
    );
    expect(updateChatEndpoint(chat, "https://api.openai.com/v2").apiKey).toBe(
      "cle-personnelle",
    );
    expect(updateChatEndpoint(chat, "htt").apiKey).toBe("");
  });
  it("n’affiche pas comme configuré un protocole non HTTP", () => {
    expect(
      isChatConfigured({
        ...DEFAULT_AI_SETTINGS.chat,
        endpoint: "file:///tmp/model",
      }),
    ).toBe(false);
  });
  it("complète les configurations de la première version sans perdre la clé", () => {
    const {
      review: _r,
      vision: _v,
      reasoning: _depth,
      ...legacy
    } = DEFAULT_AI_SETTINGS.chat;
    const migrated = upgradeAISettings({
      image: DEFAULT_AI_SETTINGS.image,
      chat: { ...legacy, apiKey: "cle-personnelle", model: "personnel" },
    } as AISettings);
    expect(migrated.chat.apiKey).toBe("cle-personnelle");
    expect(migrated.chat.model).toBe("personnel");
    expect(migrated.chat.review).toBe(true);
  });
  it("extrait une liste de modèles réellement reçue et dédupliquée", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: { data: [{ id: "qwen3:8b" }, { id: "qwen3:8b" }, { id: 7 }] },
    });
    expect(await listChatModels(DEFAULT_AI_SETTINGS)).toEqual(["qwen3:8b"]);
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "https://api.openai.com/v1/models",
      }),
    );
  });
  it("ne déclare pas disponible un serveur sans modèle", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: { data: [] },
    });
    await expect(listChatModels(DEFAULT_AI_SETTINGS)).rejects.toThrow(
      "aucun modèle",
    );
  });
  it("teste réellement une inférence JSON sans action de scène", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: '{"message":"Connexion établie","actions":[]}',
            },
          },
        ],
      },
    });
    await testChatInference(DEFAULT_AI_SETTINGS);
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          model: DEFAULT_AI_SETTINGS.chat.model,
          max_completion_tokens: 1500,
        }),
      }),
    );
  });
  it("rejette un modèle qui ne respecte pas le contrat JSON", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: { choices: [{ message: { content: "Bonjour" } }] },
    });
    await expect(testChatInference(DEFAULT_AI_SETTINGS)).rejects.toThrow(
      "format de commandes",
    );
  });
  it("rejette un test qui invente une action à appliquer", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: '{"message":"ok","actions":[{"type":"delete"}]}',
            },
          },
        ],
      },
    });
    await expect(testChatInference(DEFAULT_AI_SETTINGS)).rejects.toThrow(
      "format de commandes",
    );
  });
});

describe("Catalogues et inférence Claude / Venice", () => {
  const native: AISettings = {
    ...DEFAULT_AI_SETTINGS,
    chat: {
      ...DEFAULT_AI_SETTINGS.chat,
      protocol: "anthropic",
      endpoint: "https://api.anthropic.com/v1",
      model: "claude-sonnet-5-5",
      apiKey: "test-only",
    },
  };
  const venice: AISettings = {
    ...DEFAULT_AI_SETTINGS,
    chat: {
      ...DEFAULT_AI_SETTINGS.chat,
      protocol: "openai",
      endpoint: "https://api.venice.ai/api/v1",
      model: "default",
      apiKey: "test-only",
      vision: false,
    },
  };
  it("suit les pages Claude et ignore les modèles retirés", async () => {
    vi.mocked(bridge.request)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              id: "claude-sonnet-5-5",
              capabilities: { image_input: { supported: true } },
              max_tokens: 64000,
            },
          ],
          has_more: true,
          last_id: "claude-sonnet-5-5",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            { id: "claude-opus-5-5" },
            { id: "retired-claude", lifecycle: "retired" },
          ],
          has_more: false,
        },
      });
    const models = await listChatModelDetails(native);
    expect(models.map((m) => m.id)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
    ]);
    expect(models[1]).toMatchObject({ vision: true, maxTokens: 64000 });
    expect(vi.mocked(bridge.request).mock.calls[0][0].url).toBe(
      "https://api.anthropic.com/v1/models?limit=100",
    );
    expect(vi.mocked(bridge.request).mock.calls[1][0].url).toContain(
      "after_id=claude-sonnet-5-5",
    );
  });
  it("refuse une pagination Claude cyclique", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: {
        data: [{ id: "claude-test" }],
        has_more: true,
        last_id: "claude-test",
      },
    });
    await expect(listChatModels(native)).rejects.toThrow("pagination");
    expect(bridge.request).toHaveBeenCalledTimes(2);
  });
  it("ne lance aucune requête de découverte déjà annulée", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      listChatModels(native, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(bridge.request).not.toHaveBeenCalled();
  });
  it("distingue le catalogue textuel Venice, les modèles hors ligne et les capacités", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: {
        data: [
          {
            id: "fixture-glm",
            type: "text",
            model_spec: {
              maxCompletionTokens: 4096,
              traits: ["default"],
              capabilities: {
                supportsVision: false,
                supportsResponseSchema: true,
                supportsReasoningEffort: true,
                reasoningEffortOptions: ["high"],
              },
            },
          },
          { id: "image-model", type: "image" },
          { id: "offline-model", type: "text", model_spec: { offline: true } },
        ],
      },
    });
    expect(await listChatModels(venice)).toEqual(["fixture-glm"]);
    expect(vi.mocked(bridge.request).mock.calls[0][0].url).toBe(
      "https://api.venice.ai/api/v1/models?type=text",
    );
    expect(getChatModelInfo(venice.chat)).toMatchObject({
      id: "fixture-glm",
      maxTokens: 4096,
      vision: false,
      jsonSchema: true,
    });
  });
  it("teste Claude avec une réponse native tool_use sans action de scène", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            type: "tool_use",
            name: "proposer_plan_3dmaker",
            input: { message: "Connexion établie", actions: [] },
          },
        ],
        stop_reason: "tool_use",
      },
    });
    await testChatInference(native);
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.anthropic.com/v1/messages",
        body: expect.objectContaining({
          max_tokens: 512,
          system: expect.any(String),
          tools: expect.any(Array),
        }),
      }),
    );
  });
  it("teste Venice avec ses paramètres et sans format Claude", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: {
        choices: [{ message: { content: '{"message":"OK","actions":[]}' } }],
      },
    });
    await testChatInference(venice);
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.venice.ai/api/v1/chat/completions",
        body: expect.objectContaining({
          max_completion_tokens: 1500,
          venice_parameters: expect.objectContaining({
            include_venice_system_prompt: false,
            disable_thinking: true,
          }),
        }),
      }),
    );
    expect(vi.mocked(bridge.request).mock.calls[0][0].body).not.toHaveProperty(
      "tools",
    );
  });
  it("annule l’attente d’une vraie requête sans inventer de réponse", async () => {
    vi.mocked(bridge.request).mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = requestChatCompletion(
      native,
      { system: "test", messages: [{ role: "user", content: "test" }] },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });
});
