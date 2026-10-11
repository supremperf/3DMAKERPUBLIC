import { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Move,
  RotateCw,
  Scaling,
  Ruler,
  Magnet,
  BoxSelect,
  ChevronDown,
  Grid2X2,
  Scan,
  Camera,
  Maximize,
  Image,
  Box,
  Circle,
  Hexagon,
  Square,
  Eye,
  Copy,
  Trash2,
  Plus,
  Sparkles,
  LocateFixed,
  Layers3,
  Palette,
  Settings2,
} from "lucide-react";
import * as THREE from "three";
import { ViewportEngine, viewport } from "../engine/ViewportEngine";
import { handleImport } from "../engine/io";
import { useEditor } from "../store/editor";
import { IconButton } from "./common";
import type { EditMode } from "../types";
export function Viewport() {
  const mount = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [box, setBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [viewLabel, setViewLabel] = useState("Perspective");
  const [projection, setProjection] = useState("Perspective");
  const [draggingFile, setDraggingFile] = useState(false);
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.mode);
  const snap = useEditor((s) => s.snap);
  const selection = useEditor((s) => s.selection);
  const document = useEditor((s) => s.document);
  const components = useEditor((s) => s.components);
  const axisLock = useEditor((s) => s.axisLock);
  const transformSpace = useEditor((s) => s.transformSpace);
  const stats = useEditor((s) => s.stats);
  const measurement = useEditor((s) => s.measurement);
  const s = useEditor.getState();
  const selected = document.nodes.find((n) => n.id === selection[0]);
  useEffect(() => {
    if (!mount.current) return;
    let engine: ViewportEngine | null = null;
    try {
      engine = new ViewportEngine(mount.current, {
        onBox: setBox,
        onContextMenu: (x, y) => {
          const r = root.current!.getBoundingClientRect();
          setContext({
            x: Math.min(x - r.left, r.width - 210),
            y: Math.min(y - r.top, r.height - 245),
          });
        },
        onCamera: (label, type) => {
          setViewLabel(label);
          setProjection(type);
        },
      });
      viewport.set(engine);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      engine?.dispose();
      viewport.set(null);
    };
  }, [revision]);
  useEffect(() => {
    if (!context) return;
    const close = () => setContext(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [context]);
  const tools = [
    { id: "select" as const, icon: MousePointer2, label: "Sélection (V)" },
    { id: "translate" as const, icon: Move, label: "Déplacer (W)" },
    { id: "rotate" as const, icon: RotateCw, label: "Rotation (E)" },
    { id: "scale" as const, icon: Scaling, label: "Échelle (R)" },
    { id: "measure" as const, icon: Ruler, label: "Mesure de distance (M)" },
  ];
  const modes = [
    { id: "object" as EditMode, icon: Box, label: "Objet (Tab)" },
    { id: "vertex" as EditMode, icon: Circle, label: "Sommets (1)" },
    { id: "edge" as EditMode, icon: Hexagon, label: "Arêtes (2)" },
    { id: "face" as EditMode, icon: Square, label: "Faces (3)" },
  ];
  const fullscreen = async () => {
    try {
      if (window.document.fullscreenElement)
        await window.document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      s.notify("Le plein écran n’est pas autorisé dans ce navigateur.", "info");
    }
  };
  return (
    <main
      ref={root}
      className={`viewport edit-${mode} ${tool === "measure" ? "measuring" : ""} ${draggingFile ? "file-hover" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDraggingFile(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDraggingFile(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) void handleImport(files);
      }}
    >
      <div ref={mount} className="viewport-mount" />
      <div className="viewport-top">
        <div className="viewport-view-controls">
          <div className="viewport-select">
            <Eye size={13} />
            <select
              aria-label="Point de vue"
              value={viewLabel}
              onChange={(e) => {
                const value = e.target.value;
                s.focus(
                  (
                    {
                      Perspective: "perspective",
                      Face: "front",
                      Arrière: "back",
                      Dessus: "top",
                      Droite: "right",
                    } as const
                  )[value as "Perspective"],
                );
              }}
            >
              <option>Perspective</option>
              <option>Face</option>
              <option>Arrière</option>
              <option>Dessus</option>
              <option>Droite</option>
              {viewLabel === "Caméra" && <option>Caméra</option>}
            </select>
            <ChevronDown size={11} />
          </div>
          <div className="viewport-select shading-select">
            <span className="shading-dot" />
            <select
              aria-label="Style d’affichage"
              value={document.render.wireframe ? "wireframe" : "solid"}
              onChange={(e) =>
                s.setRender({ wireframe: e.target.value === "wireframe" })
              }
            >
              <option value="solid">Ombrage studio</option>
              <option value="wireframe">Filaire</option>
            </select>
            <ChevronDown size={11} />
          </div>
        </div>
        <div className="viewport-top-actions">
          <select
            className="compact-edit-mode"
            aria-label="Mode d’édition"
            value={mode}
            onChange={(e) => s.setMode(e.target.value as EditMode)}
          >
            <option value="object">Objet</option>
            <option value="vertex">Sommets</option>
            <option value="edge">Arêtes</option>
            <option value="face">Faces</option>
          </select>
          <span className="viewport-live-label">
            <span />
            TEMPS RÉEL
          </span>
          <IconButton
            icon={Camera}
            label="Capturer le viewport"
            onClick={() => s.openDialog("render")}
          />
          <IconButton
            icon={Maximize}
            label="Agrandir le viewport"
            onClick={() => void fullscreen()}
          />
        </div>
      </div>
      <div className="viewport-toolrail">
        {tools.map((item) => (
          <IconButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            caption={
              {
                select: "Choisir",
                translate: "Déplacer",
                rotate: "Tourner",
                scale: "Taille",
                measure: "Mesurer",
              }[item.id]
            }
            active={tool === item.id}
            onClick={() => s.setTool(item.id)}
          />
        ))}
        <span className="rail-divider" />
        <IconButton
          icon={Settings2}
          label="Tous les outils (Ctrl K)"
          onClick={() => s.openDialog("commands")}
        />
        <IconButton
          icon={Magnet}
          label={
            snap
              ? "Désactiver le magnétisme (Maj Tab)"
              : "Magnétisme : 0,25 m / 15° / 0,1 (Maj Tab)"
          }
          active={snap}
          onClick={() => useEditor.setState({ snap: !snap })}
        />
        <IconButton
          icon={Grid2X2}
          label="Afficher / masquer la grille (G)"
          active={document.render.grid}
          onClick={() => s.setRender({ grid: !document.render.grid })}
        />
        <span className="rail-divider" />
        <IconButton
          icon={Scan}
          label="Cadrer la sélection (F)"
          onClick={() => s.focus("focus")}
        />
      </div>
      <div className="viewport-modebar">
        {modes.map((item) => (
          <IconButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={mode === item.id}
            disabled={item.id !== "object" && !selected?.geometry}
            onClick={() => s.setMode(item.id)}
          />
        ))}
      </div>
      <OrientationWidget />
      <div className="projection-toggle">
        <button
          title="Basculer entre perspective et vue orthographique"
          onClick={() =>
            viewport
              .get()
              ?.setProjection(
                projection === "Perspective" ? "orthographic" : "perspective",
              )
          }
        >
          {projection === "Perspective" ? "PERSP" : "ORTHO"}
        </button>
      </div>
      <div className="viewport-stats">
        <span>
          <i />
          {stats.fps} <small>FPS</small>
        </span>
        <span>
          {stats.triangles.toLocaleString("fr-FR")} <small>triangles</small>
        </span>
      </div>
      {box && (
        <div
          className="selection-rectangle"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
      {error && (
        <div className="viewport-error">
          <Box size={35} />
          <h2>Le moteur 3D ne peut pas démarrer</h2>
          <p>
            Activez l’accélération matérielle et vérifiez que votre carte
            graphique prend en charge WebGL 2.
          </p>
          <small>{error}</small>
          <button
            className="button button-primary"
            onClick={() => setRevision((v) => v + 1)}
          >
            Relancer le moteur
          </button>
        </div>
      )}
      {draggingFile && (
        <div className="viewport-drop-overlay">
          <UploadSymbol />
          <h3>Ajoutez ce modèle à votre scène</h3>
          <p>OBJ · FBX · GLTF · GLB · STL · 3DMAKER</p>
        </div>
      )}
      {tool === "measure" && (
        <div className="measure-hint">
          <Ruler size={15} />
          {measurement.length === 2
            ? `${new THREE.Vector3(...measurement[0]).distanceTo(new THREE.Vector3(...measurement[1])).toFixed(3)} m · Cliquez pour recommencer`
            : measurement.length
              ? "Cliquez sur le second point"
              : "Cliquez sur le premier point à mesurer"}
        </div>
      )}
      <div className="viewport-bottom">
        <div className="viewport-selection-info">
          <span className="selection-status-dot" />
          <span>
            {selected
              ? selection.length > 1
                ? `${selection.length} objets sélectionnés`
                : selected.name
              : "Aucun objet sélectionné"}
          </span>
          {mode !== "object" && (
            <span className="component-count">
              {components.length}{" "}
              {mode === "vertex"
                ? "sommet(s)"
                : mode === "edge"
                  ? "arête(s)"
                  : "face(s)"}
            </span>
          )}
        </div>
        <div className="viewport-transform-options">
          <button
            title="Espace de transformation"
            onClick={() =>
              useEditor.setState({
                transformSpace: transformSpace === "world" ? "local" : "world",
              })
            }
          >
            <GlobeSymbol />
            {transformSpace === "world" ? "Global" : "Local"}
          </button>
          <span className="bottom-divider" />
          <span className="axis-lock-label">Axes</span>
          {(["x", "y", "z"] as const).map((axis) => (
            <button
              key={axis}
              className={`axis-lock axis-${axis} ${axisLock === axis ? "locked" : ""}`}
              title={
                axisLock === axis
                  ? `Déverrouiller l’axe ${axis.toUpperCase()}`
                  : `Limiter à l’axe ${axis.toUpperCase()}`
              }
              onClick={() =>
                useEditor.setState({
                  axisLock: axisLock === axis ? null : axis,
                })
              }
            >
              {axis.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {context && (
        <div
          className="dropdown viewport-context"
          style={{ left: context.x, top: context.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className="dropdown-item"
            onClick={() => {
              s.addPrimitive("cube");
              setContext(null);
            }}
          >
            <Plus size={14} />
            Ajouter un cube
          </button>
          <button
            className="dropdown-item"
            onClick={() => {
              s.duplicateSelected();
              setContext(null);
            }}
            disabled={!selection.length}
          >
            <Copy size={14} />
            Dupliquer<kbd>Maj D</kbd>
          </button>
          <button
            className="dropdown-item"
            onClick={() => {
              s.focus("focus");
              setContext(null);
            }}
          >
            <LocateFixed size={14} />
            Cadrer<kbd>F</kbd>
          </button>
          <button
            className="dropdown-item"
            onClick={() => {
              s.mergeSelected();
              setContext(null);
            }}
            disabled={selection.length < 2}
          >
            <Layers3 size={14} />
            Fusionner<kbd>Ctrl J</kbd>
          </button>
          <button
            className="dropdown-item with-separator"
            onClick={() => {
              s.deleteSelected();
              setContext(null);
            }}
            disabled={!selection.length}
          >
            <Trash2 size={14} />
            Supprimer<kbd>Suppr</kbd>
          </button>
          <button
            className="dropdown-item"
            onClick={() => {
              useEditor.setState({ panel: "ai", aiTab: "chat" });
              setContext(null);
            }}
          >
            <Sparkles size={14} />
            Demander à l’assistant
          </button>
        </div>
      )}
    </main>
  );
}
function OrientationWidget() {
  const [positions, setPositions] = useState<
    { x: number; y: number; z: number }[]
  >([
    { x: 27, y: 9, z: 0 },
    { x: 0, y: -28, z: 0 },
    { x: -24, y: 12, z: 0 },
  ]);
  useEffect(() => {
    const timer = setInterval(() => {
      const engine = viewport.get();
      if (!engine) return;
      const inverse = engine.camera.quaternion.clone().invert();
      setPositions(
        [
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, 0, 1),
        ].map((axis) => {
          const v = axis.applyQuaternion(inverse);
          return { x: v.x * 30, y: -v.y * 30, z: v.z };
        }),
      );
    }, 120);
    return () => clearInterval(timer);
  }, []);
  const colors = ["#e19a99", "#b9d886", "#8dadd9"];
  const views = ["right", "top", "front"] as const;
  return (
    <div className="orientation-widget">
      <svg viewBox="0 0 90 90" aria-hidden="true">
        <circle cx="45" cy="45" r="3" fill="#9b9da2" />
        {positions.map((p, i) => (
          <line
            key={i}
            x1="45"
            y1="45"
            x2={45 + p.x}
            y2={45 + p.y}
            stroke={colors[i]}
            opacity=".55"
            strokeWidth="1.5"
          />
        ))}
      </svg>
      {positions.map((p, i) => (
        <button
          key={i}
          className={`orientation-axis axis-${["x", "y", "z"][i]}`}
          style={{
            left: 45 + p.x,
            top: 45 + p.y,
            zIndex: p.z > 0 ? 2 : 1,
            opacity: p.z > -0.3 ? 1 : 0.55,
          }}
          title={`Vue ${["droite", "de dessus", "de face"][i]}`}
          onClick={() => useEditor.getState().focus(views[i])}
        >
          {["X", "Y", "Z"][i]}
        </button>
      ))}
    </div>
  );
}
function GlobeSymbol() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="6" cy="6" r="5" />
      <ellipse cx="6" cy="6" rx="2" ry="5" />
      <path d="M1 6h10" />
    </svg>
  );
}
function UploadSymbol() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
    </svg>
  );
}
