import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  X,
  Upload,
  Download,
  Settings2,
  Sparkles,
  ShieldCheck,
  ExternalLink,
  LoaderCircle,
  Check,
  TriangleAlert,
  Camera,
  ImagePlus,
  Keyboard,
  ArrowRight,
  Lock,
  Box,
} from "lucide-react";
import { Modal } from "./Modal";
import { ChatSetup } from "./ChatSetup";
import { CreationDialog } from "./CreationDialog";
import { CommandDialog } from "./CommandDialog";
import { useEditor, selectedMesh } from "../store/editor";
import { useAI } from "../store/ai";
import {
  Button,
  ColorField,
  IconButton,
  NumberInput,
  RangeInput,
  Toggle,
} from "./common";
import {
  bevel,
  extrude,
  subdivide,
  decimate,
  mirror,
  latheGeometry,
  sweepGeometry,
  triangleCount,
  spinConfiguration,
} from "../engine/geometry";
import { exportModel } from "../engine/io";
import { runGeometryJob, type MeshOperation } from "../engine/jobs";
import type { GeometryData } from "../types";
import { viewport } from "../engine/ViewportEngine";
import { chooseFiles, readAsDataURL, saveBytes } from "../services/bridge";
import { imageProviderDefaults, imageProviderNames } from "../services/imageAI";
import { bridge } from "../services/bridge";
import type { AIProvider, AISettings } from "../shared";
import type { Vec3 } from "../types";

