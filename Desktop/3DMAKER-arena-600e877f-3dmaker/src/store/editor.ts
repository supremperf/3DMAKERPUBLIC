import { create } from "zustand";
import * as THREE from "three";
import {
  createInitialNodes,
  createPrimitive,
  createLight,
  createCamera,
  deleteComponents,
  topology,
  mergeNodes,
  deserializeGeometry,
  transformMatrix,
} from "../engine/geometry";
import { runGeometryJob } from "../engine/jobs";
import {
  DEFAULT_RENDER,
  uid,
  type SceneDocument,
  type SceneNode,
  type HistoryEntry,
  type EditMode,
  type Tool,
  type Toast,
  type ViewportStats,
  type Primitive,
  type RenderSettings,
  type Vec3,
  type GeometryData,
} from "../types";

export type DialogName =
  | "export"
  | "render"
  | "settings"
  | "advanced"
  | "help"
  | "create"
  | "commands"
  | null;
interface EditorState {
  document: SceneDocument;
  savedDocument: SceneDocument;
  selection: string[];
  components: number[];
  mode: EditMode;
  tool: Tool;
  axisLock: "x" | "y" | "z" | null;
  transformSpace: "world" | "local";
  snap: boolean;
  panel: "properties" | "ai" | "background";
  aiTab: "image" | "chat" | "history";
  dialog: DialogName;
  advancedTool: string;
  past: HistoryEntry[];
  future: HistoryEntry[];
  toasts: Toast[];
  stats: ViewportStats;
  cameraCommand: {
    id: number;
    view:
      | "perspective"
      | "front"
      | "back"
      | "top"
      | "right"
      | "focus"
      | "all"
      | "camera";
    nodeId?: string;
  };
  measurement: Vec3[];
  busy: boolean;
  busyMessage: string;
  apply(
    label: string,
    updater: (document: SceneDocument) => SceneDocument,
  ): void;
  preview(document: SceneDocument): void;
  beginTransaction(): void;
  endTransaction(label: string): void;
  undo(): void;
  redo(): void;
  select(id: string | null, additive?: boolean): void;
  selectAll(): void;
  setComponents(ids: number[]): void;
  setMode(mode: EditMode): void;
  setTool(tool: Tool): void;
  patchNode(id: string, patch: Partial<SceneNode>, label?: string): void;
  patchSelected(updater: (node: SceneNode) => SceneNode, label: string): void;
  addPrimitive(type: Primitive): void;
  addLight(type: NonNullable<SceneNode["light"]>["type"]): void;
  addCamera(): void;
  addNodes(nodes: SceneNode[], label: string): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  replaceGeometry(id: string, geometry: GeometryData, label: string): void;
  mergeSelected(): void;
  booleanSelected(
    operation: "union" | "difference" | "intersection",
  ): Promise<void>;
  alignSelected(
    axis: "x" | "y" | "z",
    alignment: "min" | "center" | "max",
  ): void;
  arraySelected(
    count: number,
    offset: Vec3,
    radial?: boolean,
    angle?: number,
  ): void;
  setRender(patch: Partial<RenderSettings>): void;
  newDocument(): void;
  loadDocument(document: SceneDocument): void;
  markSaved(): void;
  notify(message: string, kind?: Toast["kind"]): void;
  dismissToast(id: string): void;
  openDialog(dialog: DialogName, advancedTool?: string): void;
  focus(view?: EditorState["cameraCommand"]["view"], nodeId?: string): void;
}
const initial: SceneDocument = {
  version: 1,
  name: "Sans titre",
  nodes: createInitialNodes(),
  render: { ...DEFAULT_RENDER },
};
let transaction: SceneDocument | null = null;
const HISTORY_LIMIT = 500;
function editable(node: SceneNode, selection: string[]) {
  return selection.includes(node.id) && !node.locked;
}
export const useEditor = create<EditorState>((set, get) => ({
  document: initial,
  savedDocument: initial,
  selection: [initial.nodes[0].id],
  components: [],
  mode: "object",
  tool: "select",
  axisLock: null,
  transformSpace: "world",
  snap: false,
  panel: "properties",
  aiTab: "chat",
  dialog: null,
  advancedTool: "extrude",
  past: [],
  future: [],
  toasts: [],
  stats: { fps: 0, triangles: 0, vertices: 0, objects: 0 },
  cameraCommand: { id: 0, view: "perspective" },
  measurement: [],
  busy: false,
  busyMessage: "",
  apply(label, updater) {
    const current = get();
    const next = updater(current.document);
    if (next === current.document) return;
    if (next.nodes.length > 3000) {
      get().notify(
        "La scène est limitée à 3 000 objets pour conserver une édition fluide.",
        "error",
      );
      return;
    }
    if (transaction) set({ document: next });
    else
      set({
        document: next,
        past: [...current.past, { document: current.document, label }].slice(
          -HISTORY_LIMIT,
        ),
        future: [],
      });
  },
  preview: (document) => set({ document }),
  beginTransaction() {
    if (!transaction) transaction = get().document;
  },
  endTransaction(label) {
    const before = transaction;
    transaction = null;
    if (before && before !== get().document)
      set((s) => ({
        past: [...s.past, { document: before, label }].slice(-HISTORY_LIMIT),
        future: [],
      }));
  },
  undo() {
    transaction = null;
    const s = get();
    const entry = s.past.at(-1);
    if (!entry) return;
    set({
      document: entry.document,
      past: s.past.slice(0, -1),
      future: [...s.future, { document: s.document, label: entry.label }],
      components: [],
      selection: s.selection.filter((id) =>
        entry.document.nodes.some((n) => n.id === id),
      ),
    });
  },
  redo() {
    transaction = null;
    const s = get();
    const entry = s.future.at(-1);
    if (!entry) return;
    set({
      document: entry.document,
      future: s.future.slice(0, -1),
      past: [...s.past, { document: s.document, label: entry.label }].slice(
        -HISTORY_LIMIT,
      ),
      components: [],
      selection: s.selection.filter((id) =>
        entry.document.nodes.some((n) => n.id === id),
      ),
    });
  },
  select(id, additive = false) {
    set((s) => ({
      selection: id
        ? additive
          ? s.selection.includes(id)
            ? s.selection.filter((v) => v !== id)
            : [...s.selection, id]
          : [id]
        : [],
      components: [],
      mode:
        id && s.document.nodes.find((n) => n.id === id)?.kind === "mesh"
          ? s.mode
          : "object",
    }));
  },
  selectAll() {
    const s = get(),
      node = s.document.nodes.find((n) => n.id === s.selection[0]);
    if (s.mode !== "object" && node?.geometry && !node.locked) {
      const t = topology(node.geometry),
        count =
          s.mode === "vertex"
            ? t.vertices.length
            : s.mode === "edge"
              ? t.edges.size
              : t.faces.length;
      set({ components: Array.from({ length: count }, (_, i) => i) });
    } else
      set({
        selection: s.document.nodes
          .filter((n) => n.visible && !n.locked)
          .map((n) => n.id),
        components: [],
      });
  },
  setComponents: (components) => set({ components }),
  setMode(mode) {
    const selected = get().document.nodes.find(
      (n) => n.id === get().selection[0],
    );
    if (mode !== "object" && selected?.kind !== "mesh") {
      get().notify(
        "Sélectionnez un maillage pour éditer ses composants.",
        "info",
      );
      return;
    }
    set({
      mode,
      components: [],
      tool: mode === "object" ? get().tool : "translate",
    });
  },
  setTool: (tool) =>
    set({ tool, measurement: tool === "measure" ? [] : get().measurement }),
  patchNode(id, patch, label = "Modifier l’objet") {
    get().apply(label, (d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
  },
  patchSelected(updater, label) {
    const selected = get().selection;
    get().apply(label, (d) => ({
      ...d,
      nodes: d.nodes.map((n) => (editable(n, selected) ? updater(n) : n)),
    }));
  },
  addPrimitive(type) {
    const node = createPrimitive(type);
    const count = get().document.nodes.filter((n) =>
      n.name.startsWith(node.name),
    ).length;
    if (count) node.name += `.${String(count).padStart(3, "0")}`;
    get().addNodes([node], `Ajouter ${node.name}`);
  },
  addLight(type) {
    get().addNodes([createLight(type)], "Ajouter une lumière");
  },
  addCamera() {
    get().addNodes([createCamera()], "Ajouter une caméra");
  },
  addNodes(nodes, label) {
    get().apply(label, (d) => ({ ...d, nodes: [...d.nodes, ...nodes] }));
    set({ selection: nodes.map((n) => n.id), components: [], mode: "object" });
  },
  deleteSelected() {
    const ids = get().selection;
    if (!ids.length) return;
    if (get().mode !== "object") {
      const node = get().document.nodes.find((n) => n.id === ids[0]);
      if (!node?.geometry || node.locked) return;
      if (!get().components.length) {
        get().notify("Sélectionnez des composants à supprimer.", "info");
        return;
      }
      const geometry = deleteComponents(
        node.geometry,
        get().mode as "vertex" | "edge" | "face",
        get().components,
      );
      if (geometry)
        get().replaceGeometry(node.id, geometry, "Supprimer des composants");
      else {
        get().apply("Supprimer tout le maillage", (d) => ({
          ...d,
          nodes: d.nodes.filter((n) => n.id !== node.id),
        }));
        set({ selection: [], components: [], mode: "object" });
      }
      return;
    }
    const locked = get().document.nodes.some(
      (n) => ids.includes(n.id) && n.locked,
    );
    get().apply("Supprimer les objets", (d) => ({
      ...d,
      nodes: d.nodes.filter((n) => !editable(n, ids)),
    }));
    set({
      selection: locked
        ? ids.filter((id) => get().document.nodes.some((n) => n.id === id))
        : [],
      components: [],
    });
    if (locked)
      get().notify("Les objets verrouillés ont été conservés.", "info");
  },
  duplicateSelected() {
    const nodes = get()
      .document.nodes.filter((n) => get().selection.includes(n.id))
      .map((n) => ({
        ...n,
        id: uid(),
        name: `${n.name.slice(0, 100)} — copie`,
        transform: {
          ...n.transform,
          position: [
            n.transform.position[0] + 0.5,
            n.transform.position[1],
            n.transform.position[2] + 0.5,
          ] as Vec3,
        },
      }));
    if (nodes.length) get().addNodes(nodes, "Dupliquer les objets");
  },
  replaceGeometry(id, geometry, label) {
    get().patchNode(id, { geometry }, label);
    set({ components: [] });
  },
  mergeSelected() {
    const nodes = get().document.nodes.filter(
      (n) => editable(n, get().selection) && n.geometry,
    );
    try {
      const merged = mergeNodes(nodes);
      get().apply("Fusionner les maillages", (d) => ({
        ...d,
        nodes: [...d.nodes.filter((n) => !nodes.includes(n)), merged],
      }));
      set({ selection: [merged.id], components: [], mode: "object" });
    } catch (e) {
      get().notify(String((e as Error).message), "error");
    }
  },
  async booleanSelected(operation) {
    const before = get().document;
    const selected = get()
      .selection.map((id) => before.nodes.find((n) => n.id === id))
      .filter((n): n is SceneNode => !!n && n.kind === "mesh" && !n.locked);
    if (selected.length !== 2) {
      get().notify(
        "Sélectionnez exactement deux maillages. La différence retire le second du premier.",
        "info",
      );
      return;
    }
    if (get().busy) {
      get().notify("Un calcul est déjà en cours.", "info");
      return;
    }
    set({ busy: true, busyMessage: "Calcul de la booléenne…" });
    try {
      const result = await runGeometryJob<SceneNode>({
        type: "boolean",
        a: selected[0],
        b: selected[1],
        operation,
      });
      if (get().document !== before)
        throw new Error(
          "La scène a changé pendant le calcul. Relancez la booléenne.",
        );
      get().apply(`Booléenne : ${result.name}`, (d) => ({
        ...d,
        nodes: [...d.nodes.filter((n) => !selected.includes(n)), result],
      }));
      set({ selection: [result.id], components: [], mode: "object" });
      get().notify(`${result.name} terminée.`, "success");
    } catch (e) {
      get().notify((e as Error).message, "error");
    } finally {
      set({ busy: false });
    }
  },
  alignSelected(axis, alignment) {
    const nodes = get()
      .selection.map((id) => get().document.nodes.find((n) => n.id === id))
      .filter((n): n is SceneNode => !!n && !n.locked);
    if (nodes.length < 2) {
      get().notify("Sélectionnez au moins deux objets à aligner.", "info");
      return;
    }
    const bounds = nodes.map((n) => {
      if (!n.geometry)
        return new THREE.Box3(
          new THREE.Vector3(...n.transform.position),
          new THREE.Vector3(...n.transform.position),
        );
      const g = deserializeGeometry(n.geometry);
      const box = g
        .boundingBox!.clone()
        .applyMatrix4(transformMatrix(n.transform));
      g.dispose();
      return box;
    });
    const coordinate = (box: THREE.Box3) =>
      alignment === "center"
        ? box.getCenter(new THREE.Vector3())[axis]
        : box[alignment][axis];
    const target = coordinate(bounds[0]);
    const index = { x: 0, y: 1, z: 2 }[axis];
    get().apply("Aligner les objets", (d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        const i = nodes.indexOf(n);
        if (i < 0) return n;
        const position = [...n.transform.position] as Vec3;
        position[index] += target - coordinate(bounds[i]);
        return { ...n, transform: { ...n.transform, position } };
      }),
    }));
  },
  arraySelected(count, offset, radial = false, angle = 360) {
    const selected = get().document.nodes.filter((n) =>
      editable(n, get().selection),
    );
    const nodes: SceneNode[] = [];
    for (let i = 1; i < Math.min(100, Math.max(2, Math.floor(count))); i++)
      for (const n of selected) {
        let position: Vec3,
          rotation: Vec3 = [...n.transform.rotation];
        if (radial) {
          const theta = THREE.MathUtils.degToRad((angle * i) / count);
          position = new THREE.Vector3(...n.transform.position)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), theta)
            .toArray() as Vec3;
          rotation[1] += theta;
        } else
          position = n.transform.position.map(
            (v, axis) => v + offset[axis] * i,
          ) as Vec3;
        nodes.push({
          ...n,
          id: uid(),
          name: `${n.name.slice(0, 100)} ${i + 1}`,
          transform: { ...n.transform, position, rotation },
        });
      }
    if (nodes.length)
      get().addNodes(
        nodes,
        radial ? "Répétition circulaire" : "Répétition linéaire",
      );
  },
  setRender(patch) {
    get().apply("Modifier le rendu", (d) => ({
      ...d,
      render: { ...d.render, ...patch },
    }));
  },
  newDocument() {
    const document: SceneDocument = {
      version: 1,
      name: "Sans titre",
      nodes: [],
      render: { ...DEFAULT_RENDER },
    };
    get().apply("Nouvelle scène", () => document);
    set({
      selection: [],
      components: [],
      mode: "object",
      savedDocument: document,
    });
  },
  loadDocument(document) {
    get().apply("Ouvrir le projet", () => document);
    set({
      selection: [],
      components: [],
      mode: "object",
      savedDocument: document,
    });
    get().focus("all");
  },
  markSaved() {
    set({ savedDocument: get().document });
  },
  notify(message, kind = "info") {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind }] }));
    window.setTimeout(
      () => get().dismissToast(id),
      kind === "error" ? 9000 : 4500,
    );
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  openDialog(dialog, advancedTool) {
    set({ dialog, ...(advancedTool ? { advancedTool } : {}) });
  },
  focus(view = "focus", nodeId) {
    set((s) => ({
      cameraCommand: { id: s.cameraCommand.id + 1, view, nodeId },
    }));
  },
}));
export const selectedNodes = () => {
  const s = useEditor.getState();
  return s.document.nodes.filter((n) => s.selection.includes(n.id));
};
export const selectedMesh = () =>
  selectedNodes().find((n) => n.geometry && !n.locked);
