import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  upgradeAISettings,
  type AISettings,
} from "../src/shared";
import {
  buildChatCompletion,
  readChatCompletion,
  chatBase,
  chatProviderLabel,
  updateChatEndpoint,
  isChatConfigured,
} from "../src/services/chatProtocol";
import {
  CHAT_PRESETS,
  findChatPreset,
  chooseRecommendedModel,
  recommendChatModel,
} from "../src/services/chatProviders";
const native: AISettings["chat"] = {
  ...DEFAULT_AI_SETTINGS.chat,
  protocol: "anthropic",
  endpoint: "https://api.anthropic.com/v1",
  model: "claude-sonnet-5-5",
  apiKey: "test-only",
};
const venice: AISettings["chat"] = {
  ...DEFAULT_AI_SETTINGS.chat,
  protocol: "openai",
  endpoint: "https://api.venice.ai/api/v1",
  model: "default",
  apiKey: "test-only",
  vision: false,
};
const options = {
  system: "Propose un plan validé.",
  messages: [{ role: "user" as const, content: "Colorie le cube" }],
};
const plan = {
  message: "Je propose un cube bleu",
  actions: [{ type: "set_material", material: { color: "#1122ff" } }],
};
const body = (
  chat: AISettings["chat"],
  extra: Parameters<typeof buildChatCompletion>[1] = options,
) => buildChatCompletion(chat, extra).body as Record<string, unknown>;

