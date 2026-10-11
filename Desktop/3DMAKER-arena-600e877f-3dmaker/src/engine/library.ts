import * as THREE from "three";
import {
  createPrimitive,
  serializeGeometry,
  transformMatrix,
  transformNodeWorld,
} from "./geometry";
import {
  DEFAULT_MATERIAL,
  identityTransform,
  uid,
  type SceneNode,
  type Vec3,
  type Primitive,
} from "../types";

export const ASSETS = [
  {
    id: "robot",
    name: "Robot",
    category: "Personnages",
    description: "Un compagnon articulé, pièce par pièce.",
    color: "#bcd1f3",
  },
  {
    id: "castle",
    name: "Château",
    category: "Architecture",
    description: "Tours, remparts, créneaux et pont d’entrée.",
    color: "#dccab2",
  },
  {
    id: "house",
    name: "Maison",
    category: "Architecture",
    description: "Un petit habitat avec toit, porte et fenêtres.",
    color: "#e6c5a5",
  },
  {
    id: "living-room",
    name: "Salon",
    category: "Objets",
    description: "Canapé, table basse, tapis et lampe.",
    color: "#a8c4b5",
  },
  {
    id: "rocket",
    name: "Fusée",
    category: "Objets",
    description: "Coque, hublots, ailettes et tuyère.",
    color: "#e4e8ef",
  },
  {
    id: "forest",
    name: "Forêt",
    category: "Nature",
    description: "Des arbres répartis autour d’une clairière.",
    color: "#95bfa2",
  },
  {
    id: "vase",
    name: "Vase",
    category: "Objets",
    description: "Une poterie creuse à paroi réelle et fond fermé.",
    color: "#d8aa8c",
  },
  {
    id: "city",
    name: "Ville",
    category: "Architecture",
    description: "Un quartier, ses rues et ses façades.",
    color: "#c2cddf",
  },
] as const;
export type AssetId = (typeof ASSETS)[number]["id"];
export const isAssetId = (value: unknown): value is AssetId =>
  ASSETS.some((a) => a.id === value);
export interface AssetOptions {
  size?: number;
  color?: string;
  position?: Vec3;
  name?: string;
}

