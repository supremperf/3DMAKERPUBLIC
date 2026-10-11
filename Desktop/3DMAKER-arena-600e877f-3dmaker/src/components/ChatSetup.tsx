import { useState } from "react";
import {
  Check,
  Cpu,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { AISettings } from "../shared";
import {
  CHAT_PRESETS,
  findChatPreset,
  listChatModelDetails,
  recommendChatModel,
  getChatModelInfo,
  chatProtocol,
  isChatConfigured,
  isOfficialOpenAI,
  requiresChatKey,
  testChatInference,
  updateChatEndpoint,
} from "../services/chatProviders";
import { useAI } from "../store/ai";
import { Button, Section, Toggle } from "./common";
interface Props {
  draft: AISettings;
  onChange(value: AISettings): void;
  busy: boolean;
  setBusy(value: boolean): void;
  showKeys: boolean;
}
export function ChatSetup({ draft, onChange, busy, setBusy, showKeys }: Props) {
  const [models, setModels] = useState<string[]>([]),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const [custom, setCustom] = useState(false);
  const preset = custom ? undefined : findChatPreset(draft.chat);
  const native = chatProtocol(draft.chat) === "anthropic";
  const modelInfo = getChatModelInfo(draft.chat);
  const patch = (change: Partial<AISettings["chat"]>) => {
    setResult("");
    onChange({ ...draft, chat: { ...draft.chat, ...change } });
  };
  const selectPreset = (id: string) => {
    if (id === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    const selected = CHAT_PRESETS.find((p) => p.id === id);
    if (!selected) return;
    let sameOrigin = false;
    try {
      sameOrigin =
        new URL(selected.endpoint).origin ===
        new URL(draft.chat.endpoint).origin;
    } catch {
      /* Un brouillon d’URL incomplet ne bloque pas le choix d’un préréglage. */
    }
    patch({
      protocol: selected.protocol,
      endpoint: selected.endpoint,
      model: selected.model,
      apiKey: sameOrigin ? draft.chat.apiKey : "",
      vision: selected.vision,
      jsonMode: selected.jsonMode,
    });
    setModels([]);
    setError("");
  };
  const discover = async () => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      await useAI.getState().saveSettings(draft);
      const available = await listChatModelDetails(draft);
      setModels(available.map((model) => model.id));
      const recommended = recommendChatModel(available, draft.chat);
      const model = available.some((m) => m.id === draft.chat.model)
        ? draft.chat.model
        : recommended || draft.chat.model;
      const info = available.find((m) => m.id === model);
      const next = {
        ...draft,
        chat: {
          ...draft.chat,
          model,
          vision: info?.vision === false ? false : draft.chat.vision,
          jsonMode: info?.jsonSchema === false ? false : draft.chat.jsonMode,
        },
      };
      onChange(next);
      await useAI.getState().saveSettings(next);
      const adjustments = [
        draft.chat.vision && !next.chat.vision
          ? "Vue de scène désactivée : ce modèle ne prend pas en charge les images."
          : "",
        draft.chat.jsonMode && !next.chat.jsonMode
          ? "Mode JSON structuré désactivé : le plan devra être retourné en texte JSON."
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      setResult(
        `${available.length} modèle${available.length > 1 ? "s" : ""} disponible${available.length > 1 ? "s" : ""}. ${adjustments} Testez l’IA pour vérifier une vraie réponse.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setError("");
    setResult("");
    useAI.setState({ connection: "checking" });
    try {
      await useAI.getState().saveSettings(draft);
      useAI.setState({ connection: "checking" });
      await testChatInference(draft);
      useAI.setState({ connection: "ready" });
      setResult(
        "IA connectée : une vraie réponse au format de commandes a été reçue. Votre scène n’a pas été modifiée.",
      );
    } catch (e) {
      useAI.setState({ connection: "error" });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-fields chat-setup">
      <label className="stacked-field">
        <span>Choisir votre IA</span>
        <select
          aria-label="Service IA préconfiguré"
          value={preset?.id || "custom"}
          disabled={busy}
          onChange={(e) => selectPreset(e.target.value)}
        >
          {CHAT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="custom">Serveur personnalisé</option>
        </select>
        <small>
          {preset?.description ||
            "Configurez une API compatible OpenAI ou Anthropic dans les réglages ci-dessous."}
        </small>
      </label>
      {preset?.id === "ollama" && (
        <div className="local-ai-instructions">
          <Cpu size={17} />
          <div>
            <strong>Modèle local, sans abonnement</strong>
            <p>Installez Ollama sur la machine qui exécute 3DMAKER, puis :</p>
            <code>ollama pull qwen3:8b</code>
            <code>ollama serve</code>
            <p>
              Choisissez un modèle adapté à votre RAM/VRAM. Aucun modèle de
              langage n’est téléchargé ou embarqué silencieusement.
            </p>
          </div>
        </div>
      )}
      {(!preset || preset.requiresKey) && (
        <label className="stacked-field">
          <span>Votre clé personnelle</span>
          <input
            type={showKeys ? "text" : "password"}
            aria-label="Clé API de chat"
            autoComplete="off"
            value={draft.chat.apiKey}
            disabled={busy}
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder="Conservée uniquement sur cet appareil"
          />
          <small>
            Ne partagez pas votre clé dans une conversation ou sur GitHub.
          </small>
        </label>
      )}
      <div className="chat-model-select">
        <label className="stacked-field">
          <span>Modèle</span>
          <input
            aria-label="Nom du modèle de chat"
            list="chat-models"
            value={draft.chat.model}
            disabled={busy}
            onChange={(e) => {
              const model = e.target.value,
                info = getChatModelInfo(draft.chat, model);
              patch({
                model,
                ...(info?.vision === false ? { vision: false } : {}),
                ...(info?.jsonSchema === false ? { jsonMode: false } : {}),
              });
            }}
          />
          <datalist id="chat-models">
            {models.map((m) => (
              <option value={m} key={m} />
            ))}
          </datalist>
        </label>
        <Button
          icon={busy ? LoaderCircle : RefreshCw}
          disabled={
            busy ||
            (native && requiresChatKey(draft.chat) && !draft.chat.apiKey.trim())
          }
          onClick={() => void discover()}
        >
          Détecter
        </Button>
      </div>
      <Toggle
        label="Valider les plans avant application"
        value={draft.chat.review}
        onChange={(review) => patch({ review })}
        disabled={busy}
      />
      <Toggle
        label="Joindre une vue de la scène au modèle"
        value={draft.chat.vision}
        onChange={(vision) => patch({ vision })}
        disabled={busy || modelInfo?.vision === false}
      />
      {modelInfo?.vision === false && (
        <p className="simple-hint">
          Ce modèle indique ne pas accepter d’images ; aucune vue de scène n’est
          transmise.
        </p>
      )}
      {draft.chat.vision && (
        <p className="simple-hint">
          Une capture 896 × 672 est transmise au fournisseur à chaque demande.
          Activez cette option uniquement avec un modèle qui accepte les images.
        </p>
      )}
      <Section title="Réglages du serveur" defaultOpen={!preset}>
        <label className="stacked-field">
          <span>Format de l’API</span>
          <select
            aria-label="Format de l’API de chat"
            value={chatProtocol(draft.chat)}
            disabled={busy}
            onChange={(e) =>
              patch({
                protocol: e.target.value as AISettings["chat"]["protocol"],
              })
            }
          >
            <option value="openai">OpenAI-compatible (Venice, Ollama…)</option>
            <option value="anthropic">Anthropic / Claude natif</option>
          </select>
        </label>
        <label className="stacked-field">
          <span>URL de base de l’API</span>
          <input
            aria-label="URL du serveur de chat"
            value={draft.chat.endpoint}
            disabled={busy}
            spellCheck={false}
            onChange={(e) =>
              patch(updateChatEndpoint(draft.chat, e.target.value))
            }
          />
          <small>
            Changer l’origine du serveur efface la clé précédente. Le serveur
            doit autoriser ce modèle. Une URL locale désigne la machine
            exécutant 3DMAKER, pas le navigateur visiteur.
          </small>
        </label>
        {preset && !preset.requiresKey && (
          <label className="stacked-field">
            <span>Clé de votre serveur, si nécessaire</span>
            <input
              aria-label="Clé API de chat"
              type={showKeys ? "text" : "password"}
              value={draft.chat.apiKey}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => patch({ apiKey: e.target.value })}
            />
          </label>
        )}
        <Toggle
          label={
            native ? "Plan JSON par outil Claude" : "Réponse JSON structurée"
          }
          value={draft.chat.jsonMode}
          disabled={busy || (!native && modelInfo?.jsonSchema === false)}
          onChange={(jsonMode) => patch({ jsonMode })}
        />
        {!native && modelInfo?.jsonSchema === false && (
          <p className="simple-hint">
            Ce modèle ne propose pas de sortie JSON structurée. Le logiciel
            vérifie toujours le plan JSON retourné en texte avant toute
            modification.
          </p>
        )}
        {isOfficialOpenAI(draft.chat.endpoint) && (
          <label className="stacked-field">
            <span>Raisonnement OpenAI</span>
            <select
              aria-label="Profondeur du raisonnement"
              value={draft.chat.reasoning}
              disabled={busy}
              onChange={(e) =>
                patch({
                  reasoning: e.target.value as AISettings["chat"]["reasoning"],
                })
              }
            >
              <option value="high">Approfondi</option>
              <option value="medium">Équilibré</option>
              <option value="low">Rapide</option>
            </select>
            <small>
              Pour les modèles OpenAI de raisonnement. Les autres serveurs
              utilisent leur propre moteur.
            </small>
          </label>
        )}
        {native && (
          <p className="simple-hint">
            Claude utilise l’API Messages native. Le mode JSON demande un outil
            de proposition, jamais du code exécuté. Les paramètres de
            raisonnement OpenAI ne sont pas envoyés à Claude.
          </p>
        )}
      </Section>
      <Button
        variant="primary"
        icon={busy ? LoaderCircle : Check}
        disabled={busy || !isChatConfigured(draft.chat)}
        onClick={() => void test()}
      >
        Tester l’IA
      </Button>
      <p className="simple-hint">
        Ce test envoie une petite requête réelle au modèle. Les crédits du
        fournisseur peuvent s’appliquer. Il ne modifie pas la scène.
      </p>
      {result && (
        <div className="success-card">
          <Check size={15} />
          <p>{result}</p>
        </div>
      )}
      {error && (
        <div className="error-card" role="alert">
          <TriangleAlert size={16} />
          <p>{error}</p>
        </div>
      )}
      <div className="information-card">
        <ShieldCheck size={18} />
        <p>
          Aucun code arbitraire n’est exécuté. Chaque plan est validé dans un
          worker et chaque changement est annulable.
        </p>
      </div>
    </div>
  );
}
