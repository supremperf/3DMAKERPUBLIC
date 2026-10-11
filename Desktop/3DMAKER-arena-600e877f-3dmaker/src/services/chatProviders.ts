import { bridge } from "./bridge";
import { abortable } from "./abort";
import type { AISettings } from "../shared";
import {
  buildChatCompletion,
  readChatCompletion,
  chatBase,
  chatProtocol,
  isOfficialOpenAI,
  isVenice,
  type ChatCompletionOptions,
  type ChatModelInfo,
} from "./chatProtocol";
export {
  chatBase,
  chatProtocol,
  isChatConfigured,
  isOfficialOpenAI,
  isVenice,
  requiresChatKey,
  chatProviderLabel,
  updateChatEndpoint,
} from "./chatProtocol";
export type { ChatModelInfo } from "./chatProtocol";
export const CHAT_PRESETS = [
  {
    id: "openai",
    name: "OpenAI · capacité élevée",
    description:
      "Raisonnement approfondi et compréhension visuelle. Clé personnelle et crédits requis.",
    endpoint: "https://api.openai.com/v1",
    protocol: "openai",
    model: "gpt-6-sol",
    vision: true,
    jsonMode: true,
    requiresKey: true,
  },
  {
    id: "openai-fast",
    name: "OpenAI · rapide",
    description:
      "Réponses plus légères pour les modifications quotidiennes. Clé personnelle requise.",
    endpoint: "https://api.openai.com/v1",
    protocol: "openai",
    model: "gpt-5.4-mini",
    vision: true,
    jsonMode: true,
    requiresKey: true,
  },
  {
    id: "claude-opus",
    name: "Claude · Opus",
    description:
      "API native Anthropic, plans JSON et vue de scène. Clé API Anthropic et crédits requis ; un abonnement Claude seul ne fournit pas cette clé.",
    endpoint: "https://api.anthropic.com/v1",
    protocol: "anthropic",
    model: "claude-opus-5-5",
    vision: true,
    jsonMode: true,
    requiresKey: true,
  },
  {
    id: "claude-sonnet",
    name: "Claude · Sonnet",
    description:
      "API native Anthropic. Choisissez un modèle Sonnet autorisé à votre compte avec Détecter, puis testez la connexion.",
    endpoint: "https://api.anthropic.com/v1",
    protocol: "anthropic",
    model: "claude-sonnet-5-5",
    vision: true,
    jsonMode: true,
    requiresKey: true,
  },
  {
    id: "claude-haiku",
    name: "Claude · Haiku",
    description:
      "API native Anthropic. Préréglage Haiku pour les demandes courtes ; clé API et crédits requis.",
    endpoint: "https://api.anthropic.com/v1",
    protocol: "anthropic",
    model: "claude-haiku-5-5",
    vision: true,
    jsonMode: true,
    requiresKey: true,
  },
  {
    id: "venice",
    name: "Venice.ai",
    description:
      "Clé API Venice et crédits requis. Le modèle « default » est résolu par Venice ; Détecter permet de choisir un modèle précis. La vision dépend du modèle.",
    endpoint: "https://api.venice.ai/api/v1",
    protocol: "openai",
    model: "default",
    vision: false,
    jsonMode: true,
    requiresKey: true,
  },
  {
    id: "ollama",
    name: "Ollama · sur votre ordinateur",
    description:
      "Sans clé ni crédits. Ollama et un modèle doivent être installés ; la vitesse dépend de votre matériel.",
    endpoint: "http://127.0.0.1:11434/v1",
    protocol: "openai",
    model: "qwen3:8b",
    vision: false,
    jsonMode: true,
    requiresKey: false,
  },
  {
    id: "lmstudio",
    name: "LM Studio · sur votre ordinateur",
    description:
      "Activez le serveur local dans LM Studio, puis choisissez un modèle disponible.",
    endpoint: "http://127.0.0.1:1234/v1",
    protocol: "openai",
    model: "local-model",
    vision: false,
    jsonMode: false,
    requiresKey: false,
  },
] as const;
export function findChatPreset(chat: AISettings["chat"]) {
  const matches = CHAT_PRESETS.filter(
    (p) => p.endpoint === chat.endpoint && p.protocol === chatProtocol(chat),
  );
  return (
    matches.find((p) => p.model === chat.model) ||
    matches.find(
      (p) =>
        p.protocol === "anthropic" &&
        chat.model.startsWith(`claude-${p.id.replace("claude-", "")}-`),
    ) ||
    matches[0]
  );
}
export function chooseRecommendedModel(
  models: string[],
  endpoint: string,
  preferredModel?: string,
): string | undefined {
  const official = isOfficialOpenAI(endpoint),
    claude = (() => {
      try {
        return new URL(endpoint).hostname === "api.anthropic.com";
      } catch {
        return false;
      }
    })();
  let candidates = models.filter(
    (id) =>
      !/embedding|embed-|whisper|tts|audio|realtime|moderation|dall-e|image-|codex|search|transcrib/i.test(
        id,
      ),
  );
  if (claude && preferredModel) {
    const family = preferredModel.match(
      /^claude-(opus|sonnet|haiku|fable|mythos)-/,
    )?.[1];
    const matching = family
      ? candidates.filter((id) => id.startsWith(`claude-${family}-`))
      : [];
    if (matching.length) candidates = matching;
  }
  const score = (id: string) => {
    if (official) {
      const version = id.match(/^gpt-(\d+)(?:\.(\d+))?/);
      if (!version && !/^o[134](?:[.-]|$)/.test(id)) return -1;
      const base = version
        ? Number(version[1]) * 1000 + Number(version[2] || 0) * 100
        : 4200;
      return (
        base +
        (/pro|astra|sol/.test(id) ? 25 : 0) -
        (/mini/.test(id) ? 150 : 0) -
        (/nano/.test(id) ? 300 : 0) -
        (/\d{4}-\d{2}-\d{2}/.test(id) ? 1 : 0)
      );
    }
    if (claude) {
      const version = id.match(
        /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[.-](\d{1,2})(?:-|$))?/,
      );
      if (!version) return -1;
      return (
        Number(version[2]) * 1000 +
        Number(version[3] || 0) * 100 +
        ({ opus: 40, sonnet: 30, haiku: 10, fable: 20, mythos: 20 }[
          version[1]
        ] || 0) -
        (/\d{8}$/.test(id) ? 1 : 0)
      );
    }
    return (
      (/qwen3|deepseek-r1|llama3|gemma3/i.test(id) ? 100 : 0) +
      Number(id.match(/[: -](\d+(?:\.\d+)?)b/i)?.[1] || 0)
    );
  };
  return candidates
    .filter((id) => score(id) >= 0)
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
}