/** Bibliothèque procédurale, hors IA : chaque élément est un véritable maillage éditable. */
export function createAsset(
  id: AssetId,
  options: AssetOptions = {},
): SceneNode[] {
  if (!isAssetId(id)) throw new Error("Création inconnue.");
  const size = options.size ?? 1;
  if (!Number.isFinite(size) || size < 0.05 || size > 20)
    throw new Error("La taille doit être comprise entre 0,05 et 20.");
  const position = options.position ?? [0, 0, 0];
  if (
    position.length !== 3 ||
    position.some((v) => !Number.isFinite(v) || Math.abs(v) > 10000)
  )
    throw new Error("Position de la création invalide.");
  if (options.color && !/^#[0-9a-f]{6}$/i.test(options.color))
    throw new Error("Couleur de la création invalide.");
  const prefix = (options.name || ASSETS.find((a) => a.id === id)!.name)
    .trim()
    .slice(0, 70);
  if (!prefix) throw new Error("Donnez un nom à la création.");
  const nodes: SceneNode[] = [];
  const custom = (
    geometry: THREE.BufferGeometry,
    name: string,
    p: Vec3,
    color: string,
    metallic = 0,
  ) => {
    const node: SceneNode = {
      id: uid(),
      name: `${prefix} · ${name}`,
      kind: "mesh",
      visible: true,
      locked: false,
      geometry: serializeGeometry(geometry),
      material: {
        ...structuredClone(DEFAULT_MATERIAL),
        color,
        roughness: metallic ? 0.28 : 0.65,
        metalness: metallic,
      },
      transform: { ...identityTransform(), position: p },
    };
    geometry.dispose();
    nodes.push(node);
    return node;
  };
  const box = (
    name: string,
    p: Vec3,
    dimensions: Vec3,
    color: string,
    metallic = 0,
  ) => custom(new THREE.BoxGeometry(...dimensions), name, p, color, metallic);
  const sphere = (
    name: string,
    p: Vec3,
    radius: number,
    color: string,
    metallic = 0,
  ) =>
    custom(new THREE.SphereGeometry(radius, 24, 16), name, p, color, metallic);
  const cylinder = (
    name: string,
    p: Vec3,
    radius: number,
    height: number,
    color: string,
    top = radius,
  ) =>
    custom(new THREE.CylinderGeometry(top, radius, height, 32), name, p, color);
  const cone = (
    name: string,
    p: Vec3,
    radius: number,
    height: number,
    color: string,
  ) => custom(new THREE.ConeGeometry(radius, height, 32), name, p, color);
  switch (id) {
    case "robot": {
      const blue = "#9bb9dc",
        dark = "#414a62";
      box("Corps", [0, 1.65, 0], [1.15, 1.05, 0.65], blue, 0.45);
      box("Tête", [0, 2.5, 0], [1.0, 0.65, 0.7], "#d6e1ef", 0.35);
      cylinder("Cou", [0, 2.19, 0], 0.15, 0.16, dark);
      for (const sign of [-1, 1]) {
        sphere(`Œil ${sign}`, [sign * 0.23, 2.55, 0.36], 0.09, "#74e9d1");
        sphere(`Épaule ${sign}`, [sign * 0.72, 2, 0], 0.2, dark, 0.6);
        cylinder(`Bras ${sign}`, [sign * 0.83, 1.65, 0], 0.13, 0.6, blue);
        sphere(`Main ${sign}`, [sign * 0.83, 1.28, 0], 0.18, "#d6e1ef", 0.35);
        cylinder(`Jambe ${sign}`, [sign * 0.31, 0.66, 0], 0.17, 0.8, dark);
        box(
          `Pied ${sign}`,
          [sign * 0.31, 0.14, 0.12],
          [0.4, 0.28, 0.65],
          blue,
          0.4,
        );
      }
      box("Écran", [0, 1.8, 0.335], [0.48, 0.3, 0.035], "#192734");
      cylinder("Antenne", [0, 2.98, 0], 0.035, 0.3, dark);
      sphere("Signal", [0, 3.15, 0], 0.07, "#efb478");
      break;
    }
    case "castle": {
      const stone = "#cec4af",
        roof = "#7e859f";
      box("Cour", [0, 0.08, 0], [6.6, 0.16, 6.6], "#b2ad9b");
      for (const x of [-2.65, 2.65])
        for (const z of [-2.65, 2.65]) {
          cylinder(`Tour ${x},${z}`, [x, 1.65, z], 0.64, 3.1, stone);
          cylinder(`Couronne ${x},${z}`, [x, 3.15, z], 0.76, 0.22, "#ddd5c4");
          cone(`Toit ${x},${z}`, [x, 3.85, z], 0.88, 1.2, roof);
        }
      for (const x of [-2.65, 2.65])
        box(`Rempart ${x}`, [x, 1.05, 0], [0.33, 2, 4.9], stone);
      box("Rempart arrière", [0, 1.05, -2.65], [4.9, 2, 0.33], stone);
      for (const sign of [-1, 1])
        box(`Entrée ${sign}`, [sign * 1.7, 1.05, 2.65], [1.8, 2, 0.33], stone);
      box("Linteau de porte", [0, 1.82, 2.65], [1.6, 0.5, 0.33], stone);
      box("Pont", [0, 0.15, 3.4], [1.5, 0.2, 1.8], "#806f5c");
      for (let i = 0; i < 10; i++) {
        const v = -2.4 + i * 0.53;
        for (const sign of [-1, 1])
          box(
            `Créneau latéral ${i}-${sign}`,
            [sign * 2.65, 2.19, v],
            [0.4, 0.4, 0.28],
            stone,
          );
        box(`Créneau arrière ${i}`, [v, 2.19, -2.65], [0.28, 0.4, 0.4], stone);
        if (Math.abs(v) > 0.85)
          box(`Créneau avant ${i}`, [v, 2.19, 2.65], [0.28, 0.4, 0.4], stone);
      }
      box("Donjon", [0, 1.63, -0.3], [1.8, 3.1, 1.8], "#ded3bd");
      cone("Toit du donjon", [0, 3.65, -0.3], 1.45, 1.2, roof);
      break;
    }
    case "house": {
      box("Murs", [0, 1.15, 0], [3.1, 2.3, 2.4], "#dfc8a8");
      const roof = custom(
        new THREE.CylinderGeometry(0, 2.3, 1.2, 4),
        "Toit",
        [0, 2.9, 0],
        "#986d67",
      );
      roof.transform.rotation[1] = Math.PI / 4;
      roof.transform.scale[2] = 0.83;
      box("Porte", [0, 0.75, 1.215], [0.65, 1.5, 0.05], "#6e797b");
      sphere("Poignée", [0.2, 0.73, 1.255], 0.04, "#c9af75", 0.8);
      for (const x of [-1, 1]) {
        box(`Cadre ${x}`, [x, 1.45, 1.23], [0.7, 0.8, 0.08], "#efe5d6");
        box(`Vitre ${x}`, [x, 1.45, 1.28], [0.58, 0.67, 0.02], "#a3c8db", 0.1);
        box(
          `Croisillon ${x}`,
          [x, 1.45, 1.305],
          [0.04, 0.67, 0.015],
          "#efe5d6",
        );
      }
      box("Cheminée", [0.85, 3.07, -0.35], [0.4, 1, 0.4], "#ba9b87");
      break;
    }
    case "living-room": {
      box("Tapis", [0, 0.025, 0.3], [4.5, 0.05, 3.6], "#c9baa4");
      for (const x of [-1.25, 1.25])
        for (const z of [-0.5, 0.4])
          cylinder(
            `Pied de canapé ${x},${z}`,
            [x, 0.17, z - 0.7],
            0.07,
            0.3,
            "#74685b",
          );
      box("Assise", [0, 0.49, -0.7], [3, 0.42, 1.2], "#86aa9a");
      box("Dossier", [0, 0.96, -1.22], [3, 1.05, 0.25], "#779c8a");
      for (const sign of [-1, 1])
        box(
          `Accoudoir ${sign}`,
          [sign * 1.5, 0.72, -0.7],
          [0.24, 0.8, 1.4],
          "#779c8a",
        );
      for (let i = -1; i <= 1; i++)
        box(
          `Coussin ${i}`,
          [i * 0.87, 0.77, -0.72],
          [0.82, 0.18, 0.95],
          "#adc5b7",
        );
      box("Table basse", [0, 0.5, 0.95], [1.8, 0.14, 0.9], "#957c61");
      for (const x of [-0.7, 0.7])
        for (const z of [0.66, 1.24])
          cylinder(
            `Pied de table ${x},${z}`,
            [x, 0.215, z],
            0.05,
            0.43,
            "#4c514f",
          );
      cylinder("Base de lampe", [2, 0.05, -0.7], 0.3, 0.1, "#575f5b");
      cylinder("Pied de lampe", [2, 0.83, -0.7], 0.035, 1.56, "#575f5b");
      cylinder("Abat-jour", [2, 1.68, -0.7], 0.36, 0.45, "#e9d9b8", 0.24);
      break;
    }
    case "rocket": {
      cylinder("Coque", [0, 1.8, 0], 0.55, 2.5, "#dfe5ed");
      cone("Ogive", [0, 3.45, 0], 0.55, 0.8, "#bfcfe5");
      cylinder("Tuyère", [0, 0.32, 0], 0.34, 0.6, "#505d72", 0.25);
      cylinder("Collier", [0, 0.65, 0], 0.6, 0.18, "#c28368");
      for (let i = 0; i < 3; i++) {
        const angle = (i * Math.PI * 2) / 3;
        const fin = box(
          `Ailette ${i + 1}`,
          [Math.sin(angle) * 0.59, 0.8, Math.cos(angle) * 0.59],
          [0.09, 1.05, 0.85],
          "#bacbe4",
        );
        fin.transform.rotation[1] = angle;
      }
      for (const y of [1.7, 2.3])
        sphere(`Hublot ${y}`, [0, y, 0.535], 0.16, "#70a8c5", 0.45);
      break;
    }
    case "forest": {
      cylinder("Clairière", [0, 0.04, 0], 3.5, 0.08, "#9cad8b");
      for (let i = 0; i < 12; i++) {
        const angle = i * 2.3999632297,
          radius = 1.15 + Math.sqrt(i / 12) * 1.9;
        const x = Math.cos(angle) * radius,
          z = Math.sin(angle) * radius,
          h = 1.4 + (i % 4) * 0.24;
        cylinder(`Tronc ${i + 1}`, [x, h * 0.28, z], 0.09, h * 0.56, "#8c7861");
        for (let j = 0; j < 3; j++)
          cone(
            `Feuillage ${i + 1}-${j}`,
            [x, h * (0.46 + j * 0.2), z],
            0.51 - j * 0.11,
            h * 0.62,
            ["#6f997a", "#7da685", "#91b58c"][j],
          );
      }
      break;
    }
    case "vase": {
      // Profil continu : sous-face, extérieur, lèvre puis intérieur et fond. Aucun bouchon sur l’ouverture.
      const points = [
        [0, 0],
        [0.52, 0],
        [0.58, 0.14],
        [0.85, 0.65],
        [0.72, 1.22],
        [0.36, 1.62],
        [0.34, 1.98],
        [0.29, 2.04],
        [0.24, 1.98],
        [0.27, 1.64],
        [0.64, 1.19],
        [0.75, 0.66],
        [0.5, 0.2],
        [0, 0.2],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      custom(
        new THREE.LatheGeometry(points, 64),
        "Poterie",
        [0, 0, 0],
        "#ce9b78",
      );
      break;
    }
    case "city": {
      box("Quartier", [0, 0.03, 0], [7.4, 0.06, 6.6], "#69757c");
      box("Rue centrale", [0, 0.067, 0], [7.3, 0.01, 0.65], "#4d575e");
      for (let i = 0; i < 4; i++)
        for (const side of [-1, 1]) {
          const x = -2.7 + i * 1.8,
            z = side * 1.7,
            h = 1.5 + ((i * 3 + side + 3) % 5) * 0.38;
          box(
            `Immeuble ${i}-${side}`,
            [x, h / 2 + 0.08, z],
            [1.3, h, 1.65],
            ["#b8c4ce", "#d0c2ac", "#93acb0", "#b4b1c5"][i],
          );
          for (let floor = 0; floor < Math.floor(h / 0.55); floor++)
            for (const col of [-1, 1])
              box(
                `Fenêtre ${i}-${side}-${floor}-${col}`,
                [x + col * 0.3, 0.46 + floor * 0.55, z - side * 0.84],
                [0.26, 0.31, 0.03],
                "#557686",
                0.1,
              );
        }
      break;
    }
  }
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion(),
    new THREE.Vector3(size, size, size),
  );
  return nodes.map((n) => {
    const transformed = transformNodeWorld(n, matrix);
    return options.color
      ? {
          ...transformed,
          material: { ...transformed.material, color: options.color },
        }
      : transformed;
  });
}

export function worldBounds(node: SceneNode): THREE.Box3 {
  if (!node.geometry)
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(...node.transform.position),
      new THREE.Vector3(),
    );
  const box = new THREE.Box3();
  const p = node.geometry.positions,
    matrix = transformMatrix(node.transform),
    point = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 3)
    box.expandByPoint(point.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(matrix));
  return box;
}
export function layoutNodes(
  nodes: SceneNode[],
  selection: string[],
  operation: "ground" | "center",
): SceneNode[] {
  const selected = nodes.filter(
    (n) => selection.includes(n.id) && !n.locked && n.geometry,
  );
  if (!selected.length)
    throw new Error("Sélectionnez au moins un maillage déverrouillé.");
  const bounds = new THREE.Box3();
  selected.forEach((n) => bounds.union(worldBounds(n)));
  const center = bounds.getCenter(new THREE.Vector3());
  return nodes.map((n) => {
    if (!selected.includes(n)) return n;
    const delta =
      operation === "ground"
        ? new THREE.Vector3(0, -worldBounds(n).min.y, 0)
        : new THREE.Vector3(-center.x, 0, -center.z);
    if (delta.lengthSq() < 1e-16) return n;
    return transformNodeWorld(
      n,
      new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z),
    );
  });
}

export function placePrimitive(
  type: Primitive,
  dimensions: Vec3,
  position: Vec3,
  name: string,
): SceneNode {
  const node = createPrimitive(type, name, position);
  node.transform.scale = [...dimensions];
  return node;
}

/** Évite qu’une nouvelle composition disparaisse à l’intérieur des objets existants. */
export function placeAlongside(
  added: SceneNode[],
  existing: SceneNode[],
): SceneNode[] {
  const occupied = new THREE.Box3(),
    bounds = new THREE.Box3();
  existing
    .filter((n) => n.geometry && n.visible)
    .forEach((n) => occupied.union(worldBounds(n)));
  added.filter((n) => n.geometry).forEach((n) => bounds.union(worldBounds(n)));
  if (occupied.isEmpty() || bounds.isEmpty()) return added;
  const delta = new THREE.Matrix4().makeTranslation(
    occupied.max.x + 0.8 - bounds.min.x,
    0,
    occupied.getCenter(new THREE.Vector3()).z -
      bounds.getCenter(new THREE.Vector3()).z,
  );
  return added.map((n) => transformNodeWorld(n, delta));
}
