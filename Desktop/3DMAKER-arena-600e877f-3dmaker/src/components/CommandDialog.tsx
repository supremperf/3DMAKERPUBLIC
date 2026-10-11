import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Modal } from "./Modal";
import { useEditor } from "../store/editor";
import { useWorkspace } from "../store/workspace";
import { ASSETS, layoutNodes } from "../engine/library";
import { addLibraryAsset } from "./CreationDialog";
import { handleImport, saveProject } from "../engine/io";
interface Command {
  label: string;
  category: string;
  hint?: string;
  disabled?: boolean;
  action(): void;
}
export function CommandDialog() {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selection = useEditor((s) => s.selection),
    nodes = useEditor((s) => s.document.nodes);
  const s = useEditor.getState();
  useEffect(() => {
    input.current?.focus();
  }, []);
  const mesh = nodes.some(
    (n) => selection.includes(n.id) && n.geometry && !n.locked,
  );
  const layout = (operation: "ground" | "center") =>
    s.apply(operation === "ground" ? "Poser au sol" : "Centrer", (d) => ({
      ...d,
      nodes: layoutNodes(d.nodes, selection, operation),
    }));
  const commands: Command[] = [
    {
      label: "Ajouter une création",
      category: "Créer",
      action: () => s.openDialog("create"),
    },
    ...ASSETS.map((a) => ({
      label: `Créer ${a.name}`,
      category: "Bibliothèque",
      action: () => addLibraryAsset(a.id),
    })),
    ...Object.entries({
      extrude: "Extrusion",
      bevel: "Chanfrein",
      subdivide: "Subdivision",
      decimate: "Décimation",
      mirror: "Miroir",
      array: "Répétition",
      lathe: "Révolution",
      spin: "Spin",
      sweep: "Suivre un chemin",
      align: "Alignement",
    }).map(([id, label]) => ({
      label,
      category: "Modélisation",
      disabled: id === "align" ? selection.length < 2 : !mesh,
      action: () => s.openDialog("advanced", id),
    })),
    ...(["union", "difference", "intersection"] as const).map((operation) => ({
      label: {
        union: "Union",
        difference: "Différence",
        intersection: "Intersection",
      }[operation],
      category: "Booléennes",
      disabled: selection.length !== 2,
      action: () => void s.booleanSelected(operation),
    })),
    {
      label: "Dupliquer",
      category: "Objet",
      hint: "Maj D",
      disabled: !selection.length,
      action: s.duplicateSelected,
    },
    {
      label: "Supprimer",
      category: "Objet",
      hint: "Suppr",
      disabled: !selection.length,
      action: s.deleteSelected,
    },
    {
      label: "Fusionner les maillages",
      category: "Objet",
      hint: "Ctrl J",
      disabled: selection.length < 2,
      action: s.mergeSelected,
    },
    {
      label: "Poser au sol",
      category: "Objet",
      disabled: !mesh,
      action: () => layout("ground"),
    },
    {
      label: "Centrer la sélection",
      category: "Objet",
      disabled: !mesh,
      action: () => layout("center"),
    },
    {
      label: "Masquer les autres maillages",
      category: "Objet",
      disabled: !selection.length,
      action: () =>
        s.apply("Isoler la sélection", (d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            n.geometry && !selection.includes(n.id)
              ? { ...n, visible: false }
              : n,
          ),
        })),
    },
    {
      label: "Afficher tous les objets",
      category: "Objet",
      action: () =>
        s.apply("Afficher tous les objets", (d) => ({
          ...d,
          nodes: d.nodes.map((n) => (n.visible ? n : { ...n, visible: true })),
        })),
    },
    {
      label: "Cadrer la sélection",
      category: "Vue",
      hint: "F",
      action: () => s.focus("focus"),
    },
    {
      label: "Cadrer toute la scène",
      category: "Vue",
      hint: "Début",
      action: () => s.focus("all"),
    },
    {
      label: "Changer le fond",
      category: "Vue",
      action: () => useEditor.setState({ panel: "background" }),
    },
    {
      label: "Mode concentration",
      category: "Vue",
      hint: "F10",
      action: () => useWorkspace.getState().toggleFocus(),
    },
    {
      label: "Mesurer une distance",
      category: "Vue",
      hint: "M",
      action: () => s.setTool("measure"),
    },
    {
      label: "Mode sommets",
      category: "Maillage",
      hint: "1",
      disabled: !mesh,
      action: () => s.setMode("vertex"),
    },
    {
      label: "Mode arêtes",
      category: "Maillage",
      hint: "2",
      disabled: !mesh,
      action: () => s.setMode("edge"),
    },
    {
      label: "Mode faces",
      category: "Maillage",
      hint: "3",
      disabled: !mesh,
      action: () => s.setMode("face"),
    },
    {
      label: "Mode objet",
      category: "Maillage",
      hint: "Tab",
      action: () => s.setMode("object"),
    },
    {
      label: "Enregistrer le projet",
      category: "Fichier",
      hint: "Ctrl S",
      action: () => void saveProject(),
    },
    {
      label: "Importer un modèle",
      category: "Fichier",
      hint: "Ctrl I",
      action: () => void handleImport(),
    },
    {
      label: "Exporter un modèle",
      category: "Fichier",
      hint: "Ctrl E",
      action: () => s.openDialog("export"),
    },
    {
      label: "Capturer une image",
      category: "Fichier",
      action: () => s.openDialog("render"),
    },
    {
      label: "Configurer l’IA",
      category: "Assistant",
      action: () => s.openDialog("settings", "chat"),
    },
    {
      label: "Discuter avec l’assistant",
      category: "Assistant",
      action: () => useEditor.setState({ panel: "ai", aiTab: "chat" }),
    },
    {
      label: "Créer depuis une photo",
      category: "Assistant",
      action: () => useEditor.setState({ panel: "ai", aiTab: "image" }),
    },
    {
      label: "Activer le mode expert",
      category: "Interface",
      action: () => useWorkspace.getState().setExpert(true),
    },
    {
      label: "Revenir au mode simple",
      category: "Interface",
      action: () => useWorkspace.getState().setExpert(false),
    },
    {
      label: "Raccourcis clavier",
      category: "Aide",
      hint: "?",
      action: () => s.openDialog("help"),
    },
  ];
  const normalize = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr");
  const filtered = commands.filter((c) =>
      normalize(`${c.label} ${c.category}`).includes(normalize(query)),
    ),
    active = Math.min(index, Math.max(0, filtered.length - 1));
  const execute = (command: Command) => {
    if (command.disabled) return;
    s.openDialog(null);
    try {
      command.action();
    } catch (e) {
      s.notify((e as Error).message, "error");
    }
  };
  return (
    <Modal
      title="Outils et commandes"
      subtitle="Tout est ici. Cherchez une action, puis appuyez sur Entrée."
      icon={Search}
      className="command-modal"
    >
      <div className="command-search">
        <Search size={18} />
        <input
          ref={input}
          aria-label="Rechercher une commande"
          placeholder="Chanfrein, fond, poser au sol…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((active + 1) % Math.max(1, filtered.length));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(
                (active + filtered.length - 1) % Math.max(1, filtered.length),
              );
            } else if (e.key === "Enter" && filtered[active]) {
              e.preventDefault();
              execute(filtered[active]);
            }
          }}
        />
        <kbd>Ctrl K</kbd>
      </div>
      <div className="command-results">
        {filtered.map((command, i) => (
          <button
            key={`${command.category}-${command.label}`}
            disabled={command.disabled}
            className={i === active ? "active" : ""}
            onPointerEnter={() => setIndex(i)}
            onClick={() => execute(command)}
          >
            <span>
              <strong>{command.label}</strong>
              <small>{command.category}</small>
            </span>
            {command.hint ? (
              <kbd>{command.hint}</kbd>
            ) : (
              <ArrowRight size={14} />
            )}
          </button>
        ))}
        {!filtered.length && (
          <p className="simple-hint">Aucune commande trouvée.</p>
        )}
      </div>
    </Modal>
  );
}