export function Dialogs() {
  const dialog = useEditor((s) => s.dialog);
  if (!dialog) return null;
  if (dialog === "create") return <CreationDialog />;
  if (dialog === "commands") return <CommandDialog />;
  return (
    <>
      {dialog === "settings" ? (
        <SettingsDialog />
      ) : dialog === "advanced" ? (
        <AdvancedDialog />
      ) : dialog === "render" ? (
        <RenderDialog />
      ) : dialog === "export" ? (
        <ExportDialog />
      ) : (
        <HelpDialog />
      )}
    </>
  );
}
function SettingsDialog() {
  const original = useAI((s) => s.settings);
  const [draft, setDraft] = useState<AISettings>(structuredClone(original));
  const [tab, setTab] = useState<"image" | "chat">(
    useEditor.getState().advancedTool === "image" ? "image" : "chat",
  );
  const [showKeys, setShowKeys] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState("");
  const patchImage = (patch: Partial<AISettings["image"]>) =>
    setDraft((s) => ({ ...s, image: { ...s.image, ...patch } }));
  const patchChat = (patch: Partial<AISettings["chat"]>) =>
    setDraft((s) => ({ ...s, chat: { ...s.chat, ...patch } }));
  const save = async (close = true) => {
    setSaving(true);
    setError("");
    try {
      await useAI.getState().saveSettings(draft);
      if (close) {
        useEditor
          .getState()
          .notify("Paramètres IA enregistrés localement.", "success");
        useEditor.getState().openDialog(null);
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Connecter votre IA"
      subtitle="Les services sont préconfigurés. Il ne manque que votre accès personnel."
      icon={Sparkles}
      className="settings-modal"
      footer={
        <>
          <span className="settings-secure">
            <ShieldCheck size={13} />
            {window.desktop
              ? "Clés chiffrées par le système"
              : "Fichier local privé · mode aperçu"}
          </span>
          <Button onClick={() => useEditor.getState().openDialog(null)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={saving ? LoaderCircle : Check}
            disabled={saving}
            onClick={() => void save()}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="dialog-tabs">
        <button
          className={tab === "image" ? "active" : ""}
          onClick={() => setTab("image")}
        >
          <ImagePlus size={15} />
          Photo → 3D
        </button>
        <button
          className={tab === "chat" ? "active" : ""}
          onClick={() => setTab("chat")}
        >
          <Sparkles size={15} />
          Assistant de scène
        </button>
      </div>
      {tab === "image" ? (
        <div className="settings-fields">
          <label className="stacked-field">
            <span>Fournisseur de reconstruction</span>
            <select
              value={draft.image.provider}
              onChange={(e) => {
                const provider = e.target.value as AIProvider;
                patchImage({
                  provider,
                  ...imageProviderDefaults[provider],
                  texture:
                    provider === "stability" ? true : draft.image.texture,
                });
              }}
            >
              {Object.entries(imageProviderNames).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="stacked-field">
            <span>
              Endpoint de génération <small>URL complète du POST</small>
            </span>
            <input
              value={draft.image.endpoint}
              onChange={(e) => patchImage({ endpoint: e.target.value })}
              aria-label="Endpoint image-to-3D"
              spellCheck={false}
            />
          </label>
          <label className="stacked-field">
            <span>
              Clé API{" "}
              <button
                className="text-button"
                onClick={(e) => {
                  e.preventDefault();
                  setShowKeys(!showKeys);
                }}
              >
                {showKeys ? "Masquer" : "Afficher"}
              </button>
            </span>
            <input
              type={showKeys ? "text" : "password"}
              value={draft.image.apiKey}
              onChange={(e) => patchImage({ apiKey: e.target.value })}
              aria-label="Clé API image-to-3D"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="form-columns">
            <label className="stacked-field">
              <span>Modèle</span>
              <input
                value={draft.image.model}
                onChange={(e) => patchImage({ model: e.target.value })}
                aria-label="Modèle image-to-3D"
              />
            </label>
            <label className="stacked-field">
              <span>Qualité</span>
              <select
                value={draft.image.quality}
                onChange={(e) =>
                  patchImage({
                    quality: e.target.value as AISettings["image"]["quality"],
                  })
                }
              >
                <option value="low">Rapide</option>
                <option value="medium">Équilibrée</option>
                <option value="high">Haute fidélité</option>
              </select>
            </label>
          </div>
          <label className="form-row">
            <span>Triangles cibles</span>
            <NumberInput
              label="Nombre de triangles cible"
              value={draft.image.targetPolygons}
              step={1000}
              min={100}
              max={300000}
              onChange={(targetPolygons) => patchImage({ targetPolygons })}
            />
          </label>
          <Toggle
            label="Générer les textures PBR"
            value={draft.image.texture}
            onChange={(texture) => patchImage({ texture })}
            disabled={draft.image.provider === "stability"}
          />
          {draft.image.provider === "meshy" && (
            <div className="information-card">
              <Box size={17} />
              <p>
                Meshy crée une tâche puis renvoie un modèle GLB/GLTF. La qualité
                rapide / équilibrée / élevée utilise 35 % / 65 % / 100 % de la
                cible de polygones. La résolution des textures est gérée par
                Meshy.
              </p>
            </div>
          )}
          {draft.image.provider === "stability" && (
            <div className="information-card">
              <ImagePlus size={17} />
              <p>
                Fast 3D reçoit la photo en multipart et renvoie directement un
                GLB texturé. Le paramètre de sommets correspond à la moitié de
                la cible de triangles.
              </p>
            </div>
          )}
          {["generic", "luma"].includes(draft.image.provider) && (
            <div className="api-contract">
              <strong>
                {draft.image.provider === "luma"
                  ? "Passerelle Luma requise"
                  : "Contrat de votre endpoint"}
              </strong>
              {draft.image.provider === "luma" && (
                <p>
                  Configurez votre passerelle Luma compatible avec ce contrat.
                  Ce connecteur n’impose pas de route officielle ni de
                  conversion d’un service vidéo en modèle 3D.
                </p>
              )}
              <code>
                POST endpoint :{" "}
                {
                  '{ image, model, quality, target_polygons, texture, format: "glb" }'
                }
              </code>
              <code>
                Retour : {"{ id, status, progress }"} ou {"{ model_url }"} ou{" "}
                {"{ model_base64 }"} ou fichier GLB.
              </code>
              <code>
                Suivi : GET endpoint/id → {"{ status, progress, model_url }"}
              </code>
              <p>
                Authentification Bearer. Les serveurs locaux sont pris en charge
                sans clé API.
              </p>
            </div>
          )}
        </div>
      ) : (
        <ChatSetup
          draft={draft}
          onChange={setDraft}
          busy={saving}
          setBusy={setSaving}
          showKeys={showKeys}
        />
      )}
      {error && (
        <div className="error-card" role="alert">
          <TriangleAlert size={16} />
          <p>{error}</p>
        </div>
      )}
    </Modal>
  );
}
const advancedNames: Record<string, string> = {
  extrude: "Extrusion",
  bevel: "Chanfrein",
  subdivide: "Subdivision",
  decimate: "Décimation",
  mirror: "Miroir",
  array: "Répétition linéaire",
  lathe: "Révolution de profil",
  spin: "Répétition circulaire · Spin",
  sweep: "Extrusion sur un chemin",
  align: "Alignement",
};
function AdvancedDialog() {
  const tool = useEditor((s) => s.advancedTool);
  const document = useEditor((s) => s.document);
  const selection = useEditor((s) => s.selection);
  const [amount, setAmount] = useState(tool === "bevel" ? 0.1 : 0.3);
  const [count, setCount] = useState(tool === "spin" ? 8 : 3);
  const [iterations, setIterations] = useState(1);
  const [segments, setSegments] = useState(48);
  const [initialSpin] = useState(() => {
    const s = useEditor.getState(),
      n = s.document.nodes.find(
        (n) => s.selection.includes(n.id) && n.geometry,
      );
    return n?.geometry
      ? spinConfiguration(n.geometry, s.mode === "face" ? s.components : [])
      : { axis: "y" as const, center: [3, 0, 0] as Vec3 };
  });
  const [axis, setAxis] = useState<"x" | "y" | "z">(
    tool === "spin" ? initialSpin.axis : "x",
  );
  const [angle, setAngle] = useState(360);
  const [offset, setOffset] = useState<Vec3>(
    tool === "spin" ? initialSpin.center : [2.5, 0, 0],
  );
  const [ratio, setRatio] = useState(0.5);
  const [smooth, setSmooth] = useState(true);
  const [combine, setCombine] = useState(true);
  const [alignment, setAlignment] = useState<"min" | "center" | "max">(
    "center",
  );
  const [path, setPath] = useState("0, 0, 0\n0, 1, 2\n1, 2, 4\n3, 2, 6");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const node = document.nodes.find(
    (n) => selection.includes(n.id) && n.geometry && !n.locked,
  );
  const run = async () => {
    setBusy(true);
    setError("");
    const s = useEditor.getState();
    try {
      if (tool === "align") {
        if (selection.length < 2)
          throw new Error("Sélectionnez au moins deux objets.");
        s.alignSelected(axis, alignment);
      } else if (tool === "array") {
        if (!node) throw new Error("Sélectionnez un objet modifiable.");
        s.arraySelected(count, offset, false, angle);
      } else {
        if (!node?.geometry)
          throw new Error("Sélectionnez un maillage non verrouillé.");
        let pathPoints: Vec3[] | undefined;
        if (tool === "sweep") {
          const points = path
            .trim()
            .split("\n")
            .map((line) =>
              line
                .trim()
                .split(/[\s,;]+/)
                .map(Number),
            );
          if (
            points.length < 2 ||
            points.length > 64 ||
            points.some(
              (p) => p.length !== 3 || p.some((n) => !Number.isFinite(n)),
            )
          )
            throw new Error(
              "Indiquez 2 à 64 points, une ligne par point : x, y, z.",
            );
          pathPoints = points as Vec3[];
        }
        const geometry = await runGeometryJob<GeometryData>({
          type: "mesh",
          operation: tool as MeshOperation,
          data: node.geometry,
          options: {
            amount,
            faces: s.mode === "face" ? s.components : [],
            iterations,
            smooth,
            ratio,
            axis,
            combine,
            segments,
            angle: (angle * Math.PI) / 180,
            center: offset,
            path: pathPoints,
          },
        });
        /* La vérification de référence empêche d’appliquer un résultat calculé sur une scène devenue obsolète. */
        if (s.document !== useEditor.getState().document)
          throw new Error("La scène a changé pendant le calcul. Réessayez.");
        s.replaceGeometry(node.id, geometry, advancedNames[tool]);
        if (tool === "spin") s.focus("focus");
      }
      s.notify(
        `${advancedNames[tool]} appliqué${tool === "extrude" || tool === "subdivide" || tool === "decimate" ? "e" : ""}.`,
        "success",
      );
      s.openDialog(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={advancedNames[tool] || tool}
      subtitle={`${node?.name || `${selection.length} objets`} · modification réelle, annulable avec Ctrl Z`}
      icon={Box}
      footer={
        <>
          <span className="modal-footer-hint">
            <UndoSmall />
            Une action dans l’historique
          </span>
          <Button onClick={() => useEditor.getState().openDialog(null)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={busy ? LoaderCircle : Check}
            disabled={busy || (!node && tool !== "align")}
            onClick={() => void run()}
          >
            {busy ? "Calcul en cours…" : "Appliquer"}
          </Button>
        </>
      }
    >
      {["extrude", "bevel"].includes(tool) && (
        <>
          <label className="form-row">
            <span>
              {tool === "bevel"
                ? "Largeur du chanfrein (m)"
                : "Distance d’extrusion (m)"}
            </span>
            <NumberInput
              label="Distance de modélisation"
              value={amount}
              min={tool === "bevel" ? 0.001 : -10}
              max={10}
              step={0.01}
              onChange={setAmount}
            />
          </label>
          <div className="information-card">
            <Box size={16} />
            <p>
              {tool === "extrude"
                ? useEditor.getState().mode === "face" &&
                  useEditor.getState().components.length
                  ? `${useEditor.getState().components.length} faces sélectionnées seront extrudées avec des raccords sur leur contour.`
                  : "Aucune face sélectionnée : la surface entière est déplacée le long des normales. Passez en mode Faces pour extruder une région."
                : "Les faces coplanaires sont réunies, puis les contours sont décalés et raccordés. La largeur est limitée localement pour éviter les croisements sur les petites arêtes."}
            </p>
          </div>
        </>
      )}
      {tool === "subdivide" && (
        <>
          <label className="form-row">
            <span>Itérations</span>
            <NumberInput
              label="Itérations de subdivision"
              value={iterations}
              onChange={(v) => setIterations(Math.round(v))}
              min={1}
              max={3}
              step={1}
            />
          </label>
          <Toggle label="Lissage de Loop" value={smooth} onChange={setSmooth} />
          <p className="dialog-help">
            {node?.geometry
              ? `Estimation : ${(triangleCount(node.geometry) * Math.pow(4, iterations)).toLocaleString("fr-FR")} triangles. `
              : ""}
            Désactivez le lissage pour conserver les surfaces planes.
          </p>
        </>
      )}
      {tool === "decimate" && (
        <>
          <RangeInput
            label="Triangles à conserver"
            min={0.05}
            max={0.95}
            value={ratio}
            onChange={setRatio}
          />
          <p className="dialog-help">
            Cible :{" "}
            {node?.geometry
              ? Math.round(triangleCount(node.geometry) * ratio).toLocaleString(
                  "fr-FR",
                )
              : 0}{" "}
            triangles. Le simplificateur préserve les bords ouverts et limite
            l’erreur géométrique.
          </p>
        </>
      )}
      {["mirror", "align", "spin"].includes(tool) && (
        <label className="form-row">
          <span>Axe</span>
          <div className="segmented-control">
            {(["x", "y", "z"] as const).map((item) => (
              <button
                key={item}
                className={axis === item ? "active" : ""}
                onClick={() => setAxis(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        </label>
      )}
      {tool === "mirror" && (
        <>
          <Toggle
            label="Conserver et fusionner l’original"
            value={combine}
            onChange={setCombine}
          />
          <p className="dialog-help">
            Réflexion autour de l’origine locale de l’objet. Les normales sont
            réorientées automatiquement.
          </p>
        </>
      )}
      {tool === "array" && (
        <>
          <label className="form-row">
            <span>Nombre d’objets, original inclus</span>
            <NumberInput
              label="Nombre de répétitions"
              value={count}
              min={2}
              max={100}
              step={1}
              onChange={(v) => setCount(Math.round(v))}
            />
          </label>
          {tool === "array" && (
            <div className="form-columns">
              {offset.map((value, index) => (
                <label className="stacked-field" key={index}>
                  <span>Décalage {["X", "Y", "Z"][index]} (m)</span>
                  <NumberInput
                    label={`Décalage ${["X", "Y", "Z"][index]}`}
                    value={value}
                    onChange={(v) => {
                      const next = [...offset] as Vec3;
                      next[index] = v;
                      setOffset(next);
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </>
      )}
      {tool === "spin" && (
        <>
          <div className="form-columns">
            {offset.map((value, index) => (
              <label className="stacked-field" key={index}>
                <span>Centre {["X", "Y", "Z"][index]} local (m)</span>
                <NumberInput
                  label={`Centre de Spin ${["X", "Y", "Z"][index]}`}
                  value={value}
                  onChange={(v) => {
                    const next = [...offset] as Vec3;
                    next[index] = v;
                    setOffset(next);
                  }}
                />
              </label>
            ))}
          </div>
          <p className="dialog-help">
            Extrusion angulaire raccordée, pas une duplication d’objets.
            Utilisez un plan ou une région sélectionnée en mode Faces. L’axe
            doit rester dans le plan du profil, à l’extérieur de celui-ci. À
            360°, les extrémités sont soudées ; un arc partiel est fermé par
            deux bouchons.
          </p>
        </>
      )}
      {["spin", "lathe"].includes(tool) && (
        <label className="form-row">
          <span>Angle total (°)</span>
          <NumberInput
            label="Angle total de révolution"
            value={angle}
            min={1}
            max={360}
            step={1}
            onChange={setAngle}
          />
        </label>
      )}
      {["lathe", "sweep", "spin"].includes(tool) && (
        <label className="form-row">
          <span>Segments</span>
          <NumberInput
            label="Segments de révolution"
            value={segments}
            min={8}
            max={128}
            step={1}
            onChange={(v) => setSegments(Math.round(v))}
          />
        </label>
      )}
      {tool === "lathe" && (
        <div className="information-card">
          <Box size={16} />
          <p>
            Le profil radial de l’objet est échantillonné puis mis en révolution
            autour de son axe Y local.
          </p>
        </div>
      )}
      {tool === "sweep" && (
        <>
          <label className="stacked-field">
            <span>
              Chemin 3D <small>un point x, y, z par ligne</small>
            </span>
            <textarea
              value={path}
              rows={5}
              aria-label="Points du chemin d’extrusion"
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <p className="dialog-help">
            Le contour convexe XY de l’objet sert de section. Le chemin est
            interpolé par une courbe de Catmull–Rom.
          </p>
        </>
      )}
      {tool === "align" && (
        <>
          <label className="form-row">
            <span>Référence de la boîte englobante</span>
            <select
              value={alignment}
              onChange={(e) => setAlignment(e.target.value as typeof alignment)}
            >
              <option value="min">Minimum</option>
              <option value="center">Centre</option>
              <option value="max">Maximum</option>
            </select>
          </label>
          <p className="dialog-help">
            Les objets sont alignés sur le premier objet sélectionné. Maintenez
            Maj pour en sélectionner plusieurs dans la scène.
          </p>
        </>
      )}
      {error && (
        <div className="error-card" role="alert">
          <TriangleAlert size={16} />
          <p>{error}</p>
        </div>
      )}
    </Modal>
  );
}
function UndoSmall() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M4 9V4m0 5h5M4 9c6-8 16-1 14 7-1 4-7 4-10 1" />
    </svg>
  );
}
function ExportDialog() {
  const doc = useEditor((s) => s.document);
  const selection = useEditor((s) => s.selection);
  const [format, setFormat] = useState<"glb" | "gltf" | "obj" | "fbx" | "stl">(
    "glb",
  );
  const [onlySelected, setOnlySelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formats = [
    { id: "glb" as const, label: "GLB", help: "Compact · textures intégrées" },
    {
      id: "gltf" as const,
      label: "GLTF",
      help: "Ouvert · JSON et données intégrées",
    },
    { id: "obj" as const, label: "OBJ", help: "Géométrie + matériaux MTL" },
    { id: "fbx" as const, label: "FBX", help: "FBX 7.4 · textures intégrées" },
    { id: "stl" as const, label: "STL", help: "Impression 3D · binaire" },
  ];
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      if (await exportModel(format, onlySelected))
        useEditor.getState().openDialog(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const count = doc.nodes.filter(
    (n) => n.geometry && (onlySelected ? selection.includes(n.id) : n.visible),
  ).length;
  return (
    <Modal
      title="Votre création, partout."
      subtitle="Exportez un vrai modèle 3D, prêt pour votre prochain projet."
      icon={Upload}
      className="export-modal"
      footer={
        <>
          <span className="modal-footer-hint">
            {count} maillage{count > 1 ? "s" : ""} à exporter
          </span>
          <Button onClick={() => useEditor.getState().openDialog(null)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={busy ? LoaderCircle : Download}
            disabled={busy || !count}
            onClick={() => void run()}
          >
            {busy ? "Export en cours…" : `Exporter en ${format.toUpperCase()}`}
          </Button>
        </>
      }
    >
      <div className="export-formats">
        {formats.map((f) => (
          <button
            key={f.id}
            className={format === f.id ? "active" : ""}
            onClick={() => setFormat(f.id)}
          >
            <span>{f.label}</span>
            <small>{f.help}</small>
            {format === f.id && <Check size={15} />}
          </button>
        ))}
      </div>
      <Toggle
        label="Exporter uniquement la sélection"
        value={onlySelected}
        onChange={setOnlySelected}
        disabled={!selection.length}
      />
      <div className="information-card">
        <Box size={17} />
        <p>
          {format === "stl"
            ? "Les transformations sont appliquées aux sommets. STL ne transporte ni matériaux ni textures. Vérifiez que le maillage est fermé avant l’impression."
            : format === "obj"
              ? "L’OBJ et ses matériaux sont enregistrés ensemble. Dans l’aperçu navigateur, un ZIP contient l’OBJ, le MTL et les textures."
              : "Les transformations, UV et matériaux de surface sont conservés. Les outils et les contrôles de la vue 3D ne sont pas exportés."}
        </p>
      </div>
      {error && (
        <div className="error-card" role="alert">
          <TriangleAlert size={16} />
          <p>{error}</p>
        </div>
      )}
    </Modal>
  );
}
function RenderDialog() {
  const render = useEditor((s) => s.document.render);
  const [tab, setTab] = useState<"capture" | "scene">("capture");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [format, setFormat] = useState<"image/png" | "image/jpeg">("image/png");
  const [includeGrid, setIncludeGrid] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const s = useEditor.getState();
  useEffect(() => {
    let active = true,
      url: string | undefined;
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      const engine = viewport.get();
      if (!engine) {
        setBusy(false);
        setError("La vue 3D n’est pas disponible.");
        return;
      }
      void engine
        .capture(
          960,
          540,
          "image/png",
          includeGrid,
          controller.signal,
          transparent && format === "image/png",
        )
        .then((blob) => {
          url = URL.createObjectURL(blob);
          if (active) {
            setPreview(url);
            setError("");
          } else URL.revokeObjectURL(url);
        })
        .catch((e) => {
          if (active && (e as Error).name !== "AbortError")
            setError((e as Error).message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 300);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [render, includeGrid, transparent, format]);
  const capture = async () => {
    setBusy(true);
    setError("");
    try {
      const engine = viewport.get();
      if (!engine) throw new Error("Le viewport n’est pas disponible.");
      const blob = await engine.capture(
        Math.round(width),
        Math.round(height),
        format,
        includeGrid,
        undefined,
        transparent,
      );
      const saved = await saveBytes(
        `3dmaker-rendu-${width}x${height}.${format === "image/png" ? "png" : "jpg"}`,
        await blob.arrayBuffer(),
      );
      if (saved) s.notify("Rendu haute résolution enregistré.", "success");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importHDR = async () => {
    try {
      const [file] = await chooseFiles(".hdr");
      if (!file) return;
      if (
        !file.name.toLowerCase().endsWith(".hdr") ||
        file.size > 32 * 1024 * 1024
      )
        throw new Error("Choisissez un fichier HDR de moins de 32 Mo.");
      const hdri = await readAsDataURL(
        new Blob([file], { type: "image/vnd.radiance" }),
      );
      s.setRender({ environment: "custom", hdri });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="La lumière fait la différence."
      subtitle="Réglez votre scène et capturez chaque détail."
      icon={Camera}
      className="render-modal"
      footer={
        <>
          <span className="modal-footer-hint">
            Rendu temps réel · sans panneaux ni gizmos
          </span>
          <Button onClick={() => s.openDialog(null)}>Fermer</Button>
          <Button
            variant="primary"
            icon={busy ? LoaderCircle : Download}
            disabled={busy}
            onClick={() => void capture()}
          >
            {busy ? "Rendu…" : "Enregistrer le rendu"}
          </Button>
        </>
      }
    >
      <div className="dialog-tabs">
        <button
          className={tab === "capture" ? "active" : ""}
          onClick={() => setTab("capture")}
        >
          Capture haute résolution
        </button>
        <button
          className={tab === "scene" ? "active" : ""}
          onClick={() => setTab("scene")}
        >
          Paramètres de scène
        </button>
      </div>
      {tab === "capture" ? (
        <>
          <div className="render-preview">
            {preview ? (
              <img src={preview} alt="Rendu réel de votre scène" />
            ) : (
              <LoaderCircle size={26} className="spin" />
            )}
            <span>APERÇU DE LA VUE 3D</span>
          </div>
          <div className="resolution-presets">
            {[
              { name: "Full HD", w: 1920, h: 1080 },
              { name: "4K", w: 3840, h: 2160 },
              { name: "Carré", w: 4096, h: 4096 },
              {
                name: "Vue 3D",
                w: Math.max(
                  128,
                  viewport.get()?.renderer.domElement.clientWidth || 1920,
                ),
                h: Math.max(
                  128,
                  viewport.get()?.renderer.domElement.clientHeight || 1080,
                ),
              },
            ].map((p) => (
              <button
                key={p.name}
                className={width === p.w && height === p.h ? "active" : ""}
                onClick={() => {
                  setWidth(p.w);
                  setHeight(p.h);
                }}
              >
                {p.name}
                <small>
                  {p.w} × {p.h}
                </small>
              </button>
            ))}
          </div>
          <div className="form-columns">
            <label className="stacked-field">
              <span>Largeur (px)</span>
              <NumberInput
                label="Largeur du rendu"
                value={width}
                min={128}
                max={8192}
                step={1}
                onChange={setWidth}
              />
            </label>
            <label className="stacked-field">
              <span>Hauteur (px)</span>
              <NumberInput
                label="Hauteur du rendu"
                value={height}
                min={128}
                max={8192}
                step={1}
                onChange={setHeight}
              />
            </label>
            <label className="stacked-field">
              <span>Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
              >
                <option value="image/png">PNG · sans perte</option>
                <option value="image/jpeg">JPEG · qualité 95 %</option>
              </select>
            </label>
          </div>
          <Toggle
            label="Fond transparent (PNG)"
            value={transparent && format === "image/png"}
            disabled={format !== "image/png"}
            onChange={setTransparent}
          />
          <Toggle
            label="Inclure la grille"
            value={includeGrid}
            onChange={setIncludeGrid}
          />
        </>
      ) : (
        <div className="render-settings">
          <ColorField
            label="Fond du viewport"
            value={render.background}
            onChange={(background) =>
              s.setRender({ background, backgroundMode: "color" })
            }
          />
          <label className="form-row">
            <span>Courbe tonale</span>
            <select
              value={render.toneMapping}
              onChange={(e) =>
                s.setRender({
                  toneMapping: e.target.value as typeof render.toneMapping,
                })
              }
            >
              <option value="aces">ACES filmique</option>
              <option value="filmic">Filmique · AgX</option>
              <option value="linear">Linéaire</option>
            </select>
          </label>
          <RangeInput
            label="Exposition"
            min={0.1}
            max={5}
            value={render.exposure}
            onChange={(exposure) => s.setRender({ exposure })}
          />
          <RangeInput
            label="Gamma"
            min={1}
            max={3}
            value={render.gamma}
            onChange={(gamma) => s.setRender({ gamma })}
          />
          <Toggle
            label="Antialiasing FXAA"
            value={render.antialias}
            onChange={(antialias) => s.setRender({ antialias })}
          />
          <Toggle
            label="Ombres temps réel"
            value={render.shadows}
            onChange={(shadows) => s.setRender({ shadows })}
          />
          <label className="form-row">
            <span>Résolution des ombres</span>
            <select
              value={render.shadowQuality}
              onChange={(e) =>
                s.setRender({
                  shadowQuality: Number(
                    e.target.value,
                  ) as typeof render.shadowQuality,
                })
              }
            >
              {[512, 1024, 2048, 4096].map((size) => (
                <option key={size} value={size}>
                  {size} × {size}
                </option>
              ))}
            </select>
          </label>
          <label className="form-row">
            <span>Environnement HDRI</span>
            <select
              value={render.environment}
              onChange={(e) =>
                s.setRender({
                  environment: e.target.value as typeof render.environment,
                })
              }
            >
              <option value="studio">Studio · lumière de pièce</option>
              <option value="sunset">Soleil · panorama HDR</option>
              <option value="night">Nuit · panorama HDR</option>
              {render.hdri && <option value="custom">HDR importé</option>}
            </select>
          </label>
          <RangeInput
            label="Intensité d’environnement"
            max={3}
            value={render.environmentIntensity}
            onChange={(environmentIntensity) =>
              s.setRender({ environmentIntensity })
            }
          />
          <Button icon={ImagePlus} onClick={() => void importHDR()}>
            Importer un environnement HDR
          </Button>
          <Toggle
            label="Brouillard de scène"
            value={render.fog}
            onChange={(fog) => s.setRender({ fog })}
          />
          {render.fog && (
            <>
              <ColorField
                label="Couleur du brouillard"
                value={render.fogColor}
                onChange={(fogColor) => s.setRender({ fogColor })}
              />
              <RangeInput
                label="Densité du brouillard"
                max={0.15}
                step={0.001}
                value={render.fogDensity}
                onChange={(fogDensity) => s.setRender({ fogDensity })}
              />
            </>
          )}
          <Toggle
            label="Afficher la grille"
            value={render.grid}
            onChange={(grid) => s.setRender({ grid })}
          />
          <Toggle
            label="Afficher les axes"
            value={render.axes}
            onChange={(axes) => s.setRender({ axes })}
          />
        </div>
      )}
      {error && (
        <div className="error-card" role="alert">
          <TriangleAlert size={16} />
          <p>{error}</p>
        </div>
      )}
    </Modal>
  );
}
function HelpDialog() {
  const groups = [
    {
      title: "Navigation",
      rows: [
        ["Clic gauche + glisser", "Orbiter autour de la scène"],
        ["Clic droit / molette + glisser", "Déplacer la vue"],
        ["Molette", "Zoomer / dézoomer"],
        ["F / double-clic", "Cadrer la sélection"],
        ["Origine", "Cadrer toute la scène"],
        ["Pavé 1 / 3 / 7", "Face / droite / dessus"],
        ["Pavé 5", "Perspective / orthographique"],
      ],
    },
    {
      title: "Édition",
      rows: [
        ["V / W / E / R", "Sélection / translation / rotation / échelle"],
        ["Tab", "Objet / édition du maillage"],
        ["1 / 2 / 3", "Sommets / arêtes / faces"],
        ["Maj + clic", "Ajouter ou retirer de la sélection"],
        ["Maj + glisser", "Sélection rectangulaire en mode Sélection"],
        ["Maj D", "Dupliquer"],
        ["Suppr", "Supprimer"],
        ["Ctrl J", "Fusionner les maillages"],
        ["M", "Mesurer une distance"],
        ["X / Y / Z", "Limiter la transformation à un axe"],
        ["Maj Tab", "Activer / désactiver le magnétisme"],
        ["Échap", "Désélectionner / fermer le dialogue"],
      ],
    },
    {
      title: "Projet & affichage",
      rows: [
        ["Ctrl S / Ctrl O / Ctrl I", "Enregistrer / ouvrir / importer"],
        ["Ctrl N", "Nouvelle scène"],
        ["Ctrl E", "Exporter"],
        ["Ctrl Z / Ctrl Maj Z", "Annuler / rétablir (500 états)"],
        ["Ctrl A", "Sélectionner tous les objets"],
        ["G / Z (outil Sélection)", "Grille / vue filaire"],
        ["F11", "Plein écran"],
        ["?", "Afficher cette aide"],
        ["/", "Rechercher un objet"],
      ],
    },
  ];
  return (
    <Modal
      title="Quelques touches. Beaucoup de possibilités."
      subtitle="Les raccourcis de votre studio 3D."
      icon={Keyboard}
      className="help-modal"
      footer={
        <>
          <span className="modal-footer-hint">
            Les raccourcis sont désactivés pendant la saisie.
          </span>
          <Button
            variant="primary"
            onClick={() => useEditor.getState().openDialog(null)}
          >
            C’est parti
          </Button>
        </>
      }
    >
      <div className="shortcut-groups">
        {groups.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            {group.rows.map(([keys, action]) => (
              <div key={keys}>
                <kbd>{keys}</kbd>
                <span>{action}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
