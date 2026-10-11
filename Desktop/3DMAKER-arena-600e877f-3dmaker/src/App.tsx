import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import {
  Check,
  CircleAlert,
  Info,
  X,
  LoaderCircle,
  Mouse,
  Box,
  Move,
  Grid2X2,
} from "lucide-react";
import { REVISION } from "three";
import { TopBar } from "./components/TopBar";
import { ScenePanel } from "./components/ScenePanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Viewport } from "./components/Viewport";
import { Dialogs } from "./components/Dialogs";
import { useEditor } from "./store/editor";
import { useAI } from "./store/ai";
import { useWorkspace } from "./store/workspace";
import { installShortcuts } from "./services/shortcuts";
import { loadAutosave, saveAutosave } from "./services/persistence";
import { validateDocument } from "./engine/io";
export default function App() {
  const expert = useWorkspace((s) => s.expert);
  const focused = useWorkspace((s) => s.focused);
  useEffect(() => {
    const removeShortcuts = installShortcuts();
    void useAI.getState().initialize();
    let active = true;
    let saving = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const before = useEditor.getState().document;
    void loadAutosave()
      .then((document) => {
        if (active && document && useEditor.getState().document === before) {
          useEditor.getState().loadDocument(validateDocument(document));
          useEditor
            .getState()
            .notify(
              "Votre dernière scène a été récupérée automatiquement.",
              "info",
            );
        }
      })
      .catch(() => {
        if (active)
          useEditor
            .getState()
            .notify(
              "La récupération automatique est indisponible. Enregistrez vos projets avec Ctrl S.",
              "error",
            );
      });
    const save = async () => {
      if (saving) {
        pending = true;
        return;
      }
      saving = true;
      try {
        await saveAutosave(useEditor.getState().document);
      } catch {
        if (active)
          useEditor
            .getState()
            .notify(
              "La sauvegarde automatique a échoué. Utilisez Ctrl S pour conserver votre projet.",
              "error",
            );
      } finally {
        saving = false;
        if (pending && active) {
          pending = false;
          void save();
        }
      }
    };
    window.desktop?.setDirty(
      useEditor.getState().document !== useEditor.getState().savedDocument,
    );
    const unsubscribe = useEditor.subscribe((s, previous) => {
      if (
        s.document !== previous.document ||
        s.savedDocument !== previous.savedDocument
      )
        window.desktop?.setDirty(s.document !== s.savedDocument);
      if (s.document !== previous.document) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void save(), 850);
      }
    });
    const hide = () => {
      if (document.visibilityState === "hidden") void save();
    };
    document.addEventListener("visibilitychange", hide);
    const rejected = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      useEditor
        .getState()
        .notify(
          event.reason instanceof Error
            ? event.reason.message
            : "Une opération a échoué. Vérifiez votre configuration.",
          "error",
        );
    };
    window.addEventListener("unhandledrejection", rejected);
    return () => {
      active = false;
      removeShortcuts();
      unsubscribe();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("unhandledrejection", rejected);
    };
  }, []);
  return (
    <div
      className={`studio-app ${expert ? "expert-mode" : "simple-mode"} ${focused ? "focus-mode" : ""}`}
    >
      <TopBar />
      <div className="studio-workspace">
        <ScenePanel />
        <Viewport />
        <PropertiesPanel />
      </div>
      <StatusBar />
      <Toasts />
      <Dialogs />
    </div>
  );
}
function StatusBar() {
  const busy = useEditor((s) => s.busy);
  const busyMessage = useEditor((s) => s.busyMessage);
  const stats = useEditor((s) => s.stats);
  const past = useEditor((s) => s.past.length);
  return (
    <footer className="statusbar">
      <div className="status-state">
        {busy ? (
          <LoaderCircle size={11} className="spin" />
        ) : (
          <span className="ready-dot" />
        )}
        <span>{busy ? busyMessage : "Prêt à créer"}</span>
        <span className="status-divider" />
        <span>{stats.objects} objets</span>
        <span className="status-geometry">
          {stats.vertices.toLocaleString("fr-FR")} sommets
        </span>
      </div>
      <div className="status-shortcuts">
        <span>
          <Mouse size={11} />
          Glisser : orbite
        </span>
        <span>
          <Move size={11} />
          Molette : zoom
        </span>
        <span>
          <kbd>Maj</kbd>Multi-sélection
        </span>
        <span>
          <kbd>F</kbd>Cadrer
        </span>
      </div>
      <div className="status-right">
        <span title={`${past} actions mémorisées sur 500`}>
          Historique {past}/500
        </span>
        <span className="status-divider" />
        <span>Y ↑ · mètres</span>
        <span className="engine-version">Three.js r{REVISION}</span>
      </div>
    </footer>
  );
}
function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon =
          toast.kind === "success"
            ? Check
            : toast.kind === "error"
              ? CircleAlert
              : Info;
        return (
          <div
            className={`toast ${toast.kind}`}
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <Icon size={17} />
            <span>{toast.message}</span>
            <button
              title="Fermer le message"
              aria-label="Fermer le message"
              onClick={() => useEditor.getState().dismissToast(toast.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("3DMAKER : erreur d’interface", error, info.componentStack);
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <Box size={48} />
        <h1>L’interface a rencontré une erreur</h1>
        <p>Votre dernière sauvegarde locale sera récupérée au redémarrage.</p>
        <pre>{this.state.error}</pre>
        <button
          className="button button-primary"
          onClick={() => location.reload()}
        >
          Relancer 3DMAKER
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
