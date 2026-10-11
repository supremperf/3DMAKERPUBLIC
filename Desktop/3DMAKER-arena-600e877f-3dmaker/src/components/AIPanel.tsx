import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ImagePlus,
  Upload,
  ArrowUpRight,
  Settings2,
  Box,
  X,
  RefreshCw,
  Check,
  TriangleAlert,
  LoaderCircle,
  Send,
  MessageSquare,
  History,
  ShieldCheck,
  Trash2,
  Undo2,
  ArrowDownToLine,
  Image,
  Camera,
  ArrowRight,
  Square,
  WandSparkles,
} from "lucide-react";
import { ASSETS } from "../engine/library";
import { addLibraryAsset } from "./CreationDialog";
import { isChatConfigured, chatProviderLabel } from "../services/chatProviders";
import { useAI } from "../store/ai";
import { useEditor } from "../store/editor";
import { imageProviderNames } from "../services/imageAI";
import { Button, EmptyState, IconButton } from "./common";
export function AIPanel() {
  const tab = useEditor((s) => s.aiTab);
  const count = useAI((s) => s.generations.length);
  return (
    <div className="ai-panel">
      <div className="ai-subtabs">
        <button
          className={tab === "image" ? "active" : ""}
          onClick={() => useEditor.setState({ aiTab: "image" })}
        >
          <Image size={13} />
          Photo → 3D
        </button>
        <button
          className={tab === "chat" ? "active" : ""}
          onClick={() => useEditor.setState({ aiTab: "chat" })}
        >
          <MessageSquare size={13} />
          Assistant
        </button>
        <button
          aria-label={`Historique, ${count} générations`}
          title="Historique des générations"
          className={tab === "history" ? "active history-tab" : "history-tab"}
          onClick={() => useEditor.setState({ aiTab: "history" })}
        >
          <History size={15} />
          {count > 0 && <span>{count}</span>}
        </button>
      </div>
      {tab === "image" ? (
        <ImagePanel />
      ) : tab === "chat" ? (
        <ChatPanel />
      ) : (
        <GenerationGallery />
      )}
    </div>
  );
}
function ImagePanel() {
  const ai = useAI();
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const running = ai.progress.status === "running";
  const s = useEditor.getState();
  const configured =
    (!!ai.settings.image.apiKey && !!ai.settings.image.endpoint) ||
    ["generic", "luma"].includes(ai.settings.image.provider);
  const quality = async (value: string) => {
    try {
      await ai.saveSettings({
        ...ai.settings,
        image: {
          ...ai.settings.image,
          quality: value as typeof ai.settings.image.quality,
        },
      });
    } catch (e) {
      s.notify((e as Error).message, "error");
    }
  };
  return (
    <div className="image-ai-content">
      <div className="ai-eyebrow">
        <span className="ai-sparkle-box">
          <Sparkles size={13} />
        </span>
        LA CRÉATION, AUGMENTÉE
      </div>
      <h2>
        Une image.
        <br />
        <span>Une nouvelle dimension.</span>
      </h2>
      <p className="ai-intro">
        Transformez une simple photo en un modèle 3D prêt à explorer, modifier
        et exporter.
      </p>
      <div
        className={`photo-dropzone ${dragging ? "dragging" : ""} ${ai.image ? "has-image" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!running) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !running) void ai.setImage(file);
        }}
      >
        {ai.image ? (
          <>
            <img src={ai.image} alt="Photo à reconstruire en 3D" />
            <span className="image-name">
              <Camera size={12} />
              {ai.imageName}
            </span>
            <IconButton
              icon={X}
              label="Retirer la photo"
              disabled={running}
              className="remove-photo"
              onClick={ai.clearImage}
            />
          </>
        ) : (
          <button
            className="upload-photo"
            disabled={running}
            onClick={() => input.current?.click()}
          >
            <span className="photo-upload-art">
              <ImagePlus size={34} strokeWidth={1.1} />
              <span className="upload-plus">
                <PlusSymbol />
              </span>
            </span>
            <strong>Déposez votre photo ici</strong>
            <span>
              ou <em>parcourir les fichiers</em>
            </span>
            <small>PNG, JPG · jusqu’à 20 Mo</small>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Importer une photo pour l’IA"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void ai.setImage(file);
            e.target.value = "";
          }}
        />
      </div>
      {ai.image && !running && (
        <button
          className="text-button change-photo"
          onClick={() => input.current?.click()}
        >
          <Upload size={12} />
          Changer de photo
        </button>
      )}
      <div className="ai-provider-row">
        <div>
          <span className={`api-indicator ${configured ? "ready" : ""}`} />
          <span>{imageProviderNames[ai.settings.image.provider]}</span>
        </div>
        <button
          className="text-button"
          onClick={() => s.openDialog("settings", "image")}
        >
          <Settings2 size={12} />
          Configurer
        </button>
      </div>
      <label className="ai-quality-row">
        <span>Qualité du maillage</span>
        <select
          value={ai.settings.image.quality}
          disabled={running}
          onChange={(e) => void quality(e.target.value)}
        >
          <option value="low">Rapide</option>
          <option value="medium">Équilibrée</option>
          <option value="high">Haute fidélité</option>
        </select>
      </label>
      <Button
        variant="primary"
        icon={running ? LoaderCircle : WandSparkles}
        className={`generate-button ${running ? "is-loading" : ""}`}
        disabled={!ai.image || running || !ai.loaded || !configured}
        onClick={() => void ai.generate()}
      >
        {running
          ? "Génération en cours…"
          : ai.progress.status === "error"
            ? "Réessayer la génération"
            : "Générer le modèle 3D"}
        {!running && <ArrowRight size={15} />}
      </Button>
      {running && (
        <div className="generation-progress">
          <div className="progress-caption">
            <span>{ai.progress.message}</span>
            <strong>{Math.round(ai.progress.percent)} %</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${ai.progress.percent}%` }} />
          </div>
          <button
            className="text-button"
            title="Arrête le suivi local. Une tâche déjà reçue peut continuer et être facturée par le fournisseur."
            onClick={ai.cancelGeneration}
          >
            <X size={11} />
            Annuler le suivi
          </button>
          {ai.progress.taskId && <small>Tâche : {ai.progress.taskId}</small>}
        </div>
      )}
      {ai.progress.status === "error" && (
        <div className="error-card" role="alert">
          <TriangleAlert size={17} />
          <div>
            <strong>Le modèle n’a pas pu être généré</strong>
            <p>{ai.progress.error}</p>
            <button
              className="text-button"
              onClick={() => s.openDialog("settings", "image")}
            >
              Vérifier les paramètres
              <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      )}
      {ai.progress.status === "success" && (
        <div className="success-card">
          <Check size={16} />
          <span>{ai.progress.message}</span>
          <button
            title="Afficher les propriétés du modèle"
            onClick={() => useEditor.setState({ panel: "properties" })}
          >
            <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      {ai.progress.status === "idle" && ai.progress.message && (
        <p className="ai-disclaimer">{ai.progress.message}</p>
      )}
      {!configured && (
        <button
          className="configure-nudge"
          onClick={() => s.openDialog("settings")}
        >
          <Settings2 size={15} />
          <span>Connectez votre API pour commencer</span>
          <ArrowUpRight size={13} />
        </button>
      )}
      <div className="ai-howto">
        <h3>DE LA PHOTO À VOTRE SCÈNE</h3>
        <div>
          <span>01</span>
          <p>
            <strong>Importez une photo</strong>Un objet bien éclairé, sur un
            fond simple.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>L’IA reconstruit les volumes</strong>Un vrai maillage, pas
            une image en relief.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Faites-en votre création</strong>Transformez, texturez,
            sculptez, exportez.
          </p>
        </div>
      </div>
      {ai.generations.length > 0 && (
        <div className="recent-generations">
          <div>
            <h3>VOS DERNIÈRES CRÉATIONS</h3>
            <button
              className="text-button"
              onClick={() => useEditor.setState({ aiTab: "history" })}
            >
              Tout voir
              <ArrowUpRight size={11} />
            </button>
          </div>
          <div className="recent-grid">
            {ai.generations.slice(0, 3).map((record) => (
              <button
                key={record.id}
                title={`Charger ${record.name}`}
                onClick={() => void ai.loadGeneration(record)}
              >
                <img src={record.image} alt={record.name} />
                <Box size={12} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="ai-privacy">
        <ShieldCheck size={14} />
        <p>
          Clés conservées localement.
          <br />
          Les crédits de votre fournisseur s’appliquent.
        </p>
      </div>
    </div>
  );
}
function PlusSymbol() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function ChatPanel() {
  const ai = useAI();
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const past = useEditor((s) => s.past);
  const document = useEditor((s) => s.document);
  const configured = isChatConfigured(ai.settings.chat);
  const stale = !!ai.proposal && ai.proposal.before !== document;
  const configure = () => useEditor.getState().openDialog("settings", "chat");
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [ai.messages, ai.chatPending, ai.chatError]);
  const send = () => {
    if (input.trim() && !ai.chatPending) {
      const message = input.trim();
      setInput("");
      void ai.sendMessage(message);
    }
  };
  return (
    <div className="chat-panel">
      <div className="chat-heading">
        <span>
          <Sparkles size={16} />
          <strong>Votre assistant de création</strong>
        </span>
        <IconButton
          icon={Settings2}
          label="Configurer le modèle de chat"
          onClick={configure}
        />
        <IconButton
          icon={Trash2}
          label="Effacer la conversation"
          disabled={!ai.messages.length || ai.chatPending}
          onClick={ai.clearChat}
        />
      </div>
      {!configured && (
        <div className="assistant-connect-card">
          <Sparkles size={19} />
          <div>
            <strong>Une IA, votre choix.</strong>
            <p>
              Service cloud préconfiguré ou modèle local. Ajoutez votre clé
              personnelle pour le cloud ; aucune clé n’est livrée dans le code.
            </p>
          </div>
          <Button variant="primary" onClick={configure}>
            Connecter l’IA
          </Button>
          <button
            className="text-button"
            disabled={ai.connection === "checking"}
            onClick={() => void ai.connectLocal()}
          >
            {ai.connection === "checking"
              ? "Recherche du modèle local…"
              : "Détecter Ollama"}
          </button>
        </div>
      )}
      {configured && (
        <button className="assistant-connection-strip" onClick={configure}>
          <span
            className={
              ai.connection === "ready" ? "ready-dot" : "connection-dot"
            }
          />
          {chatProviderLabel(ai.settings.chat)} · {ai.settings.chat.model}
          <Settings2 size={12} />
        </button>
      )}
      <div className="chat-messages">
        {!ai.messages.length && (
          <div className="chat-welcome">
            <span className="chat-welcome-icon">
              <Sparkles size={30} strokeWidth={1.1} />
            </span>
            <h3>
              {configured
                ? "Votre idée, en quelques mots."
                : "Créez dès maintenant."}
            </h3>
            <p>
              {configured
                ? "Décrivez votre idée. L’assistant prépare un plan validé pour votre scène."
                : "Ces créations locales sont prêtes à ajouter, même sans IA connectée."}
            </p>
            {!configured && (
              <div className="local-creations">
                {ASSETS.slice(0, 6).map((a) => (
                  <button
                    key={a.id}
                    title={a.description}
                    onClick={() => addLibraryAsset(a.id)}
                  >
                    <Box size={15} />
                    {a.name}
                    <PlusSymbol />
                  </button>
                ))}
              </div>
            )}
            {configured && (
              <div className="chat-suggestions">
                {[
                  "Rends ce cube en acier rouge",
                  "Crée un château médiéval détaillé",
                  "Ajoute trois lumières orange sous cet objet",
                ].map((text) => (
                  <button key={text} onClick={() => setInput(text)}>
                    {text}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
            )}
            {configured && (
              <span className="chat-model">
                Les plans sont validés. Vous gardez le contrôle.
              </span>
            )}
            {!configured && (
              <p className="local-creations-note">
                Bibliothèque procédurale, pas une IA simulée.
              </p>
            )}
          </div>
        )}
        {ai.messages.map((message, index) => (
          <div className={`chat-message ${message.role}`} key={message.id}>
            <div className="message-author">
              {message.role === "assistant" ? (
                <>
                  <Sparkles size={12} />
                  3DMAKER
                </>
              ) : (
                "Vous"
              )}
            </div>
            <p>{message.content}</p>
            {message.actionCount !== undefined && message.actionCount > 0 && (
              <div className="message-actions">
                <span>
                  <Check size={12} />
                  {message.actionCount} action
                  {message.actionCount > 1 ? "s" : ""} exécutée
                  {message.actionCount > 1 ? "s" : ""}
                </span>
                {index === ai.messages.length - 1 &&
                  past.at(-1)?.label === "Assistant IA" && (
                    <button
                      onClick={() => useEditor.getState().undo()}
                      title="Annuler la transaction IA"
                    >
                      <Undo2 size={12} />
                      Annuler
                    </button>
                  )}
              </div>
            )}
          </div>
        ))}
        {ai.proposal && (
          <div className="assistant-plan-card">
            <span className="plan-eyebrow">
              PLAN PRÊT · {ai.proposal.plan.actions.length} ACTION
              {ai.proposal.plan.actions.length > 1 ? "S" : ""}
            </span>
            <h3>{stale ? "La scène a changé" : "Vous décidez de la suite."}</h3>
            {stale ? (
              <p>
                Cette proposition est périmée. Redemandez un plan pour conserver
                vos modifications.
              </p>
            ) : (
              <>
                <ul>
                  {ai.proposal.plan.actions.slice(0, 5).map((a, i) => (
                    <li key={i}>
                      <Check size={12} />
                      {describeAction(a)}
                    </li>
                  ))}
                </ul>
                {ai.proposal.plan.actions.length > 5 && (
                  <details>
                    <summary>
                      Voir les {ai.proposal.plan.actions.length - 5} autres
                      actions
                    </summary>
                    <ul>
                      {ai.proposal.plan.actions.slice(5).map((a, i) => (
                        <li key={i}>{describeAction(a)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
            <div>
              <Button
                variant="primary"
                icon={Check}
                disabled={stale}
                onClick={ai.applyProposal}
              >
                Appliquer le plan
              </Button>
              <Button onClick={ai.dismissProposal}>Ignorer</Button>
            </div>
            <small>Aucune modification avant votre confirmation.</small>
          </div>
        )}
        {ai.chatPending && (
          <div className="assistant-thinking">
            <LoaderCircle size={14} className="spin" />
            <span>L’assistant prépare les actions…</span>
            <IconButton
              icon={Square}
              label="Annuler la demande de l’assistant"
              onClick={ai.cancelChat}
            />
          </div>
        )}
        {ai.chatError && (
          <div className="error-card" role="alert">
            <TriangleAlert size={16} />
            <div>
              <strong>Aucune action appliquée</strong>
              <p>{ai.chatError}</p>
              <button
                className="text-button"
                onClick={() => void ai.sendMessage(ai.lastPrompt)}
              >
                <RefreshCw size={12} />
                Réessayer
              </button>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="chat-composer">
        <textarea
          aria-label="Votre demande à l’assistant"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          maxLength={8000}
          disabled={!configured || !ai.loaded}
          placeholder={
            configured
              ? "Décrivez ce que vous imaginez…"
              : "Connectez l’IA pour discuter librement…"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div>
          <span>Entrée pour envoyer · Maj ↵ pour une ligne</span>
          <IconButton
            icon={Send}
            label="Envoyer la demande"
            className="send-message"
            disabled={ai.chatPending || !input.trim() || !configured}
            onClick={send}
          />
        </div>
      </div>
      <div className="chat-safety">
        <ShieldCheck size={12} />
        {ai.settings.chat.vision
          ? "Une capture de la scène accompagne votre demande."
          : "Actions validées. Toujours annulables."}
      </div>
    </div>
  );
}
function GenerationGallery() {
  const ai = useAI();
  return (
    <div className="gallery-panel">
      <div className="gallery-heading">
        <h3>Vos créations 3D</h3>
        <span>
          {ai.generations.length} génération
          {ai.generations.length > 1 ? "s" : ""}
        </span>
      </div>
      {!ai.generations.length ? (
        <>
          <EmptyState icon={History} title="Chaque création a sa place">
            Vos modèles générés apparaîtront ici. Retrouvez-les et rechargez-les
            dans n’importe quelle scène, en un clic.
          </EmptyState>
          <Button
            icon={ImagePlus}
            onClick={() => useEditor.setState({ aiTab: "image" })}
          >
            Créer depuis une photo
          </Button>
        </>
      ) : (
        <div className="generation-grid">
          {ai.generations.map((record) => (
            <article className="generation-card" key={record.id}>
              <button
                className="generation-thumbnail"
                onClick={() => void ai.loadGeneration(record)}
                title={`Recharger ${record.name}`}
              >
                <img
                  src={record.image}
                  alt={`Photo source de ${record.name}`}
                />
                <span>
                  <Box size={15} />
                  Charger en 3D
                </span>
              </button>
              <div>
                <strong>{record.name}</strong>
                <small>
                  {new Date(record.date).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  ·{" "}
                  {imageProviderNames[
                    record.provider as keyof typeof imageProviderNames
                  ] || record.provider}
                </small>
                <IconButton
                  icon={Trash2}
                  label={`Supprimer la génération ${record.name}`}
                  onClick={() => {
                    if (
                      confirm(
                        "Supprimer cette génération de l’historique local ? Les objets de la scène seront conservés.",
                      )
                    )
                      void ai.deleteGeneration(record.id);
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="gallery-note">
        Modèles et photos stockés sur cet appareil.
      </p>
    </div>
  );
}

function describeAction(action: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    create_asset: "Ajouter une création",
    create_primitive: "Ajouter une forme",
    create_light: "Ajouter une lumière",
    create_camera: "Ajouter une caméra",
    set_material: "Modifier l’apparence",
    transform: "Transformer",
    rename: "Renommer",
    visibility: "Changer la visibilité",
    delete: "Supprimer",
    duplicate: "Dupliquer",
    array: "Créer une répétition",
    boolean: "Calculer une booléenne",
    merge: "Fusionner",
    mesh_operation: "Modifier le maillage",
    render: "Régler le fond et le rendu",
    layout: "Disposer les objets",
    set_light: "Régler l’éclairage",
    set_camera: "Régler la caméra",
  };
  const subject =
    typeof action.name === "string"
      ? action.name
      : typeof action.asset === "string"
        ? ASSETS.find((a) => a.id === action.asset)?.name
        : typeof action.target === "string" && action.target !== "selection"
          ? action.target
          : undefined;
  return `${labels[String(action.type)] || String(action.type)}${subject ? ` · ${subject}` : ""}`;
}
