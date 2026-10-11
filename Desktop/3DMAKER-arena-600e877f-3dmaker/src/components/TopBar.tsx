import { useEffect, useRef, useState } from "react";
import {
  Box,
  ChevronDown,
  Undo2,
  Redo2,
  Upload,
  Download,
  Save,
  Sparkles,
  Camera,
  Keyboard,
  Settings2,
  Minus,
  X,
  Square,
  FolderOpen,
  Plus,
  MousePointer2,
  Cuboid,
  Palette,
  Search,
  PanelLeftClose,
} from "lucide-react";
import { useWorkspace } from "../store/workspace";
import { useEditor } from "../store/editor";
import { handleImport, saveProject } from "../engine/io";
import { Button, IconButton } from "./common";
interface Item {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  action: () => void;
  separator?: boolean;
}
export function TopBar() {
  const expert = useWorkspace((s) => s.expert);
  const focused = useWorkspace((s) => s.focused);
  const doc = useEditor((s) => s.document);
  const saved = useEditor((s) => s.savedDocument);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const mode = useEditor((s) => s.mode);
  const selection = useEditor((s) => s.selection);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(doc.name);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => setName(doc.name), [doc.name]);
  const s = useEditor.getState();
  const ai = (tab: "image" | "chat" | "history") =>
    useEditor.setState({ panel: "ai", aiTab: tab });
  const fullscreen = async () => {
    try {
      if (window.desktop) await window.desktop.setFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      s.notify(
        "Le navigateur n’autorise pas le plein écran dans ce contexte.",
        "info",
      );
    }
  };
  const menus: Record<string, Item[]> = {
    Fichier: [
      {
        label: "Nouvelle scène",
        shortcut: "Ctrl N",
        action: () => {
          if (
            doc === saved ||
            confirm(
              "Créer une nouvelle scène ? Les modifications non enregistrées restent accessibles avec Annuler.",
            )
          )
            s.newDocument();
        },
      },
      {
        label: "Ouvrir un projet…",
        shortcut: "Ctrl O",
        action: () => void handleImport(),
      },
      {
        label: "Enregistrer le projet",
        shortcut: "Ctrl S",
        action: () => void saveProject(),
      },
      {
        label: "Importer un modèle…",
        shortcut: "Ctrl I",
        action: () => void handleImport(),
        separator: true,
      },
      {
        label: "Exporter un modèle…",
        shortcut: "Ctrl E",
        action: () => s.openDialog("export"),
      },
      { label: "Capture du viewport…", action: () => s.openDialog("render") },
    ],
    Édition: [
      {
        label: "Annuler",
        shortcut: "Ctrl Z",
        disabled: !past.length,
        action: s.undo,
      },
      {
        label: "Rétablir",
        shortcut: "Ctrl Maj Z",
        disabled: !future.length,
        action: s.redo,
      },
      {
        label: "Tout sélectionner",
        shortcut: "Ctrl A",
        action: s.selectAll,
        separator: true,
      },
      {
        label: "Dupliquer la sélection",
        shortcut: "Maj D",
        disabled: !selection.length,
        action: s.duplicateSelected,
      },
      {
        label: "Fusionner les maillages",
        shortcut: "Ctrl J",
        disabled: selection.length < 2,
        action: s.mergeSelected,
      },
      {
        label: "Supprimer la sélection",
        shortcut: "Suppr",
        disabled: !selection.length,
        action: s.deleteSelected,
      },
    ],
    Affichage: [
      {
        label: "Changer le fond…",
        action: () => useEditor.setState({ panel: "background" }),
      },
      {
        label: "Outils et commandes…",
        shortcut: "Ctrl K",
        action: () => s.openDialog("commands"),
      },
      {
        label: "Mode concentration",
        checked: focused,
        shortcut: "F10",
        action: () => useWorkspace.getState().toggleFocus(),
      },
      {
        label: "Grille infinie",
        shortcut: "G",
        checked: doc.render.grid,
        action: () => s.setRender({ grid: !doc.render.grid }),
      },
      {
        label: "Axes X / Y / Z",
        checked: doc.render.axes,
        action: () => s.setRender({ axes: !doc.render.axes }),
      },
      {
        label: "Vue filaire",
        shortcut: "Z",
        checked: doc.render.wireframe,
        action: () => s.setRender({ wireframe: !doc.render.wireframe }),
      },
      {
        label: "Cadrer la sélection",
        shortcut: "F",
        action: () => s.focus("focus"),
        separator: true,
      },
      {
        label: "Cadrer toute la scène",
        shortcut: "Origine",
        action: () => s.focus("all"),
      },
      {
        label: "Plein écran",
        shortcut: "F11",
        action: () => void fullscreen(),
      },
      {
        label: "Raccourcis clavier",
        shortcut: "?",
        action: () => s.openDialog("help"),
        separator: true,
      },
    ],
    IA: [
      { label: "Photo → modèle 3D", action: () => ai("image") },
      { label: "Assistant de scène", action: () => ai("chat") },
      { label: "Historique des générations", action: () => ai("history") },
      {
        label: "Configurer les API…",
        action: () => s.openDialog("settings", "chat"),
        separator: true,
      },
    ],
  };
  const rename = () => {
    if (name.trim() && name.trim() !== doc.name)
      s.apply("Renommer le projet", (d) => ({
        ...d,
        name: name.trim().slice(0, 120),
      }));
    setRenaming(false);
  };
  return (
    <>
      <header className="topbar" ref={root}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            s.focus("all");
          }}
          title="Cadrer toute la scène"
        >
          <span className="brand-mark">
            <Box size={22} strokeWidth={1.8} />
          </span>
          <span>
            3D<span className="brand-light">MAKER</span>
          </span>
          <span className="version-badge">STUDIO</span>
        </a>
        <nav className="main-menu" aria-label="Menu principal">
          {Object.entries(menus).map(([title, items]) => (
            <div className="menu-anchor" key={title}>
              <button
                type="button"
                className={`menu-trigger ${menu === title ? "open" : ""}`}
                onClick={() => setMenu(menu === title ? null : title)}
              >
                {title}
                <ChevronDown size={11} />
              </button>
              {menu === title && (
                <div className="dropdown menu-dropdown">
                  {items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className={`dropdown-item ${item.separator ? "with-separator" : ""}`}
                      disabled={item.disabled}
                      onClick={() => {
                        setMenu(null);
                        item.action();
                      }}
                    >
                      <span>
                        {item.checked !== undefined && (
                          <span
                            className={`menu-check ${item.checked ? "checked" : ""}`}
                          >
                            {item.checked ? "✓" : ""}
                          </span>
                        )}
                        {item.label}
                      </span>
                      {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="project-title">
          {renaming ? (
            <input
              aria-label="Nom du projet"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename();
                if (e.key === "Escape") {
                  setName(doc.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              title="Renommer le projet"
              onClick={() => setRenaming(true)}
            >
              <span
                className={`project-dot ${doc !== saved ? "unsaved" : ""}`}
              />
              {doc.name}
              <span className="project-extension">.3dmaker</span>
              <ChevronDown size={12} />
            </button>
          )}
        </div>
        <div className="topbar-actions">
          <div className="history-buttons">
            <IconButton
              icon={Undo2}
              label={`Annuler${past.length ? ` : ${past.at(-1)!.label}` : ""} (Ctrl Z)`}
              disabled={!past.length}
              onClick={s.undo}
            />
            <IconButton
              icon={Redo2}
              label={`Rétablir${future.length ? ` : ${future.at(-1)!.label}` : ""} (Ctrl Maj Z)`}
              disabled={!future.length}
              onClick={s.redo}
            />
          </div>
          <Button
            className="create-button"
            variant="primary"
            icon={Plus}
            onClick={() => s.openDialog("create")}
          >
            Ajouter
          </Button>
          <Button
            icon={Palette}
            onClick={() => useEditor.setState({ panel: "background" })}
          >
            Fond
          </Button>
          <Button
            className="assistant-top-button"
            icon={Sparkles}
            onClick={() => ai("chat")}
          >
            Assistant
          </Button>
          <IconButton
            icon={Search}
            label="Outils et commandes (Ctrl K)"
            onClick={() => s.openDialog("commands")}
          />
          <IconButton
            icon={Save}
            label="Enregistrer le projet (Ctrl S)"
            onClick={() => void saveProject()}
          />
          <Button icon={Upload} onClick={() => s.openDialog("export")}>
            Exporter
          </Button>
          <button
            className={`workspace-mode-toggle ${expert ? "active" : ""}`}
            title="Le mode expert affiche tous les outils. Le mode simple garde l’essentiel."
            aria-pressed={expert}
            onClick={() => useWorkspace.getState().setExpert(!expert)}
          >
            {expert ? "Expert" : "Simple"}
            <ChevronDown size={11} />
          </button>
          <IconButton
            icon={PanelLeftClose}
            label={
              focused
                ? "Quitter le mode concentration (F10)"
                : "Mode concentration (F10)"
            }
            active={focused}
            onClick={() => useWorkspace.getState().toggleFocus()}
          />
          {window.desktop && (
            <div className="window-controls">
              <IconButton
                icon={Minus}
                label="Réduire la fenêtre"
                onClick={() => window.desktop!.windowAction("minimize")}
              />
              <IconButton
                icon={Square}
                label="Agrandir la fenêtre"
                onClick={() => window.desktop!.windowAction("maximize")}
              />
              <IconButton
                icon={X}
                label="Fermer"
                onClick={() => window.desktop!.windowAction("close")}
              />
            </div>
          )}
        </div>
      </header>
    </>
  );
}
