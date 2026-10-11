import { useRef, useState } from "react";
import {
  Box,
  Search,
  Plus,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Lightbulb,
  Camera,
  Folder,
  Move,
  RotateCw,
  Scaling,
  MousePointer2,
  Copy,
  Trash2,
  GitMerge,
  ArrowUpFromLine,
  Layers,
  Scissors,
  FlipHorizontal2,
  Grid2X2,
  Orbit,
  Route,
  Ruler,
  Combine,
  Minus,
  Blend,
  Sparkles,
  ChevronsUpDown,
  X,
  Sun,
  CircleDot,
  Flashlight,
  ArrowRight,
  Diamond,
  Settings2,
} from "lucide-react";
import { useWorkspace } from "../store/workspace";
import { useEditor } from "../store/editor";
import { primitiveNames, type Primitive } from "../types";
import { IconButton, PrimitiveIcon, Section, Button } from "./common";
export function ScenePanel() {
  const expert = useWorkspace((s) => s.expert);
  const nodes = useEditor((s) => s.document.nodes);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [addMenu, setAddMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const dragged = useRef<string | null>(null);
  const s = useEditor.getState();
  const meshes = nodes.filter((n) => n.geometry);
  const selectedMesh = nodes.some(
    (n) => selection.includes(n.id) && n.geometry && !n.locked,
  );
  const filtered = nodes.filter((n) =>
    n.name.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr")),
  );
  const primitives = Object.keys(primitiveNames) as Primitive[];
  const transforms = [
    {
      id: "select" as const,
      icon: MousePointer2,
      label: "Sélection",
      key: "V",
    },
    { id: "translate" as const, icon: Move, label: "Déplacer", key: "W" },
    { id: "rotate" as const, icon: RotateCw, label: "Rotation", key: "E" },
    { id: "scale" as const, icon: Scaling, label: "Échelle", key: "R" },
  ];
  const advanced = [
    {
      id: "extrude",
      icon: ArrowUpFromLine,
      label: "Extrusion",
      tip: "Extruder les faces sélectionnées ou toute la surface",
    },
    {
      id: "bevel",
      icon: Diamond,
      label: "Chanfrein",
      tip: "Chanfreiner les arêtes du maillage",
    },
    {
      id: "subdivide",
      icon: Layers,
      label: "Subdivision",
      tip: "Subdivision de Loop, avec lissage configurable",
    },
    {
      id: "decimate",
      icon: Scissors,
      label: "Décimation",
      tip: "Réduire le nombre de triangles avec meshoptimizer",
    },
    {
      id: "mirror",
      icon: FlipHorizontal2,
      label: "Miroir",
      tip: "Réflexion du maillage selon un axe",
    },
    {
      id: "array",
      icon: Grid2X2,
      label: "Répétition",
      tip: "Créer une série d’objets régulièrement espacés",
    },
    {
      id: "lathe",
      icon: Orbit,
      label: "Révolution",
      tip: "Révolution du profil radial autour de l’axe Y",
    },
    {
      id: "spin",
      icon: RotateCw,
      label: "Spin",
      tip: "Répétition circulaire autour de l’origine, axe Y",
    },
    {
      id: "sweep",
      icon: Route,
      label: "Suivre un chemin",
      tip: "Extruder le contour XY sur un chemin 3D",
    },
    {
      id: "align",
      icon: ChevronsUpDown,
      label: "Alignement",
      tip: "Aligner les objets sur le premier sélectionné",
    },
  ];
  const commitName = (id: string) => {
    if (renameValue.trim())
      s.patchNode(
        id,
        { name: renameValue.trim().slice(0, 120) },
        "Renommer un objet",
      );
    setRenaming(null);
  };
  return (
    <aside className="scene-panel">
      <div className="panel-header">
        <h2>Votre scène</h2>
        <div className="add-anchor">
          <IconButton
            icon={Plus}
            label="Ajouter un objet ou une lumière"
            active={addMenu}
            onClick={() =>
              expert ? setAddMenu(!addMenu) : s.openDialog("create")
            }
          />
          {addMenu && (
            <>
              <button
                className="dropdown-scrim"
                aria-label="Fermer le menu"
                onClick={() => setAddMenu(false)}
              />
              <div className="dropdown add-dropdown">
                {primitives.map((type) => (
                  <button
                    key={type}
                    className="dropdown-item"
                    onClick={() => {
                      s.addPrimitive(type);
                      setAddMenu(false);
                    }}
                  >
                    <PrimitiveIcon type={type} size={16} />
                    {primitiveNames[type]}
                  </button>
                ))}
                <div className="dropdown-divider" />
                {[
                  {
                    type: "ambient" as const,
                    icon: Sun,
                    label: "Lumière ambiante",
                  },
                  {
                    type: "directional" as const,
                    icon: Lightbulb,
                    label: "Directionnelle",
                  },
                  {
                    type: "point" as const,
                    icon: CircleDot,
                    label: "Ponctuelle",
                  },
                  {
                    type: "spot" as const,
                    icon: Flashlight,
                    label: "Projecteur",
                  },
                ].map((item) => (
                  <button
                    key={item.type}
                    className="dropdown-item"
                    onClick={() => {
                      s.addLight(item.type);
                      setAddMenu(false);
                    }}
                  >
                    <item.icon size={15} />
                    {item.label}
                  </button>
                ))}
                <button
                  className="dropdown-item"
                  onClick={() => {
                    s.addCamera();
                    setAddMenu(false);
                  }}
                >
                  <Camera size={15} />
                  Caméra
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <label className="scene-search">
        <Search size={14} />
        <input
          aria-label="Rechercher dans la scène"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher dans la scène…"
        />
        <kbd>/</kbd>
      </label>
      <div className="scene-tree">
        <button
          className="collection-row"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <ChevronDown size={13} className={!expanded ? "-rotate-90" : ""} />
          <Folder size={15} />
          <span>Objets de la scène</span>
          <span className="count-badge">{nodes.length}</span>
        </button>
        {expanded && (
          <div className="tree-nodes">
            {filtered.map((node) => (
              <div
                key={node.id}
                className={`tree-node ${selection.includes(node.id) ? "selected" : ""} ${!node.visible ? "hidden-node" : ""}`}
                draggable={renaming !== node.id}
                onDragStart={() => {
                  dragged.current = node.id;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragged.current;
                  if (!id || id === node.id) return;
                  s.apply("Réordonner la scène", (d) => {
                    const item = d.nodes.find((n) => n.id === id)!;
                    const ordered = d.nodes.filter((n) => n.id !== id);
                    ordered.splice(
                      ordered.findIndex((n) => n.id === node.id),
                      0,
                      item,
                    );
                    return { ...d, nodes: ordered };
                  });
                  dragged.current = null;
                }}
                onClick={(e) =>
                  s.select(node.id, e.ctrlKey || e.metaKey || e.shiftKey)
                }
                onDoubleClick={() => {
                  setRenaming(node.id);
                  setRenameValue(node.name);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") s.select(node.id, e.shiftKey);
                }}
                role="treeitem"
                aria-selected={selection.includes(node.id)}
                tabIndex={0}
              >
                <span className={`node-icon ${node.kind}`}>
                  {node.kind === "mesh" ? (
                    <Box size={14} />
                  ) : node.kind === "light" ? (
                    <Lightbulb size={14} />
                  ) : (
                    <Camera size={14} />
                  )}
                </span>
                {renaming === node.id ? (
                  <input
                    autoFocus
                    aria-label="Nom de l’objet"
                    value={renameValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitName(node.id)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") commitName(node.id);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="node-name">{node.name}</span>
                )}
                <div className="node-actions">
                  <button
                    type="button"
                    title={node.locked ? "Déverrouiller" : "Verrouiller"}
                    aria-label={`${node.locked ? "Déverrouiller" : "Verrouiller"} ${node.name}`}
                    className={node.locked ? "is-locked" : ""}
                    onClick={(e) => {
                      e.stopPropagation();
                      s.patchNode(
                        node.id,
                        { locked: !node.locked },
                        "Verrouiller un objet",
                      );
                    }}
                  >
                    {node.locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </button>
                  <button
                    type="button"
                    title={node.visible ? "Masquer" : "Afficher"}
                    aria-label={`${node.visible ? "Masquer" : "Afficher"} ${node.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      s.patchNode(
                        node.id,
                        { visible: !node.visible },
                        "Changer la visibilité",
                      );
                    }}
                  >
                    {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
              </div>
            ))}
            {!filtered.length && (
              <div className="tree-empty">
                {query
                  ? "Aucun objet correspondant."
                  : "Votre scène est prête à créer."}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="scene-summary">
        <span>{meshes.length} maillages</span>
        <span>{nodes.filter((n) => n.light).length} lumières</span>
      </div>
      {!expert && (
        <div className="scene-simple-actions">
          <Button
            icon={Plus}
            variant="primary"
            onClick={() => s.openDialog("create")}
          >
            Ajouter une création
          </Button>
          <Button icon={Settings2} onClick={() => s.openDialog("commands")}>
            Outils et commandes<kbd>Ctrl K</kbd>
          </Button>
        </div>
      )}
      <div className="tools-scroll">
        <Section
          title="AJOUTER UNE PRIMITIVE"
          trailing={<span className="section-label">8 formes</span>}
        >
          <div className="primitives-grid">
            {primitives.map((type) => (
              <button
                key={type}
                className="primitive-button"
                title={`Ajouter ${primitiveNames[type].toLocaleLowerCase("fr")}`}
                onClick={() => s.addPrimitive(type)}
              >
                <PrimitiveIcon type={type} />
                <span>{primitiveNames[type]}</span>
              </button>
            ))}
          </div>
        </Section>
        <Section title="TRANSFORMATIONS">
          <div className="tools-grid">
            {transforms.map((item) => (
              <button
                key={item.id}
                className={`tool-button ${tool === item.id ? "selected" : ""}`}
                onClick={() => s.setTool(item.id)}
                title={`${item.label} (${item.key})`}
              >
                <item.icon size={15} />
                <span>{item.label}</span>
                <kbd>{item.key}</kbd>
              </button>
            ))}
          </div>
          <div className="quick-actions">
            <IconButton
              icon={Copy}
              label="Dupliquer (Maj D)"
              disabled={!selection.length}
              onClick={s.duplicateSelected}
            />
            <IconButton
              icon={GitMerge}
              label="Fusionner (Ctrl J)"
              disabled={selection.length < 2}
              onClick={s.mergeSelected}
            />
            <IconButton
              icon={Ruler}
              label="Mesurer une distance (M)"
              active={tool === "measure"}
              onClick={() => s.setTool("measure")}
            />
            <IconButton
              icon={Trash2}
              label="Supprimer (Suppr)"
              disabled={!selection.length}
              onClick={s.deleteSelected}
            />
          </div>
        </Section>
        <Section title="MODÉLISATION AVANCÉE">
          <div className="tools-grid advanced-grid">
            {advanced.map((item) => (
              <button
                key={item.id}
                className="tool-button"
                disabled={
                  item.id === "align" ? selection.length < 2 : !selectedMesh
                }
                title={item.tip}
                onClick={() => s.openDialog("advanced", item.id)}
              >
                <item.icon size={14} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </Section>
        <Section title="BOOLÉENNES">
          <div className="boolean-tools">
            {[
              { type: "union" as const, icon: Combine, label: "Union" },
              { type: "difference" as const, icon: Minus, label: "Différence" },
              {
                type: "intersection" as const,
                icon: Blend,
                label: "Intersection",
              },
            ].map((item) => (
              <button
                key={item.type}
                disabled={selection.length !== 2}
                title={
                  item.type === "difference"
                    ? "Retirer le second maillage du premier sélectionné"
                    : `${item.label} des deux maillages sélectionnés`
                }
                onClick={() => s.booleanSelected(item.type)}
              >
                <item.icon size={20} strokeWidth={1.4} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </Section>
      </div>
      <button
        className="ai-invite"
        onClick={() => useEditor.setState({ panel: "ai", aiTab: "chat" })}
      >
        <span className="ai-invite-icon">
          <Sparkles size={19} />
        </span>
        <span>
          <strong>Un coup de main ?</strong>
          <small>Créez avec votre assistant</small>
        </span>
        <ArrowRight size={14} />
      </button>
    </aside>
  );
}
