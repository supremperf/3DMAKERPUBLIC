import {
  inferChatProtocol,
  type AISettings,
  type ChatProtocol,
  type ProxyRequest,
} from "../shared";

type ChatSettings = AISettings["chat"];
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface ChatModelInfo {
  id: string;
  vision?: boolean;
  jsonSchema?: boolean;
  maxTokens?: number;
  traits?: string[];
  reasoningEfforts?: string[];
}
export interface ChatCompletionOptions {
  system: string;
  messages: ChatTurn[];
  image?: string;
  test?: boolean;
  modelInfo?: ChatModelInfo;
}
const PLAN_TOOL = "proposer_plan_3dmaker";
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string", minLength: 1, maxLength: 16000 },
    actions: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        properties: { type: { type: "string" } },
        required: ["type"],
        additionalProperties: true,
      },
    },
  },
  required: ["message", "actions"],
  additionalProperties: false,
};
export const chatProtocol = (chat: ChatSettings): ChatProtocol =>
  chat.protocol ?? inferChatProtocol(chat.endpoint);
const hostname = (endpoint: string) => {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "";
  }
};
export const isOfficialOpenAI = (endpoint: string) =>
  hostname(endpoint) === "api.openai.com";
export const isVenice = (endpoint: string) =>
  hostname(endpoint) === "api.venice.ai";
export const requiresChatKey = (chat: ChatSettings) =>
  ["api.openai.com", "api.anthropic.com", "api.venice.ai"].includes(
    hostname(chat.endpoint),
  );