describe("Protocoles natifs Claude et Venice", () => {
  it("ajoute trois familles Claude et Venice, sans clé embarquée", () => {
    expect(
      CHAT_PRESETS.filter((p) => p.protocol === "anthropic").map((p) => p.id),
    ).toEqual(["claude-opus", "claude-sonnet", "claude-haiku"]);
    expect(CHAT_PRESETS.find((p) => p.id === "venice")).toMatchObject({
      endpoint: "https://api.venice.ai/api/v1",
      model: "default",
      vision: false,
    });
    expect(CHAT_PRESETS.every((p) => !("apiKey" in p))).toBe(true);
  });
  it("normalise l’origine et le chemin Messages d’Anthropic", () => {
    expect(chatBase("https://api.anthropic.com")).toBe(
      "https://api.anthropic.com/v1",
    );
    expect(chatBase("https://api.anthropic.com/v1/messages/")).toBe(
      "https://api.anthropic.com/v1",
    );
    expect(() => chatBase("https://api.anthropic.com/v1?key=secret")).toThrow(
      "paramètres",
    );
  });
  it("exige une clé pour les trois services cloud, pas pour les passerelles locales", () => {
    for (const chat of [DEFAULT_AI_SETTINGS.chat, native, venice])
      expect(isChatConfigured({ ...chat, apiKey: "" })).toBe(false);
    expect(
      isChatConfigured({
        ...native,
        endpoint: "http://localhost:1234/v1",
        apiKey: "",
      }),
    ).toBe(true);
  });
  it("identifie les fournisseurs dans l’interface sans les appeler serveur personnel", () => {
    expect(chatProviderLabel(native)).toBe("Claude · Anthropic");
    expect(chatProviderLabel(venice)).toBe("Venice");
    expect(chatProviderLabel(DEFAULT_AI_SETTINGS.chat)).toBe("OpenAI");
  });
  it("migre le format des anciennes configurations sans perdre les clés", () => {
    const { protocol: _protocol, ...legacy } = native;
    const settings = upgradeAISettings({
      image: DEFAULT_AI_SETTINGS.image,
      chat: legacy,
    } as AISettings);
    expect(settings.chat.protocol).toBe("anthropic");
    expect(settings.chat.apiKey).toBe("test-only");
    const migrated = upgradeAISettings({
      image: DEFAULT_AI_SETTINGS.image,
      chat: { ...legacy, endpoint: venice.endpoint },
    } as AISettings);
    expect(migrated.chat.protocol).toBe("openai");
  });
  it("efface les clés entre fournisseurs, mais conserve le format d’une passerelle Claude", () => {
    expect(updateChatEndpoint(native, venice.endpoint)).toMatchObject({
      protocol: "openai",
      apiKey: "",
    });
    expect(updateChatEndpoint(venice, native.endpoint)).toMatchObject({
      protocol: "anthropic",
      apiKey: "",
    });
    expect(updateChatEndpoint(native, "http://localhost:8800/v1")).toEqual({
      endpoint: "http://localhost:8800/v1",
      apiKey: "",
    });
    expect(
      updateChatEndpoint(native, `${native.endpoint}/messages`).apiKey,
    ).toBe("test-only");
  });
  it("préserve le préréglage de famille après découverte d’un modèle daté", () => {
    expect(
      findChatPreset({ ...native, model: "claude-haiku-5-5-20261001" })?.id,
    ).toBe("claude-haiku");
    expect(
      chooseRecommendedModel(
        ["claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-4-6"],
        native.endpoint,
        native.model,
      ),
    ).toBe("claude-sonnet-5-5");
  });
  it("choisit une version Claude reçue du serveur, jamais un nom inventé", () => {
    expect(
      chooseRecommendedModel(
        ["claude-opus-4-8", "claude-opus-5-5", "claude-haiku-5-5"],
        native.endpoint,
      ),
    ).toBe("claude-opus-5-5");
    expect(
      chooseRecommendedModel(["embedding-example"], native.endpoint),
    ).toBeUndefined();
  });
  it("sépare system et messages, force uniquement l’outil JSON de plan Claude", () => {
    const request = buildChatCompletion(native, options),
      payload = request.body as Record<string, unknown>;
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(payload).toMatchObject({
      system: options.system,
      model: native.model,
      max_tokens: 12000,
      messages: options.messages,
      tool_choice: {
        type: "tool",
        name: "proposer_plan_3dmaker",
        disable_parallel_tool_use: true,
      },
    });
    expect(payload.tools).toEqual([
      expect.objectContaining({
        name: "proposer_plan_3dmaker",
        input_schema: expect.objectContaining({
          required: ["message", "actions"],
        }),
      }),
    ]);
    for (const key of [
      "apiKey",
      "response_format",
      "temperature",
      "reasoning_effort",
      "max_completion_tokens",
      "thinking",
    ])
      expect(payload).not.toHaveProperty(key);
  });
  it("convertit la vue JPEG en véritable bloc image Claude encodé base64", () => {
    const payload = body(native, {
      ...options,
      image: "data:image/jpeg;base64,AABBCC==",
    });
    expect(payload.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "AABBCC==",
            },
          },
          { type: "text", text: "Colorie le cube" },
        ],
      },
    ]);
    expect(() =>
      body(native, { ...options, image: "https://evil.example.com/image.jpg" }),
    ).toThrow("image intégrée");
  });
  it("n’envoie pas d’images à un modèle déclaré sans vision", () => {
    expect(() =>
      body(native, {
        ...options,
        image: "data:image/jpeg;base64,AABBCC==",
        modelInfo: { id: native.model, vision: false },
      }),
    ).toThrow("n’accepte pas");
    expect(() =>
      body(venice, { ...options, image: "data:image/jpeg;base64,AABBCC==" }),
    ).toThrow("n’accepte pas");
  });
  it("respecte la limite de tokens annoncée par un modèle", () => {
    expect(
      body(native, {
        ...options,
        modelInfo: { id: native.model, maxTokens: 4096 },
      }).max_tokens,
    ).toBe(4096);
    expect(
      body(venice, {
        ...options,
        modelInfo: { id: venice.model, maxTokens: 2048 },
      }).max_completion_tokens,
    ).toBe(2048);
  });
  it("permet Claude en texte JSON sans outil si le mode structuré est désactivé", () => {
    expect(body({ ...native, jsonMode: false })).not.toHaveProperty("tools");
    expect(
      readChatCompletion(
        { ...native, jsonMode: false },
        {
          content: [
            { type: "thinking", thinking: "ignoré" },
            { type: "text", text: JSON.stringify(plan) },
          ],
        },
      ),
    ).toBe(JSON.stringify(plan));
  });
  it("lit un outil de proposition Claude sans interpréter le raisonnement ou exécuter du code", () => {
    expect(
      readChatCompletion(native, {
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "ignoré" },
          { type: "tool_use", name: "proposer_plan_3dmaker", input: plan },
        ],
      }),
    ).toBe(JSON.stringify(plan));
    expect(() =>
      readChatCompletion(native, {
        content: [
          { type: "tool_use", name: "bash", input: { command: "anything" } },
        ],
      }),
    ).toThrow("non autorisé");
    expect(() =>
      readChatCompletion(native, {
        content: [
          { type: "tool_use", name: "proposer_plan_3dmaker", input: [] },
        ],
      }),
    ).toThrow("non autorisé");
  });
  it("refuse les outils multiples, les réponses tronquées et les refus Claude", () => {
    expect(() =>
      readChatCompletion(native, {
        content: [1, 2].map(() => ({
          type: "tool_use",
          name: "proposer_plan_3dmaker",
          input: plan,
        })),
      }),
    ).toThrow("non autorisé");
    expect(() =>
      readChatCompletion(native, { stop_reason: "max_tokens", content: [] }),
    ).toThrow("limite");
    expect(() =>
      readChatCompletion(native, { stop_reason: "refusal", content: [] }),
    ).toThrow("refusé");
    expect(() => readChatCompletion(native, {})).toThrow("aucun contenu");
  });
  it("utilise les paramètres Venice sans recherche web ni système concurrent", () => {
    const request = buildChatCompletion(venice, options),
      payload = request.body as Record<string, unknown>;
    expect(request.url).toBe("https://api.venice.ai/api/v1/chat/completions");
    expect(payload).toMatchObject({
      model: "default",
      max_completion_tokens: 12000,
      response_format: { type: "json_object" },
      venice_parameters: {
        include_venice_system_prompt: false,
        strip_thinking_response: true,
        enable_web_search: "off",
      },
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("reasoning_effort");
  });
  it("réduit le test Venice et ne promet pas de supprimer une facturation", () => {
    expect(body(venice, { ...options, test: true })).toMatchObject({
      max_completion_tokens: 1500,
      venice_parameters: { disable_thinking: true },
    });
    expect(body(native, { ...options, test: true }).max_tokens).toBe(512);
  });
  it("n’envoie un effort Venice que s’il figure dans les capacités reçues", () => {
    expect(
      body(venice, {
        ...options,
        modelInfo: { id: "default", reasoningEfforts: ["none", "high"] },
      }).reasoning_effort,
    ).toBe("high");
    expect(
      body(venice, {
        ...options,
        modelInfo: { id: "default", reasoningEfforts: ["none", "low"] },
      }),
    ).not.toHaveProperty("reasoning_effort");
  });
  it("recommande un trait Venice compatible avec la vision et le JSON demandés", () => {
    const models = [
      {
        id: "default-without-vision",
        traits: ["default"],
        vision: false,
        jsonSchema: true,
      },
      {
        id: "vision-capable",
        traits: ["most_intelligent"],
        vision: true,
        jsonSchema: true,
      },
    ];
    expect(recommendChatModel(models, { ...venice, vision: true })).toBe(
      "vision-capable",
    );
    expect(recommendChatModel(models, venice)).toBe("default-without-vision");
  });
  it("bloque le JSON incompatible et les réponses filtrées ou tronquées Venice", () => {
    expect(() =>
      body(venice, {
        ...options,
        modelInfo: { id: "default", jsonSchema: false },
      }),
    ).toThrow("mode JSON");
    expect(() =>
      readChatCompletion(venice, {
        choices: [
          {
            finish_reason: "content_filter",
            message: { content: JSON.stringify(plan) },
          },
        ],
      }),
    ).toThrow("refusé");
    expect(() =>
      readChatCompletion(venice, {
        choices: [{ finish_reason: "length", message: { content: "{" } }],
      }),
    ).toThrow("limite");
    expect(
      readChatCompletion(venice, {
        choices: [
          {
            message: {
              content: JSON.stringify(plan),
              reasoning_content: "ne pas utiliser",
            },
          },
        ],
      }),
    ).toBe(JSON.stringify(plan));
  });
});
