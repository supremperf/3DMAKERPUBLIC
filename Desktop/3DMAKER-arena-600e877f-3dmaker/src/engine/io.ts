import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { MeshoptDecoder } from "meshoptimizer";
import { zipSync, strToU8 } from "fflate";
import {
  serializeGeometry,
  deserializeGeometry,
  transformMatrix,
} from "./geometry";
import {
  materialFromData,
  serializeMaterial,
  waitForMaterialTextures,
  exportableMaterial,
} from "./materials";
import { exportFBX } from "./fbxExporter";
import {
  DEFAULT_MATERIAL,
  DEFAULT_RENDER,
  identityTransform,
  uid,
  type SceneNode,
  type SceneDocument,
  type Vec3,
} from "../types";
import {
  base64ToBytes,
  bridge,
  bytesToBase64,
  chooseFiles,
  saveBytes,
} from "../services/bridge";
import { useEditor } from "../store/editor";

export async function importModel(
  buffer: ArrayBuffer,
  name: string,
  assets: File[] = [],
  normalize = false,
): Promise<SceneNode[]> {
  const extension = name.split(".").pop()?.toLowerCase();
  const urls: string[] = [];
  const fileMap = new Map(assets.map((f) => [f.name.toLowerCase(), f]));
  const manager = new THREE.LoadingManager();
  let assetsStarted = false;
  let assetsError = "";
  let finishAssets!: () => void;
  const assetsLoaded = new Promise<void>((resolve) => {
    finishAssets = resolve;
  });
  manager.onStart = () => {
    assetsStarted = true;
  };
  manager.onLoad = () => finishAssets();
  manager.onError = (url) => {
    assetsError = `La ressource ${decodeURIComponent(url.split("/").pop()!.slice(0, 100))} ne peut pas être chargée. Importez le modèle et ses textures ensemble.`;
  };
  manager.setURLModifier((url) => {
    if (
      /^(data:|blob:)/.test(url) ||
      url.startsWith(new URL("draco/", document.baseURI).href)
    )
      return url;
    const filename = decodeURIComponent(
      url.split(/[\\/]/).pop()!.split("?")[0],
    ).toLowerCase();
    const file = fileMap.get(filename);
    if (file) {
      const local = URL.createObjectURL(file);
      urls.push(local);
      return local;
    }
    if (!/^https?:/.test(url))
      throw new Error(
        `Ressource manquante : ${filename}. Sélectionnez le modèle et ses textures / buffers ensemble.`,
      );
    return url;
  });
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath(new URL("draco/", document.baseURI).href);
  let root: THREE.Object3D;
  try {
    if (extension === "obj") {
      const loader = new OBJLoader(manager);
      const mtl = assets.find((f) => f.name.toLowerCase().endsWith(".mtl"));
      if (mtl) {
        const materials = new MTLLoader(manager).parse(await mtl.text(), "");
        materials.preload();
        loader.setMaterials(materials);
      }
      root = loader.parse(new TextDecoder().decode(buffer));
    } else if (extension === "fbx")
      root = new FBXLoader(manager).parse(buffer, "");
    else if (extension === "glb" || extension === "gltf") {
      const loader = new GLTFLoader(manager);
      loader.setDRACOLoader(draco);
      loader.setMeshoptDecoder(MeshoptDecoder);
      root = (await loader.parseAsync(buffer, "")).scene;
    } else if (extension === "stl") {
      const g = new STLLoader(manager).parse(buffer);
      root = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    } else
      throw new Error(
        "Format non pris en charge. Importez un OBJ, FBX, GLTF, GLB ou STL.",
      );
    if (assetsStarted) await assetsLoaded;
    if (assetsError) throw new Error(assetsError);
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const factor = normalize ? 3 / Math.max(size.x, size.y, size.z, 0.0001) : 1;
    const normalization = new THREE.Matrix4()
      .makeTranslation(-center.x, -bounds.min.y, -center.z)
      .premultiply(new THREE.Matrix4().makeScale(factor, factor, factor));
    const nodes: SceneNode[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry?.getAttribute("position")) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const groups =
        materials.length > 1 && mesh.geometry.groups.length
          ? mesh.geometry.groups
          : [
              {
                start: 0,
                count:
                  mesh.geometry.index?.count ||
                  mesh.geometry.getAttribute("position").count,
                materialIndex: 0,
              },
            ];
      for (const [index, group] of groups.entries()) {
        let geometry = mesh.geometry.clone();
        if (materials.length > 1) {
          const ids = geometry.index
            ? Array.from(geometry.index.array).slice(
                group.start,
                group.start + group.count,
              )
            : Array.from({ length: group.count }, (_, i) => group.start + i);
          geometry.setIndex(ids);
        }
        geometry.clearGroups();
        geometry.applyMatrix4(mesh.matrixWorld);
        if (normalize) geometry.applyMatrix4(normalization);
        const nodeName = (mesh.name || name.replace(/\.[^.]+$/, "")).slice(
          0,
          100,
        );
        nodes.push({
          id: uid(),
          name: groups.length > 1 ? `${nodeName} · ${index + 1}` : nodeName,
          kind: "mesh",
          visible: true,
          locked: false,
          transform: identityTransform(),
          geometry: serializeGeometry(geometry),
          material: materials[group.materialIndex || 0]
            ? serializeMaterial(materials[group.materialIndex || 0])
            : structuredClone(DEFAULT_MATERIAL),
        });
        geometry.dispose();
      }
    });
    if (!nodes.length)
      throw new Error("Ce fichier ne contient aucun maillage 3D.");
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        ).forEach((m) => m.dispose());
      }
    });
    return nodes;
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
    draco.dispose();
  }
}
export async function embedGLTFAssets(
  base64: string,
  sourceUrl: string,
): Promise<{ base64: string; name: string }> {
  const bytes = base64ToBytes(base64);
  if (bytes.length < 4)
    throw new Error("Le fichier de modèle reçu est vide ou corrompu.");
  if (new DataView(bytes.buffer).getUint32(0, true) === 0x46546c67)
    return { base64, name: "modele.glb" };
  let json: {
    asset?: unknown;
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(
      "Le fournisseur n’a pas retourné un fichier GLB ou GLTF valide.",
    );
  }
  if (!json.asset) throw new Error("Le fichier GLTF reçu est invalide.");
  await Promise.all(
    [...(json.buffers || []), ...(json.images || [])].map(async (asset) => {
      if (asset.uri && !asset.uri.startsWith("data:")) {
        const result = await bridge.fetchAsset(
          new URL(asset.uri, sourceUrl).href,
        );
        asset.uri = `data:${result.mime};base64,${result.base64}`;
      }
    }),
  );
  return {
    base64: bytesToBase64(new TextEncoder().encode(JSON.stringify(json))),
    name: "modele.gltf",
  };
}
export async function handleImport(files?: File[]) {
  const state = useEditor.getState();
  try {
    let selected = files;
    if (!selected)
      selected = await chooseFiles(
        ".obj,.fbx,.gltf,.glb,.stl,.3dmaker,.mtl,.bin,.png,.jpg,.jpeg",
        true,
      );
    if (!selected.length) return;
    useEditor.setState({ busy: true, busyMessage: "Import du modèle…" });
    const project = selected.find((f) => f.name.endsWith(".3dmaker"));
    if (project) {
      state.loadDocument(validateDocument(JSON.parse(await project.text())));
      state.notify("Projet ouvert.", "success");
      return;
    }
    const models = selected.filter((f) =>
      /\.(obj|fbx|gltf|glb|stl)$/i.test(f.name),
    );
    if (!models.length)
      throw new Error(
        "Ajoutez un fichier de modèle 3D avec ses textures éventuelles.",
      );
    const nodes: SceneNode[] = [];
    for (const file of models) {
      if (file.size > 180 * 1024 * 1024)
        throw new Error("Le fichier dépasse 180 Mo.");
      nodes.push(
        ...(await importModel(await file.arrayBuffer(), file.name, selected)),
      );
    }
    state.addNodes(nodes, "Importer les modèles");
    state.focus("focus");
    state.notify(
      `${nodes.length} objet${nodes.length > 1 ? "s" : ""} importé${nodes.length > 1 ? "s" : ""}.`,
      "success",
    );
  } catch (error) {
    state.notify((error as Error).message, "error");
  } finally {
    useEditor.setState({ busy: false });
  }
}
export async function saveProject() {
  const state = useEditor.getState();
  try {
    if (
      await saveBytes(
        `${state.document.name.replace(/[^\p{L}\p{N} _-]/gu, "") || "scene"}.3dmaker`,
        JSON.stringify(state.document),
      )
    ) {
      state.markSaved();
      state.notify("Projet enregistré.", "success");
    }
  } catch (e) {
    state.notify((e as Error).message, "error");
  }
}
export function validateDocument(value: unknown): SceneDocument {
  const d = value as SceneDocument;
  const fail = (message = "Un objet du projet est invalide."): never => {
    throw new Error(message);
  };
  const finite = (v: unknown, min = -1e12, max = 1e12): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const vector = (v: unknown): v is Vec3 =>
    Array.isArray(v) && v.length === 3 && v.every((n) => finite(n));
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const color = (v: unknown) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  if (
    !d ||
    d.version !== 1 ||
    typeof d.name !== "string" ||
    d.name.length > 120 ||
    !Array.isArray(d.nodes) ||
    d.nodes.length > 3000 ||
    !object(d.render)
  )
    fail("Ce fichier n’est pas un projet 3DMAKER valide.");
  const ids = new Set<string>();
  const nodes = d.nodes.map((n) => {
    if (
      !n ||
      typeof n.id !== "string" ||
      !n.id ||
      ids.has(n.id) ||
      typeof n.name !== "string" ||
      n.name.length > 120 ||
      !["mesh", "light", "camera"].includes(n.kind) ||
      typeof n.visible !== "boolean" ||
      typeof n.locked !== "boolean" ||
      !vector(n.transform?.position) ||
      !vector(n.transform?.rotation) ||
      !vector(n.transform?.scale) ||
      n.transform.scale.some((v) => Math.abs(v) < 1e-8) ||
      !object(n.material) ||
      (n.material.textures !== undefined && !object(n.material.textures))
    )
      fail();
    ids.add(n.id);
    if (n.geometry) {
      const g = n.geometry;
      const vertexCount = g.positions?.length / 3;
      if (
        !Array.isArray(g.positions) ||
        g.positions.length < 9 ||
        g.positions.length > 15000000 ||
        g.positions.length % 3 ||
        !g.positions.every((n) => finite(n)) ||
        (g.indices
          ? !Array.isArray(g.indices) ||
            !g.indices.length ||
            !g.indices.every(
              (i) => Number.isInteger(i) && i >= 0 && i < vertexCount,
            ) ||
            g.indices.length % 3
          : vertexCount % 3)
      )
        fail("Le projet contient un maillage corrompu.");
      if (
        g.normals &&
        (!Array.isArray(g.normals) ||
          g.normals.length !== g.positions.length ||
          !g.normals.every((n) => finite(n)))
      )
        fail("Les normales du maillage sont corrompues.");
      if (
        g.uvs &&
        (!Array.isArray(g.uvs) ||
          g.uvs.length !== vertexCount * 2 ||
          !g.uvs.every((n) => finite(n)))
      )
        fail("Les coordonnées UV du maillage sont corrompues.");
      if (
        g.groups &&
        (!Array.isArray(g.groups) ||
          g.groups.some(
            (group) =>
              !group ||
              !Number.isInteger(group.start) ||
              group.start < 0 ||
              !Number.isInteger(group.count) ||
              group.count < 0 ||
              group.start + group.count > (g.indices?.length || vertexCount) ||
              !Number.isInteger(group.materialIndex) ||
              group.materialIndex < 0,
          ))
      )
        fail("Les groupes du maillage sont corrompus.");
    }
    if (
      (n.kind === "mesh" && !n.geometry) ||
      (n.kind === "light" && !n.light) ||
      (n.kind === "camera" && !n.camera)
    )
      fail("Les données d’un objet sont manquantes.");
    const material = {
      ...structuredClone(DEFAULT_MATERIAL),
      ...n.material,
      textures: { ...n.material.textures },
    };
    if (
      !color(material.color) ||
      !color(material.emissive) ||
      !finite(material.roughness, 0, 1) ||
      !finite(material.metalness, 0, 1) ||
      !finite(material.opacity, 0, 1) ||
      ["transmission", "clearcoat", "clearcoatRoughness", "anisotropy"].some(
        (key) => !finite(material[key as "transmission"], 0, 1),
      ) ||
      !finite(material.ior, 1, 2.333) ||
      !finite(material.thickness, 0, 10000) ||
      !finite(material.emissiveIntensity, 0, 10000) ||
      !finite(material.normalScale, -10, 10) ||
      !finite(material.aoIntensity, 0, 10) ||
      typeof material.flatShading !== "boolean" ||
      typeof material.doubleSided !== "boolean"
    )
      fail("Un matériau du projet est invalide.");
    for (const [slot, url] of Object.entries(material.textures))
      if (
        ![
          "map",
          "normalMap",
          "roughnessMap",
          "metalnessMap",
          "emissiveMap",
          "aoMap",
        ].includes(slot) ||
        typeof url !== "string" ||
        !/^data:image\/(png|jpeg|webp|vnd\.radiance);base64,/.test(url)
      )
        fail("Une texture du projet est invalide.");
    if (
      n.light &&
      (!["ambient", "directional", "point", "spot"].includes(n.light.type) ||
        !color(n.light.color) ||
        !finite(n.light.intensity, 0, 10000) ||
        !finite(n.light.distance, 0, 100000) ||
        !finite(n.light.angle, 1, 89) ||
        !finite(n.light.penumbra, 0, 1) ||
        !vector(n.light.target) ||
        typeof n.light.castShadow !== "boolean")
    )
      fail("Une lumière du projet est invalide.");
    if (
      n.camera &&
      (!finite(n.camera.fov, 1, 179) ||
        !finite(n.camera.near, 0.000001, 100000) ||
        !finite(n.camera.far, n.camera.near + 0.000001, 1000000) ||
        !vector(n.camera.target))
    )
      fail("Une caméra du projet est invalide.");
    return { ...n, material };
  });
  const render = {
    ...DEFAULT_RENDER,
    ...d.render,
    backgroundMode: d.render.backgroundMode ?? "color",
  };
  if (
    !color(render.background) ||
    !color(render.backgroundEnd) ||
    !["color", "gradient", "image", "environment"].includes(
      render.backgroundMode,
    ) ||
    !finite(render.environmentRotation, -180, 180) ||
    (render.backgroundImage !== undefined &&
      (typeof render.backgroundImage !== "string" ||
        render.backgroundImage.length > 12 * 1024 * 1024 ||
        !/^data:image\/(png|jpeg|webp);base64,/.test(
          render.backgroundImage,
        ))) ||
    !color(render.fogColor) ||
    !finite(render.exposure, 0.01, 10) ||
    !finite(render.gamma, 0.1, 5) ||
    !finite(render.fogDensity, 0, 2) ||
    !finite(render.environmentIntensity, 0, 100) ||
    !["aces", "filmic", "linear"].includes(render.toneMapping) ||
    ![512, 1024, 2048, 4096].includes(render.shadowQuality) ||
    !["studio", "sunset", "night", "custom"].includes(render.environment) ||
    ["shadows", "grid", "axes", "antialias", "wireframe", "fog"].some(
      (key) => typeof render[key as keyof typeof render] !== "boolean",
    ) ||
    (render.hdri &&
      (typeof render.hdri !== "string" ||
        !render.hdri.startsWith("data:image/vnd.radiance;base64,")))
  )
    fail("Les paramètres de rendu du projet sont invalides.");
  return { version: 1, name: d.name, nodes, render };
}
export function sceneForExport(nodes: SceneNode[]): THREE.Scene {
  const scene = new THREE.Scene();
  for (const node of nodes) {
    if (!node.geometry) continue;
    const material = materialFromData(node.material);
    material.name = `materiau_${node.id.replace(/-/g, "").slice(0, 8)}`;
    const geometry = deserializeGeometry(node.geometry);
    geometry.clearGroups();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = node.name;
    mesh.applyMatrix4(transformMatrix(node.transform));
    scene.add(mesh);
  }
  scene.updateMatrixWorld(true);
  return scene;
}
export async function exportModel(
  format: "glb" | "gltf" | "obj" | "stl" | "fbx",
  selectionOnly: boolean,
) {
  const state = useEditor.getState();
  const sources = state.document.nodes.filter(
    (n) =>
      n.geometry &&
      (selectionOnly ? state.selection.includes(n.id) : n.visible),
  );
  const nodes = await Promise.all(
    sources.map(async (node) => ({
      ...node,
      material: await exportableMaterial(node.material),
    })),
  );
  if (!nodes.length) throw new Error("Aucun maillage à exporter.");
  const scene = sceneForExport(nodes);
  const name =
    (state.document.name === "Sans titre"
      ? "3dmaker-scene"
      : state.document.name
    )
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .replace(/\s+/g, "_") || "3dmaker-scene";
  let saved = false;
  try {
    if (format === "glb" || format === "gltf") {
      await Promise.all(
        scene.children.map((child) =>
          waitForMaterialTextures(
            (child as THREE.Mesh).material as THREE.MeshStandardMaterial,
          ),
        ),
      );
      const output = await new GLTFExporter().parseAsync(scene, {
        binary: format === "glb",
        onlyVisible: true,
      });
      saved = await saveBytes(
        `${name}.${format}`,
        output instanceof ArrayBuffer ? output : JSON.stringify(output),
      );
    } else if (format === "stl") {
      const output = new STLExporter().parse(scene, { binary: true });
      saved = await saveBytes(`${name}.stl`, output.buffer as ArrayBuffer);
    } else if (format === "fbx")
      saved = await saveBytes(`${name}.fbx`, exportFBX(nodes));
    else {
      const bundle: Record<string, Uint8Array> = {};
      let mtl = "# Matériaux 3DMAKER\n";
      for (const node of nodes) {
        const key = `materiau_${node.id.replace(/-/g, "").slice(0, 8)}`;
        const color = new THREE.Color(
          node.material.color,
        ).convertLinearToSRGB();
        const emissive = new THREE.Color(
          node.material.emissive,
        ).convertLinearToSRGB();
        mtl += `newmtl ${key}\nKd ${color.r} ${color.g} ${color.b}\nKe ${emissive.r} ${emissive.g} ${emissive.b}\nNs ${(1 - node.material.roughness) * 1000}\nd ${node.material.opacity}\nPr ${node.material.roughness}\nPm ${node.material.metalness}\n`;
        for (const [slot, data] of Object.entries(node.material.textures))
          if (data?.startsWith("data:")) {
            const match = data.match(/^data:image\/(\w+);base64,(.*)$/s);
            if (!match) continue;
            const filename = `${key}_${slot}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
            bundle[`textures/${filename}`] = base64ToBytes(match[2]);
            const mapKey: Record<string, string> = {
              map: "map_Kd",
              normalMap: "map_Bump",
              roughnessMap: "map_Pr",
              metalnessMap: "map_Pm",
              emissiveMap: "map_Ke",
              aoMap: "map_Ka",
            };
            mtl += `${mapKey[slot]} textures/${filename}\n`;
          }
        mtl += "\n";
      }
      const obj = `mtllib ${name}.mtl\n${new OBJExporter().parse(scene)}`;
      bundle[`${name}.obj`] = strToU8(obj);
      bundle[`${name}.mtl`] = strToU8(mtl);
      if (window.desktop)
        saved = await window.desktop.saveBundle(
          `${name}.obj`,
          Object.entries(bundle).map(([path, bytes]) => ({
            path,
            base64: bytesToBase64(bytes),
          })),
        );
      else saved = await saveBytes(`${name}-obj.zip`, zipSync(bundle));
    }
    if (saved) state.notify("Export terminé.", "success");
    return saved;
  } finally {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    });
  }
}