// Métadonnées reçues du catalogue, non des capacités inventées. Jamais de clé dans ce cache.
const modelCache = new Map<string, { info: ChatModelInfo; expires: number }>();
const modelKey = (chat: AISettings["chat"], id: string) =>
  `${chatBase(chat.endpoint)}|${chatProtocol(chat)}|${id}`;
export function getChatModelInfo(
  chat: AISettings["chat"],
  id = chat.model,
): ChatModelInfo | undefined {
  try {
    const cached = modelCache.get(modelKey(chat, id));
    return cached && cached.expires > Date.now() ? cached.info : undefined;
  } catch {
    return undefined;
  }
}
function remember(chat: AISettings["chat"], info: ChatModelInfo) {
  if (modelCache.size > 4000) modelCache.clear();
  const entry = { info, expires: Date.now() + 5 * 60 * 1000 };
  modelCache.set(modelKey(chat, info.id), entry);
  if (isVenice(chat.endpoint))
    for (const trait of info.traits || [])
      modelCache.set(modelKey(chat, trait), entry);
}
export async function listChatModelDetails(
  settings: AISettings,
  signal?: AbortSignal,
): Promise<ChatModelInfo[]> {
  const native = chatProtocol(settings.chat) === "anthropic",
    venice = isVenice(settings.chat.endpoint);
  const models = new Map<string, ChatModelInfo>();
  let cursor: string | undefined;
  const cursors = new Set<string>();
  for (let page = 0; page < 10; page++) {
    if (signal?.aborted)
      throw new DOMException("Détection annulée.", "AbortError");
    const url = new URL(`${chatBase(settings.chat.endpoint)}/models`);
    if (venice) url.searchParams.set("type", "text");
    if (native) {
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("after_id", cursor);
    }
    const request = bridge.request({
      service: "chat",
      method: "GET",
      url: url.toString(),
      timeoutMs: 15000,
    });
    const response = signal ? await abortable(request, signal) : await request;
    const data = response.data as {
      data?: {
        id?: unknown;
        type?: unknown;
        lifecycle?: unknown;
        max_tokens?: unknown;
        capabilities?: { image_input?: { supported?: boolean } };
        model_spec?: {
          offline?: boolean;
          maxCompletionTokens?: unknown;
          traits?: unknown;
          capabilities?: {
            supportsVision?: boolean;
            supportsResponseSchema?: boolean;
            supportsReasoningEffort?: boolean;
            reasoningEffortOptions?: unknown;
          };
        };
      }[];
      has_more?: unknown;
      last_id?: unknown;
    } | null;
    if (!Array.isArray(data?.data))
      throw new Error(
        "Le serveur n’a pas retourné un catalogue de modèles valide.",
      );
    for (const model of data.data.slice(0, 2000)) {
      if (
        !model ||
        typeof model.id !== "string" ||
        !model.id.trim() ||
        model.id.length > 150 ||
        model.lifecycle === "retired" ||
        model.model_spec?.offline ||
        (venice && model.type && model.type !== "text")
      )
        continue;
      const spec = model.model_spec,
        caps = spec?.capabilities;
      const limit = native ? model.max_tokens : spec?.maxCompletionTokens;
      const info: ChatModelInfo = {
        id: model.id,
        ...(typeof (native
          ? model.capabilities?.image_input?.supported
          : caps?.supportsVision) === "boolean"
          ? {
              vision: native
                ? model.capabilities?.image_input?.supported
                : caps?.supportsVision,
            }
          : {}),
        ...(!native && typeof caps?.supportsResponseSchema === "boolean"
          ? { jsonSchema: caps.supportsResponseSchema }
          : {}),
        ...(typeof limit === "number" &&
        Number.isInteger(limit) &&
        limit >= 128 &&
        limit <= 1000000
          ? { maxTokens: limit }
          : {}),
        ...(Array.isArray(spec?.traits)
          ? {
              traits: spec.traits.filter(
                (s): s is string => typeof s === "string" && s.length <= 150,
              ),
            }
          : {}),
        ...(caps?.supportsReasoningEffort &&
        Array.isArray(caps.reasoningEffortOptions)
          ? {
              reasoningEfforts: caps.reasoningEffortOptions.filter(
                (s): s is string => typeof s === "string",
              ),
            }
          : {}),
      };
      models.set(info.id, info);
      remember(settings.chat, info);
    }
    if (!native || !data.has_more) break;
    if (
      typeof data.last_id !== "string" ||
      !data.last_id ||
      data.last_id.length > 150 ||
      cursors.has(data.last_id)
    )
      throw new Error(
        "Le catalogue Claude a retourné une pagination invalide.",
      );
    if (page === 9)
      throw new Error(
        "Le catalogue Claude comporte trop de pages. Précisez directement un nom de modèle.",
      );
    cursor = data.last_id;
    cursors.add(cursor);
  }
  if (!models.size)
    throw new Error(
      "Le serveur est disponible mais aucun modèle n’est installé ou accessible.",
    );
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export async function listChatModels(
  settings: AISettings,
  signal?: AbortSignal,
): Promise<string[]> {
  return (await listChatModelDetails(settings, signal)).map(
    (model) => model.id,
  );
}
export function recommendChatModel(
  models: ChatModelInfo[],
  chat: AISettings["chat"],
): string | undefined {
  let candidates = models.filter(
    (model) =>
      (!chat.vision || model.vision !== false) &&
      (!chat.jsonMode || model.jsonSchema !== false),
  );
  if (!candidates.length) candidates = models;
  if (isVenice(chat.endpoint)) {
    const preferred = [
      chat.model,
      "default",
      "most_intelligent",
      "highest_quality",
    ];
    for (const trait of preferred) {
      const match = candidates.find((model) => model.traits?.includes(trait));
      if (match) return match.id;
    }
  }
  return chooseRecommendedModel(
    candidates.map((model) => model.id),
    chat.endpoint,
    chat.model,
  );
}
export async function requestChatCompletion(
  settings: AISettings,
  options: ChatCompletionOptions,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException("Demande annulée.", "AbortError");
  const request = buildChatCompletion(settings.chat, {
    ...options,
    modelInfo: getChatModelInfo(settings.chat),
  });
  const pending = bridge.request(request);
  const response = signal ? await abortable(pending, signal) : await pending;
  if (signal?.aborted) throw new DOMException("Demande annulée.", "AbortError");
  return readChatCompletion(settings.chat, response.data);
}
export async function testChatInference(settings: AISettings): Promise<void> {
  const content = await requestChatCompletion(settings, {
    system:
      "Test de connexion 3DMAKER. Réponds avec un objet JSON contenant un message non vide et actions:[], sans code, sans modification de scène.",
    messages: [
      {
        role: "user",
        content:
          'Test de connexion : réponds uniquement avec le JSON {"message":"Connexion établie","actions":[]}. N’ajoute aucune action.',
      },
    ],
    test: true,
  });
  try {
    const parsed = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
    if (
      !parsed ||
      typeof parsed.message !== "string" ||
      !parsed.message.trim() ||
      !Array.isArray(parsed.actions) ||
      parsed.actions.length
    )
      throw new Error();
  } catch {
    throw new Error(
      "Le modèle répond, mais ne respecte pas le format de commandes de 3DMAKER. Activez le mode JSON ou choisissez un autre modèle.",
    );
  }
}