export function chatProviderLabel(chat: ChatSettings): string {
  const host = hostname(chat.endpoint);
  if (host === "api.anthropic.com") return "Claude · Anthropic";
  if (host === "api.venice.ai") return "Venice";
  if (host === "api.openai.com") return "OpenAI";
  return chatProtocol(chat) === "anthropic"
    ? "Serveur compatible Claude"
    : "Serveur personnel";
}
export function chatBase(endpoint: string): string {
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "L’URL du chat doit être HTTP ou HTTPS, sans identifiants, paramètres ni fragment.",
    );
  url.pathname = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|messages)$/, "");
  if (url.hostname === "api.anthropic.com" && !url.pathname.replace(/\//g, ""))
    url.pathname = "/v1";
  return url.toString().replace(/\/+$/, "");
}
export function isChatConfigured(chat: ChatSettings): boolean {
  try {
    chatBase(chat.endpoint);
    return (
      !!chat.model.trim() && (!requiresChatKey(chat) || !!chat.apiKey.trim())
    );
  } catch {
    return false;
  }
}
/** Changer d’origine ne doit pas réutiliser la clé du fournisseur précédent. */
export function updateChatEndpoint(
  chat: ChatSettings,
  endpoint: string,
): Partial<ChatSettings> {
  let sameOrigin = false;
  try {
    sameOrigin = new URL(chat.endpoint).origin === new URL(endpoint).origin;
  } catch {
    /* Un brouillon d’URL n’est pas une origine de confiance. */
  }
  const knownProvider = [
    "api.openai.com",
    "api.anthropic.com",
    "api.venice.ai",
  ].includes(hostname(endpoint));
  return {
    endpoint,
    apiKey: sameOrigin ? chat.apiKey : "",
    ...(!sameOrigin && knownProvider
      ? { protocol: inferChatProtocol(endpoint) }
      : {}),
  };
}

/** Corps et chemin natifs ; jamais de clé ni d’en-tête arbitraire côté renderer. */
export function buildChatCompletion(
  chat: ChatSettings,
  options: ChatCompletionOptions,
): ProxyRequest {
  const native = chatProtocol(chat) === "anthropic",
    venice = isVenice(chat.endpoint);
  const info = options.modelInfo;
  if (!options.messages.length || options.messages.at(-1)?.role !== "user")
    throw new Error(
      "La dernière entrée du chat doit être une demande utilisateur.",
    );
  if (options.image && (!chat.vision || info?.vision === false))
    throw new Error(
      "Ce modèle n’accepte pas la vue de la scène. Désactivez la vision ou choisissez un modèle compatible.",
    );
  if (venice && chat.jsonMode && info?.jsonSchema === false)
    throw new Error(
      "Ce modèle Venice n’accepte pas le mode JSON structuré. Désactivez-le dans les réglages ou choisissez un autre modèle.",
    );
  const reasoning =
    isOfficialOpenAI(chat.endpoint) &&
    /^(gpt-[5-9]|o[134])(?:[.-]|$)/.test(chat.model);
  let maxTokens = options.test
    ? reasoning || venice
      ? 1500
      : native
        ? 512
        : 150
    : reasoning
      ? 20000
      : 12000;
  if (info?.maxTokens) maxTokens = Math.min(maxTokens, info.maxTokens);
  const messages: { role: string; content: unknown }[] = options.messages.map(
    (turn) => ({ ...turn }),
  );
  if (options.image) {
    if (native) {
      const image = options.image.match(
        /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/,
      );
      if (!image)
        throw new Error(
          "La capture transmise à Claude doit être une image intégrée valide.",
        );
      messages.at(-1)!.content = [
        {
          type: "image",
          source: { type: "base64", media_type: image[1], data: image[2] },
        },
        { type: "text", text: options.messages.at(-1)!.content },
      ];
    } else
      messages.at(-1)!.content = [
        { type: "text", text: options.messages.at(-1)!.content },
        { type: "image_url", image_url: { url: options.image, detail: "low" } },
      ];
  }
  let body: Record<string, unknown>;
  if (native) {
    body = {
      model: chat.model,
      max_tokens: maxTokens,
      system: options.system,
      messages,
      ...(chat.jsonMode
        ? {
            tools: [
              {
                name: PLAN_TOOL,
                description:
                  "Proposer un plan JSON pour la scène 3DMAKER. Aucune action n’est exécutée sans validation locale. Pour un test de connexion, actions doit rester vide.",
                input_schema: PLAN_SCHEMA,
              },
            ],
            tool_choice: {
              type: "tool",
              name: PLAN_TOOL,
              disable_parallel_tool_use: true,
            },
          }
        : {}),
    };
    // Pas de temperature, response_format, reasoning_effort ni thinking OpenAI envoyés à Claude.
  } else {
    body = {
      model: chat.model,
      ...(reasoning
        ? {
            max_completion_tokens: maxTokens,
            reasoning_effort: options.test ? "low" : chat.reasoning,
          }
        : venice
          ? { max_completion_tokens: maxTokens }
          : {
              max_tokens: maxTokens,
              temperature: options.test ? 0 : chat.temperature,
            }),
      ...(chat.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(venice
        ? {
            venice_parameters: {
              include_venice_system_prompt: false,
              strip_thinking_response: true,
              enable_web_search: "off",
              ...(options.test ? { disable_thinking: true } : {}),
            },
            ...(info?.reasoningEfforts?.includes(chat.reasoning) &&
            !options.test
              ? { reasoning_effort: chat.reasoning }
              : {}),
          }
        : {}),
      messages: [{ role: "system", content: options.system }, ...messages],
    };
  }
  return {
    service: "chat",
    method: "POST",
    url: `${chatBase(chat.endpoint)}/${native ? "messages" : "chat/completions"}`,
    timeoutMs: options.test ? 90000 : 180000,
    body,
  };
}

/** Les blocs thinking, tool_result ou outils arbitraires ne sont jamais interprétés comme un plan. */
export function readChatCompletion(chat: ChatSettings, data: unknown): string {
  if (chatProtocol(chat) === "anthropic") {
    const response = data as {
      stop_reason?: unknown;
      content?: {
        type?: unknown;
        text?: unknown;
        name?: unknown;
        input?: unknown;
      }[];
    } | null;
    if (response?.stop_reason === "max_tokens")
      throw new Error(
        "Claude a atteint la limite de réponse. Réduisez ou fractionnez votre demande.",
      );
    if (response?.stop_reason === "refusal")
      throw new Error(
        "Claude a refusé cette demande. Aucune modification n’a été appliquée.",
      );
    if (!Array.isArray(response?.content))
      throw new Error("Claude n’a retourné aucun contenu utilisable.");
    const tools = response.content.filter((block) => block.type === "tool_use");
    if (tools.length) {
      if (
        !chat.jsonMode ||
        tools.length !== 1 ||
        tools[0].name !== PLAN_TOOL ||
        !tools[0].input ||
        typeof tools[0].input !== "object" ||
        Array.isArray(tools[0].input)
      )
        throw new Error(
          "Claude a proposé un outil ou un format non autorisé. Aucun code n’est exécuté.",
        );
      return JSON.stringify(tools[0].input);
    }
    const text = response.content
      .filter(
        (block) => block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text)
      throw new Error("Claude a répondu sans texte ni plan utilisable.");
    return text;
  }
  const response = data as {
    choices?: {
      finish_reason?: unknown;
      message?: { content?: unknown; refusal?: unknown; tool_calls?: unknown };
    }[];
  } | null;
  const choice = response?.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new Error(
      "Le modèle a atteint la limite de réponse. Réduisez ou fractionnez votre demande.",
    );
  if (choice?.finish_reason === "content_filter" || choice?.message?.refusal)
    throw new Error(
      "Le fournisseur a refusé cette demande. Aucune modification n’a été appliquée.",
    );
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new Error(
      "Le modèle a répondu sans texte utilisable. Vérifiez ses capacités de chat.",
    );
  return content.trim();
}
