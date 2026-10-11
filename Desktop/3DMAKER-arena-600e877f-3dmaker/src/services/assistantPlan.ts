import { createAsset, isAssetId, layoutNodes } from "../engine/library";
import { brushedNormalTexture } from "../engine/texturePresets";
import {
  createPrimitive,
  createLight,
  createCamera,
  booleanOperation,
  mergeNodes,
  bevel,
  extrude,
  subdivide,
  mirror,
  latheGeometry,
  sweepGeometry,
  spinGeometry,
} from "../engine/geometry";
import {
  uid,
  type MaterialData,
  type Primitive,
  type SceneDocument,
  type SceneNode,
  type Vec3,
  type EditMode,
} from "../types";
type Action = Record<string, unknown> & { type: string };
export interface AssistantPlan {
  message: string;
  actions: Action[];
}
const primitives: Primitive[] = [
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
  "tube",
  "box",
];
const number = (
  value: unknown,
  fallback: number,
  min = -10000,
  max = 10000,
): number => {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`Valeur numérique IA hors limites (${min} à ${max}).`);
  return value;
};
const vector = (value: unknown, fallback: Vec3): Vec3 => {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length !== 3)
    throw new Error("L’IA a fourni un vecteur invalide.");
  return value.map((v) => number(v, 0)) as Vec3;
};
const color = (value: unknown): string => {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw new Error("L’IA a fourni une couleur invalide.");
  return value;
};
const string = (value: unknown, fallback: string): string => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || value.length > 120)
    throw new Error("L’IA a fourni un nom invalide.");
  return value.trim();
};
const bool = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new Error("L’IA a fourni une valeur booléenne invalide.");
  return value;
};
function materialPatch(value: unknown, current: MaterialData): MaterialData {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Le matériau proposé est invalide.");
  const patch = value as Record<string, unknown>;
  const result = { ...current };
  for (const [key, v] of Object.entries(patch)) {
    if (["color", "emissive"].includes(key))
      (result as unknown as Record<string, unknown>)[key] = color(v);
    else if (
      [
        "roughness",
        "metalness",
        "opacity",
        "transmission",
        "clearcoat",
        "clearcoatRoughness",
        "anisotropy",
      ].includes(key)
    )
      (result as unknown as Record<string, unknown>)[key] = number(v, 0, 0, 1);
    else if (key === "ior") result.ior = number(v, 1.5, 1, 2.333);
    else if (key === "thickness") result.thickness = number(v, 0.1, 0, 10000);
    else if (key === "finish") {
      if (!["brushed", "smooth"].includes(v as string))
        throw new Error("Finition de matériau invalide.");
      result.textures = { ...current.textures };
      if (v === "brushed") {
        result.textures.normalMap = brushedNormalTexture();
        result.anisotropy = 0.85;
        result.normalScale = 0.35;
      } else {
        delete result.textures.normalMap;
        result.anisotropy = 0;
      }
    } else if (key === "emissiveIntensity")
      result.emissiveIntensity = number(v, 0, 0, 20);
    else if (["flatShading", "doubleSided"].includes(key))
      (result as unknown as Record<string, unknown>)[key] = bool(v, false);
    else throw new Error(`Champ de matériau non autorisé : ${key}.`);
  }
  return result;
}
export function parseAssistantPlan(raw: string): AssistantPlan {
  let value: unknown;
  try {
    value = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error(
      "L’assistant n’a pas retourné un JSON valide. Activez le mode JSON ou choisissez un modèle compatible.",
    );
  }
  const plan = value as AssistantPlan;
  if (
    !plan ||
    typeof plan.message !== "string" ||
    !plan.message.trim() ||
    plan.message.length > 16000 ||
    !Array.isArray(plan.actions) ||
    plan.actions.length > 200 ||
    plan.actions.some((a) => !a || typeof a.type !== "string")
  )
    throw new Error(
      "Le plan de l’assistant est invalide ou dépasse 200 actions.",
    );
  return plan;
}
export function executePlan(
  document: SceneDocument,
  selection: string[],
  plan: AssistantPlan,
  context: { mode?: EditMode; components?: number[] } = {},
): { document: SceneDocument; selection: string[] } {
  let nodes = [...document.nodes];
  let render = { ...document.render };
  let created: string[] = [];
  const targets = (value: unknown, geometryOnly = false): SceneNode[] => {
    const list =
      value === undefined
        ? ["selection"]
        : Array.isArray(value)
          ? value
          : [value];
    if (!list.every((item) => typeof item === "string"))
      throw new Error("Cible IA invalide.");
    const matches = nodes.filter(
      (n) =>
        !n.locked &&
        (!geometryOnly || n.geometry) &&
        list.some(
          (item) =>
            item === "all" ||
            (item === "selection" && selection.includes(n.id)) ||
            item === n.id ||
            item === n.name,
        ),
    );
    if (!matches.length)
      throw new Error(
        "Aucun objet modifiable ne correspond à la cible de l’assistant.",
      );
    return matches;
  };
  const update = (
    target: unknown,
    fn: (n: SceneNode) => SceneNode,
    geometryOnly = false,
  ) => {
    const ids = new Set(targets(target, geometryOnly).map((n) => n.id));
    nodes = nodes.map((n) => (ids.has(n.id) ? fn(n) : n));
  };
  for (const action of plan.actions) {
    switch (action.type) {
      case "create_asset": {
        if (!isAssetId(action.asset))
          throw new Error("Création de bibliothèque IA inconnue.");
        const asset = createAsset(action.asset, {
          size: number(action.size, 1, 0.05, 20),
          position: vector(action.position, [0, 0, 0]),
          name:
            action.name === undefined
              ? undefined
              : string(action.name, "Création"),
          color: action.color === undefined ? undefined : color(action.color),
        });
        nodes.push(...asset);
        created.push(...asset.map((n) => n.id));
        break;
      }
      case "layout": {
        if (!["ground", "center"].includes(action.operation as string))
          throw new Error("Disposition IA invalide.");
        nodes = layoutNodes(
          nodes,
          targets(action.target, true).map((n) => n.id),
          action.operation as "ground" | "center",
        );
        break;
      }
      case "set_light": {
        update(action.target, (n) => {
          if (!n.light) throw new Error("La cible n’est pas une lumière.");
          return {
            ...n,
            light: {
              ...n.light,
              color:
                action.color === undefined
                  ? n.light.color
                  : color(action.color),
              intensity: number(action.intensity, n.light.intensity, 0, 10000),
              distance: number(action.distance, n.light.distance, 0, 10000),
              angle: number(action.angle, n.light.angle, 1, 89),
              target: vector(action.targetPoint, n.light.target),
              castShadow: bool(action.castShadow, n.light.castShadow),
            },
          };
        });
        break;
      }
      case "set_camera": {
        update(action.target, (n) => {
          if (!n.camera) throw new Error("La cible n’est pas une caméra.");
          return {
            ...n,
            camera: {
              ...n.camera,
              fov: number(action.fov, n.camera.fov, 5, 150),
              target: vector(action.targetPoint, n.camera.target),
            },
          };
        });
        break;
      }
      case "create_primitive": {
        if (!primitives.includes(action.primitive as Primitive))
          throw new Error("Primitive IA non autorisée.");
        const n = createPrimitive(
          action.primitive as Primitive,
          string(action.name, `Objet IA ${nodes.length + 1}`),
          vector(action.position, [0, 1, 0]),
        );
        n.transform.rotation = vector(action.rotation, [0, 0, 0]).map(
          (v) => (v * Math.PI) / 180,
        ) as Vec3;
        n.transform.scale = vector(action.scale, [1, 1, 1]);
        if (n.transform.scale.some((v) => Math.abs(v) < 0.0001))
          throw new Error("L’échelle ne peut pas être nulle.");
        if (action.material)
          n.material = materialPatch(action.material, n.material);
        nodes.push(n);
        created.push(n.id);
        break;
      }
      case "create_light": {
        if (
          !["ambient", "directional", "point", "spot"].includes(
            action.lightType as string,
          )
        )
          throw new Error("Type de lumière IA invalide.");
        const n = createLight(
          action.lightType as NonNullable<SceneNode["light"]>["type"],
        );
        n.name = string(action.name, n.name);
        n.transform.position = vector(action.position, n.transform.position);
        n.light = {
          ...n.light!,
          color: action.color ? color(action.color) : n.light!.color,
          intensity: number(action.intensity, n.light!.intensity, 0, 10000),
          distance: number(action.distance, 20, 0, 10000),
          angle: number(action.angle, 40, 1, 89),
          target: vector(action.targetPoint, [0, 0, 0]),
          castShadow: bool(action.castShadow, true),
        };
        nodes.push(n);
        created.push(n.id);
        break;
      }
      case "create_camera": {
        const n = createCamera();
        n.name = string(action.name, n.name);
        n.transform.position = vector(action.position, n.transform.position);
        n.camera = {
          ...n.camera!,
          target: vector(action.targetPoint, [0, 0, 0]),
          fov: number(action.fov, 45, 5, 150),
        };
        nodes.push(n);
        created.push(n.id);
        break;
      }
      case "set_material":
        update(
          action.target,
          (n) => ({
            ...n,
            material: materialPatch(action.material, n.material),
          }),
          true,
        );
        break;
      case "transform":
        update(action.target, (n) => {
          const relative = bool(action.relative, false);
          const position = vector(
            action.position,
            relative ? [0, 0, 0] : n.transform.position,
          );
          const rotation =
            action.rotation === undefined
              ? relative
                ? ([0, 0, 0] as Vec3)
                : n.transform.rotation
              : (vector(action.rotation, [0, 0, 0]).map(
                  (v) => (v * Math.PI) / 180,
                ) as Vec3);
          const scale = vector(
            action.scale,
            relative ? [1, 1, 1] : n.transform.scale,
          );
          const transform = relative
            ? {
                position: n.transform.position.map(
                  (v, i) => v + position[i],
                ) as Vec3,
                rotation: n.transform.rotation.map(
                  (v, i) => v + rotation[i],
                ) as Vec3,
                scale: n.transform.scale.map((v, i) => v * scale[i]) as Vec3,
              }
            : { position, rotation, scale };
          if (transform.scale.some((v) => Math.abs(v) < 0.0001))
            throw new Error("L’échelle ne peut pas être nulle.");
          return { ...n, transform };
        });
        break;
      case "rename":
        update(action.target, (n) => ({
          ...n,
          name: string(action.name, n.name),
        }));
        break;
      case "visibility":
        update(action.target, (n) => ({
          ...n,
          visible: bool(action.visible, true),
        }));
        break;
      case "delete": {
        const ids = new Set(targets(action.target).map((n) => n.id));
        nodes = nodes.filter((n) => !ids.has(n.id));
        break;
      }
      case "duplicate": {
        const offset = vector(action.offset, [0.5, 0, 0.5]);
        const copies = targets(action.target).map((n) => ({
          ...n,
          id: uid(),
          name: `${n.name.slice(0, 100)} — copie`,
          transform: {
            ...n.transform,
            position: n.transform.position.map((v, i) => v + offset[i]) as Vec3,
          },
        }));
        nodes.push(...copies);
        created.push(...copies.map((n) => n.id));
        break;
      }
      case "array": {
        const count = Math.floor(number(action.count, 3, 2, 100)),
          offset = vector(action.offset, [2, 0, 0]),
          radial = bool(action.radial, false),
          angle = number(action.angle, 360, 1, 360);
        const sources = targets(action.target);
        for (let i = 1; i < count; i++)
          for (const n of sources) {
            const theta = (((angle * i) / count) * Math.PI) / 180;
            const [x, y, z] = n.transform.position;
            const position: Vec3 = radial
              ? [
                  x * Math.cos(theta) + z * Math.sin(theta),
                  y,
                  -x * Math.sin(theta) + z * Math.cos(theta),
                ]
              : (n.transform.position.map(
                  (v, axis) => v + offset[axis] * i,
                ) as Vec3);
            const copy = {
              ...n,
              id: uid(),
              name: `${n.name.slice(0, 100)} ${i + 1}`,
              transform: {
                ...n.transform,
                position,
                rotation: radial
                  ? ([
                      n.transform.rotation[0],
                      n.transform.rotation[1] + theta,
                      n.transform.rotation[2],
                    ] as Vec3)
                  : n.transform.rotation,
              },
            };
            nodes.push(copy);
            created.push(copy.id);
          }
        break;
      }
      case "boolean": {
        if (
          !Array.isArray(action.targets) ||
          action.targets.length !== 2 ||
          !["union", "difference", "intersection"].includes(
            action.operation as string,
          )
        )
          throw new Error("Opération booléenne IA invalide.");
        const a = targets(action.targets[0], true)[0],
          b = targets(action.targets[1], true)[0];
        if (a.id === b.id)
          throw new Error(
            "Les deux cibles booléennes doivent être différentes.",
          );
        const result = booleanOperation(
          a,
          b,
          action.operation as "union" | "difference" | "intersection",
        );
        nodes = [
          ...nodes.filter((n) => n.id !== a.id && n.id !== b.id),
          result,
        ];
        created.push(result.id);
        break;
      }
      case "merge": {
        const selected = targets(action.target, true);
        const result = mergeNodes(selected);
        nodes = [...nodes.filter((n) => !selected.includes(n)), result];
        created.push(result.id);
        break;
      }
      case "mesh_operation":
        update(
          action.target,
          (n) => {
            let geometry = n.geometry!;
            const faces =
              action.faces === undefined
                ? context.mode === "face" && selection.includes(n.id)
                  ? context.components || []
                  : []
                : action.faces;
            if (
              !Array.isArray(faces) ||
              faces.some(
                (i) =>
                  !Number.isInteger(i) ||
                  i < 0 ||
                  i >=
                    (geometry.indices?.length ||
                      geometry.positions.length / 3) /
                      3,
              )
            )
              throw new Error("Sélection de faces IA invalide.");
            switch (action.operation) {
              case "extrude":
                geometry = extrude(
                  geometry,
                  faces,
                  number(action.amount, 0.2, -10, 10),
                );
                break;
              case "bevel":
                geometry = bevel(
                  geometry,
                  number(action.amount, 0.1, 0.001, 5),
                );
                break;
              case "subdivide":
                geometry = subdivide(
                  geometry,
                  Math.floor(number(action.iterations, 1, 1, 3)),
                );
                break;
              case "mirror":
                if (!["x", "y", "z"].includes(action.axis as string))
                  throw new Error("Axe de miroir invalide.");
                geometry = mirror(geometry, action.axis as "x" | "y" | "z");
                break;
              case "spin":
                if (!["x", "y", "z"].includes(action.axis as string))
                  throw new Error("Axe de Spin invalide.");
                geometry = spinGeometry(
                  geometry,
                  faces,
                  action.axis as "x" | "y" | "z",
                  vector(action.center, [3, 0, 0]),
                  Math.floor(number(action.segments, 48, 8, 128)),
                  (number(action.angle, 360, 1, 360) * Math.PI) / 180,
                );
                break;
              case "lathe":
                geometry = latheGeometry(
                  geometry,
                  Math.floor(number(action.segments, 48, 8, 128)),
                  (number(action.angle, 360, 1, 360) * Math.PI) / 180,
                );
                break;
              case "sweep":
                if (
                  !Array.isArray(action.path) ||
                  action.path.length < 2 ||
                  action.path.length > 64
                )
                  throw new Error("Chemin IA invalide.");
                geometry = sweepGeometry(
                  geometry,
                  action.path.map((p) => vector(p, [0, 0, 0])),
                  Math.floor(number(action.segments, 48, 8, 128)),
                );
                break;
              default:
                throw new Error("Opération de maillage IA non autorisée.");
            }
            return { ...n, geometry };
          },
          true,
        );
        break;
      case "render": {
        if (action.background) {
          render.background = color(action.background);
          render.backgroundMode = "color";
        }
        if (action.backgroundEnd)
          render.backgroundEnd = color(action.backgroundEnd);
        if (action.backgroundMode !== undefined) {
          if (
            !["color", "gradient", "environment"].includes(
              action.backgroundMode as string,
            )
          )
            throw new Error("Type de fond IA invalide.");
          render.backgroundMode = action.backgroundMode as
            "color" | "gradient" | "environment";
        }
        if (action.environmentRotation !== undefined)
          render.environmentRotation = number(
            action.environmentRotation,
            0,
            -180,
            180,
          );
        if (action.environmentIntensity !== undefined)
          render.environmentIntensity = number(
            action.environmentIntensity,
            1,
            0,
            3,
          );
        if (action.grid !== undefined) render.grid = bool(action.grid, true);
        if (action.axes !== undefined) render.axes = bool(action.axes, true);
        if (action.exposure !== undefined)
          render.exposure = number(action.exposure, 1, 0.1, 5);
        if (action.environment) {
          if (
            !["studio", "sunset", "night"].includes(
              action.environment as string,
            )
          )
            throw new Error("Environnement invalide.");
          render.environment = action.environment as
            "studio" | "sunset" | "night";
        }
        if (action.shadows !== undefined)
          render.shadows = bool(action.shadows, true);
        if (action.wireframe !== undefined)
          render.wireframe = bool(action.wireframe, false);
        break;
      }
      default:
        throw new Error(
          `Action non autorisée : ${action.type}. Aucune modification n’a été appliquée.`,
        );
    }
    if (nodes.length > 3000)
      throw new Error("Le plan IA dépasserait la limite de 3 000 objets.");
  }
  return {
    document: plan.actions.length ? { ...document, nodes, render } : document,
    selection: created.length
      ? created.filter((id) => nodes.some((n) => n.id === id))
      : selection.filter((id) => nodes.some((n) => n.id === id)),
  };
}
