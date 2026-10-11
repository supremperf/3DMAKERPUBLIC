import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer";
import {
  Brush,
  Evaluator,
  HalfEdgeMap,
  ADDITION,
  SUBTRACTION,
  INTERSECTION,
} from "three-bvh-csg";
import {
  DEFAULT_MATERIAL,
  identityTransform,
  primitiveNames,
  uid,
  type GeometryData,
  type Primitive,
  type SceneNode,
  type Transform,
  type Vec3,
} from "../types";

export function serializeGeometry(
  geometry: THREE.BufferGeometry,
): GeometryData {
  const p = geometry.getAttribute("position");
  if (!p || p.count < 3)
    throw new Error("Le maillage ne contient pas de surface exploitable.");
  return {
    positions: Array.from(p.array),
    indices: geometry.index ? Array.from(geometry.index.array) : undefined,
    normals: geometry.getAttribute("normal")
      ? Array.from(geometry.getAttribute("normal").array)
      : undefined,
    uvs: geometry.getAttribute("uv")
      ? Array.from(geometry.getAttribute("uv").array)
      : undefined,
    groups: geometry.groups.map((g) => ({
      start: g.start,
      count: g.count,
      materialIndex: g.materialIndex || 0,
    })),
  };
}
export function deserializeGeometry(data: GeometryData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(data.positions, 3),
  );
  if (data.indices) g.setIndex(data.indices);
  if (data.normals?.length === data.positions.length)
    g.setAttribute("normal", new THREE.Float32BufferAttribute(data.normals, 3));
  else g.computeVertexNormals();
  if (data.uvs?.length === (data.positions.length / 3) * 2)
    g.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs, 2));
  else generateUVs(g);
  data.groups?.forEach((group) =>
    g.addGroup(group.start, group.count, group.materialIndex),
  );
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
/** Conserve exactement l’effet global, y compris le cisaillement induit par une échelle non uniforme. */
export function transformNodeWorld(
  node: SceneNode,
  delta: THREE.Matrix4,
): SceneNode {
  const matrix = delta.clone().multiply(transformMatrix(node.transform)),
    position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  for (const axis of ["x", "y", "z"] as const)
    if (Math.abs(scale[axis]) < 0.0001)
      scale[axis] = scale[axis] < 0 ? -0.0001 : 0.0001;
  const euler = new THREE.Euler().setFromQuaternion(rotation),
    transform: Transform = {
      position: position.toArray() as Vec3,
      rotation: [euler.x, euler.y, euler.z],
      scale: scale.toArray() as Vec3,
    },
    composed = transformMatrix(transform);
  let geometry = node.geometry;
  if (
    geometry &&
    matrix.elements.some(
      (value, i) => Math.abs(value - composed.elements[i]) > 1e-7,
    )
  ) {
    const mesh = deserializeGeometry(geometry);
    mesh.applyMatrix4(composed.clone().invert().multiply(matrix));
    geometry = serializeGeometry(mesh);
    mesh.dispose();
  }
  const target = (point: Vec3) =>
    new THREE.Vector3(...point).applyMatrix4(delta).toArray() as Vec3;
  return {
    ...node,
    geometry,
    transform,
    ...(node.light
      ? { light: { ...node.light, target: target(node.light.target) } }
      : {}),
    ...(node.camera
      ? { camera: { ...node.camera, target: target(node.camera.target) } }
      : {}),
  };
}
export function generateUVs(g: THREE.BufferGeometry) {
  const p = g.getAttribute("position");
  const values = [];
  for (let i = 0; i < p.count; i++)
    values.push(p.getX(i) * 0.5 + 0.5, p.getZ(i) * 0.5 + p.getY(i) * 0.5 + 0.5);
  g.setAttribute("uv", new THREE.Float32BufferAttribute(values, 2));
}
export function primitiveGeometry(type: Primitive): THREE.BufferGeometry {
  switch (type) {
    case "cube":
      return new THREE.BoxGeometry(2, 2, 2);
    case "sphere":
      return new THREE.SphereGeometry(1, 48, 32);
    case "cylinder":
      return new THREE.CylinderGeometry(1, 1, 2, 48);
    case "cone":
      return new THREE.ConeGeometry(1, 2, 48);
    case "torus":
      return new THREE.TorusGeometry(0.85, 0.28, 24, 64);
    case "plane": {
      const g = new THREE.PlaneGeometry(3, 3, 4, 4);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case "tube":
      return new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-1.5, 0, 0),
          new THREE.Vector3(-0.7, 0.6, 0),
          new THREE.Vector3(0.7, 0.2, 0),
          new THREE.Vector3(1.5, 0.8, 0),
        ]),
        48,
        0.25,
        16,
        false,
      );
    case "box": {
      const ring = (radius: number, y: number) =>
        [
          [-radius, y, -radius],
          [radius, y, -radius],
          [radius, y, radius],
          [-radius, y, radius],
        ].map((p) => new THREE.Vector3(...(p as Vec3)));
      const vertices = [
        ...ring(1, -1.1),
        ...ring(1, 0.9),
        ...ring(0.8, -0.9),
        ...ring(0.8, 0.9),
      ];
      const faces: number[][] = [];
      const quad = (a: number, b: number, c: number, d: number) => {
        faces.push([a, b, c], [a, c, d]);
      };
      quad(0, 1, 2, 3);
      quad(8, 11, 10, 9);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        quad(i, i + 4, j + 4, j);
        quad(i + 8, j + 8, j + 12, i + 12);
        quad(i + 4, i + 12, j + 12, j + 4);
      }
      const indexed = deserializeGeometry(fromTopology(vertices, faces));
      const geometry = indexed.toNonIndexed();
      indexed.dispose();
      geometry.computeVertexNormals();
      return geometry;
    }
  }
}
export function createPrimitive(
  type: Primitive,
  name?: string,
  position?: Vec3,
): SceneNode {
  const g = primitiveGeometry(type);
  g.computeBoundingBox();
  const placement = position || ([0, -g.boundingBox!.min.y, 0] as Vec3);
  const data = serializeGeometry(g);
  g.dispose();
  return {
    id: uid(),
    name: name || primitiveNames[type],
    kind: "mesh",
    visible: true,
    locked: false,
    geometry: data,
    material: structuredClone(DEFAULT_MATERIAL),
    transform: { ...identityTransform(), position: placement },
  };
}
export function createLight(
  type: NonNullable<SceneNode["light"]>["type"],
): SceneNode {
  const names = {
    ambient: "Lumière ambiante",
    directional: "Lumière directionnelle",
    point: "Lumière ponctuelle",
    spot: "Projecteur",
  };
  return {
    id: uid(),
    name: names[type],
    kind: "light",
    visible: true,
    locked: false,
    material: structuredClone(DEFAULT_MATERIAL),
    transform: { ...identityTransform(), position: [3, 5, 3] },
    light: {
      type,
      color: "#fff4e4",
      intensity: type === "ambient" ? 0.5 : type === "directional" ? 3 : 40,
      distance: 20,
      angle: 40,
      penumbra: 0.35,
      castShadow: true,
      target: [0, 0, 0],
    },
  };
}
export function createCamera(): SceneNode {
  return {
    id: uid(),
    name: "Caméra",
    kind: "camera",
    visible: true,
    locked: false,
    material: structuredClone(DEFAULT_MATERIAL),
    transform: { ...identityTransform(), position: [7, 5, 8] },
    camera: { fov: 45, near: 0.01, far: 1000, target: [0, 0, 0] },
  };
}
export function createInitialNodes(): SceneNode[] {
  const cube = createPrimitive("cube", "Cube");
  const rounded = new RoundedBoxGeometry(2.2, 2.2, 2.2, 5, 0.1);
  cube.geometry = serializeGeometry(rounded);
  rounded.dispose();
  cube.transform.position = [0, 1.15, 0];
  cube.material.color = "#dbe4ce";
  cube.material.roughness = 0.28;
  const torus = createPrimitive("torus", "Tore");
  torus.transform.position = [-2.7, 0.35, 0.3];
  torus.transform.rotation = [Math.PI / 2, 0, 0];
  torus.material = {
    ...torus.material,
    color: "#aec779",
    metalness: 0.45,
    roughness: 0.25,
  };
  const sphere = createPrimitive("sphere", "Sphère");
  sphere.transform.position = [2.35, 0.65, -0.1];
  sphere.transform.scale = [0.65, 0.65, 0.65];
  sphere.material.color = "#959aaa";
  sphere.material.metalness = 0.6;
  sphere.material.roughness = 0.22;
  const light = createLight("directional");
  light.name = "Lumière principale";
  light.transform.position = [4, 8, 5];
  return [cube, torus, sphere, light];
}
export function transformMatrix(t: Transform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...t.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation)),
    new THREE.Vector3(...t.scale),
  );
}
export function triangleCount(g: GeometryData): number {
  return Math.floor((g.indices?.length ?? g.positions.length / 3) / 3);
}
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
export interface Topology {
  vertices: THREE.Vector3[];
  faces: [number, number, number][];
  sourceMap: number[];
  edges: Map<string, { a: number; b: number; faces: number[] }>;
}
export function topology(data: GeometryData): Topology {
  const vertices: THREE.Vector3[] = [];
  const sourceMap: number[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < data.positions.length; i += 3) {
    const v = new THREE.Vector3(
      data.positions[i],
      data.positions[i + 1],
      data.positions[i + 2],
    );
    const key = [v.x, v.y, v.z].map((n) => Math.round(n * 1e6)).join(",");
    let id = seen.get(key);
    if (id === undefined) {
      id = vertices.length;
      seen.set(key, id);
      vertices.push(v);
    }
    sourceMap.push(id);
  }
  const indices =
    data.indices ||
    Array.from({ length: data.positions.length / 3 }, (_, i) => i);
  const faces: Topology["faces"] = [];
  const edges: Topology["edges"] = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const f = indices.slice(i, i + 3).map((id) => sourceMap[id]) as [
      number,
      number,
      number,
    ];
    const fi = faces.length;
    faces.push(f);
    for (const [a, b] of [
      [f[0], f[1]],
      [f[1], f[2]],
      [f[2], f[0]],
    ]) {
      const key = edgeKey(a, b);
      const e = edges.get(key) || { a, b, faces: [] };
      e.faces.push(fi);
      edges.set(key, e);
    }
  }
  return { vertices, faces, edges, sourceMap };
}
export function fromTopology(
  vertices: THREE.Vector3[],
  faces: number[][],
): GeometryData {
  const positions = vertices.flatMap((v) => [v.x, v.y, v.z]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(faces.flat());
  g.computeVertexNormals();
  generateUVs(g);
  const result = serializeGeometry(g);
  g.dispose();
  return result;
}
export function transformComponents(
  data: GeometryData,
  mode: "vertex" | "edge" | "face",
  selected: number[],
  delta: THREE.Matrix4,
): GeometryData {
  const t = topology(data);
  const vertexIds = new Set<number>();
  const edges = [...t.edges.values()];
  for (const id of selected) {
    if (mode === "vertex") vertexIds.add(id);
    if (mode === "edge" && edges[id]) {
      vertexIds.add(edges[id].a);
      vertexIds.add(edges[id].b);
    }
    if (mode === "face" && t.faces[id])
      t.faces[id].forEach((v) => vertexIds.add(v));
  }
  const positions = [...data.positions];
  t.sourceMap.forEach((id, index) => {
    if (vertexIds.has(id)) {
      const v = new THREE.Vector3(
        ...(positions.slice(index * 3, index * 3 + 3) as Vec3),
      ).applyMatrix4(delta);
      positions.splice(index * 3, 3, v.x, v.y, v.z);
    }
  });
  const g = deserializeGeometry({ ...data, positions, normals: undefined });
  const result = serializeGeometry(g);
  g.dispose();
  return result;
}
export function extrude(
  data: GeometryData,
  selectedFaces: number[],
  distance: number,
): GeometryData {
  const t = topology(data);
  const selected = new Set(
    selectedFaces.length ? selectedFaces : t.faces.map((_, i) => i),
  );
  const normals = new Map<number, THREE.Vector3>();
  for (const i of selected) {
    const f = t.faces[i];
    if (!f) continue;
    const n = t.vertices[f[1]]
      .clone()
      .sub(t.vertices[f[0]])
      .cross(t.vertices[f[2]].clone().sub(t.vertices[f[0]]))
      .normalize();
    f.forEach((v) =>
      normals.set(v, (normals.get(v) || new THREE.Vector3()).add(n)),
    );
  }
  const topIds = new Map<number, number>();
  const vertices = t.vertices.map((v) => v.clone());
  for (const [id, n] of normals) {
    topIds.set(id, vertices.length);
    vertices.push(
      t.vertices[id].clone().addScaledVector(n.normalize(), distance),
    );
  }
  const faces: number[][] = t.faces.filter((_, i) => !selected.has(i));
  for (const i of selected)
    if (t.faces[i]) faces.push(t.faces[i].map((v) => topIds.get(v)!));
  for (const e of t.edges.values()) {
    const owners = e.faces.filter((f) => selected.has(f));
    if (
      owners.length !== 1 ||
      (e.faces.length > 1 && owners.length === e.faces.length)
    )
      continue;
    const f = t.faces[owners[0]];
    let a = e.a,
      b = e.b;
    if (!f.some((v, i) => v === a && f[(i + 1) % 3] === b)) [a, b] = [b, a];
    const aa = topIds.get(a)!,
      bb = topIds.get(b)!;
    faces.push([a, b, bb], [a, bb, aa]);
  }
  return fromTopology(vertices, faces);
}
export function subdivide(
  data: GeometryData,
  iterations = 1,
  smooth = true,
): GeometryData {
  let result = data;
  for (let iteration = 0; iteration < Math.min(3, iterations); iteration++) {
    const t = topology(result);
    if (t.faces.length > 250000)
      throw new Error(
        "Subdivision limitée à un million de triangles pour préserver la mémoire.",
      );
    const neighbors = t.vertices.map(() => new Set<number>());
    const boundary = t.vertices.map(() => new Set<number>());
    for (const e of t.edges.values()) {
      neighbors[e.a].add(e.b);
      neighbors[e.b].add(e.a);
      if (e.faces.length === 1) {
        boundary[e.a].add(e.b);
        boundary[e.b].add(e.a);
      }
    }
    const vertices = t.vertices.map((v, i) => {
      if (!smooth) return v.clone();
      if (boundary[i].size === 2)
        return v
          .clone()
          .multiplyScalar(0.75)
          .addScaledVector(t.vertices[[...boundary[i]][0]], 0.125)
          .addScaledVector(t.vertices[[...boundary[i]][1]], 0.125);
      const n = neighbors[i].size;
      if (n < 3) return v.clone();
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      const p = v.clone().multiplyScalar(1 - n * beta);
      neighbors[i].forEach((id) => p.addScaledVector(t.vertices[id], beta));
      return p;
    });
    const mids = new Map<string, number>();
    for (const [key, e] of t.edges) {
      const p = t.vertices[e.a]
        .clone()
        .add(t.vertices[e.b])
        .multiplyScalar(smooth && e.faces.length === 2 ? 3 / 8 : 0.5);
      if (smooth && e.faces.length === 2)
        for (const fi of e.faces) {
          const opposite = t.faces[fi].find((v) => v !== e.a && v !== e.b)!;
          p.addScaledVector(t.vertices[opposite], 1 / 8);
        }
      mids.set(key, vertices.length);
      vertices.push(p);
    }
    const faces: number[][] = [];
    t.faces.forEach(([a, b, c]) => {
      const ab = mids.get(edgeKey(a, b))!,
        bc = mids.get(edgeKey(b, c))!,
        ca = mids.get(edgeKey(c, a))!;
      faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    });
    result = fromTopology(vertices, faces);
  }
  return result;
}
export async function decimate(
  data: GeometryData,
  ratio: number,
): Promise<GeometryData> {
  await MeshoptSimplifier.ready;
  const t = topology(data);
  const indices = new Uint32Array(t.faces.flat());
  const positions = new Float32Array(
    t.vertices.flatMap((v) => [v.x, v.y, v.z]),
  );
  const target = Math.max(
    12,
    Math.floor((indices.length * Math.max(0.01, Math.min(0.99, ratio))) / 3) *
      3,
  );
  const [simplified] = MeshoptSimplifier.simplify(
    indices,
    positions,
    3,
    target,
    0.1,
    ["LockBorder"],
  );
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(simplified, 1));
  g.computeVertexNormals();
  generateUVs(g);
  const result = serializeGeometry(g);
  g.dispose();
  return result;
}
export function mirror(
  data: GeometryData,
  axis: "x" | "y" | "z",
  combine = true,
): GeometryData {
  const original = deserializeGeometry(data);
  const mirrored = original.clone();
  const scale = new THREE.Vector3(1, 1, 1);
  scale[axis] = -1;
  mirrored.scale(scale.x, scale.y, scale.z);
  const idx = mirrored.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      idx.setX(i, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  } else {
    const pos = mirrored.getAttribute("position");
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      pos.setXYZ(i, c.x, c.y, c.z);
      pos.setXYZ(i + 2, a.x, a.y, a.z);
      const uv = mirrored.getAttribute("uv");
      if (uv) {
        const u = uv.getX(i),
          v = uv.getY(i);
        uv.setXY(i, uv.getX(i + 2), uv.getY(i + 2));
        uv.setXY(i + 2, u, v);
      }
    }
  }
  mirrored.computeVertexNormals();
  const merged = combine
    ? mergeGeometries([original.toNonIndexed(), mirrored.toNonIndexed()])!
    : mirrored;
  const result = serializeGeometry(merged);
  original.dispose();
  mirrored.dispose();
  if (merged !== mirrored) merged.dispose();
  return result;
}
export function mergeNodes(nodes: SceneNode[]): SceneNode {
  const geometries = nodes
    .filter((n) => n.geometry)
    .map((n) => {
      const g = deserializeGeometry(n.geometry!);
      g.applyMatrix4(transformMatrix(n.transform));
      const clean = g.toNonIndexed();
      g.dispose();
      clean.clearGroups();
      return clean;
    });
  if (geometries.length < 2)
    throw new Error("Sélectionnez au moins deux maillages à fusionner.");
  const merged = mergeGeometries(geometries)!;
  const center = new THREE.Box3()
    .setFromBufferAttribute(
      merged.getAttribute("position") as THREE.BufferAttribute,
    )
    .getCenter(new THREE.Vector3());
  merged.translate(-center.x, -center.y, -center.z);
  const result = {
    ...nodes[0],
    id: uid(),
    name: "Maillages fusionnés",
    transform: { ...identityTransform(), position: center.toArray() as Vec3 },
    geometry: serializeGeometry(merged),
  };
  geometries.forEach((g) => g.dispose());
  merged.dispose();
  return result;
}
function solidGeometry(data: GeometryData, name: string): THREE.BufferGeometry {
  const geometry = deserializeGeometry(data),
    position = geometry.getAttribute("position"),
    source =
      data.indices || Array.from({ length: position.count }, (_, i) => i),
    indices: number[] = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < source.length; i += 3) {
    a.fromBufferAttribute(position, source[i]);
    b.fromBufferAttribute(position, source[i + 1]).sub(a);
    c.fromBufferAttribute(position, source[i + 2]).sub(a);
    if (b.cross(c).lengthSq() > 1e-20)
      indices.push(source[i], source[i + 1], source[i + 2]);
  }
  geometry.setIndex(indices);
  geometry.clearGroups();
  const edges = new HalfEdgeMap() as HalfEdgeMap & {
    matchDisjointEdges: boolean;
    unmatchedEdges: number;
  };
  edges.matchDisjointEdges = true;
  edges.updateFrom(geometry);
  if (!indices.length || edges.unmatchedEdges) {
    geometry.dispose();
    throw new Error(
      `Les booléennes nécessitent des volumes fermés. « ${name} » présente des bords ouverts ou des faces incompatibles.`,
    );
  }
  return geometry;
}
export function booleanOperation(
  a: SceneNode,
  b: SceneNode,
  operation: "union" | "difference" | "intersection",
): SceneNode {
  if (!a.geometry || !b.geometry)
    throw new Error("Les booléennes nécessitent deux maillages.");
  let ga: THREE.BufferGeometry | undefined,
    gb: THREE.BufferGeometry | undefined,
    material: THREE.MeshStandardMaterial | undefined;
  try {
    ga = solidGeometry(a.geometry, a.name);
    gb = solidGeometry(b.geometry, b.name);
    material = new THREE.MeshStandardMaterial();
    const ba = new Brush(ga, material),
      bb = new Brush(gb, material);
    ba.applyMatrix4(transformMatrix(a.transform));
    bb.applyMatrix4(transformMatrix(b.transform));
    ba.updateMatrixWorld(true);
    bb.updateMatrixWorld(true);
    const evaluator = new Evaluator();
    evaluator.useGroups = false;
    evaluator.attributes = ["position", "normal", "uv"];
    const result = evaluator.evaluate(
      ba,
      bb,
      { union: ADDITION, difference: SUBTRACTION, intersection: INTERSECTION }[
        operation
      ],
    );
    if (!result.geometry.getAttribute("position")?.count)
      throw new Error(
        "Le résultat est vide. Pour une intersection, les objets doivent se chevaucher.",
      );
    result.updateMatrixWorld(true);
    const geometry = result.geometry.clone().applyMatrix4(result.matrixWorld);
    const center = new THREE.Box3()
      .setFromBufferAttribute(
        geometry.getAttribute("position") as THREE.BufferAttribute,
      )
      .getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    const node = {
      ...a,
      id: uid(),
      name: {
        union: "Union",
        difference: "Différence",
        intersection: "Intersection",
      }[operation],
      transform: { ...identityTransform(), position: center.toArray() as Vec3 },
      geometry: serializeGeometry(geometry),
    };
    geometry.dispose();
    result.geometry.dispose();
    return node;
  } finally {
    ga?.dispose();
    gb?.dispose();
    material?.dispose();
  }
}

/** Chanfrein de surface : fusion des faces coplanaires, retrait des contours, raccords d’arêtes et de sommets. */
export function bevel(data: GeometryData, width: number): GeometryData {
  if (width <= 0)
    throw new Error("La largeur du chanfrein doit être positive.");
  const t = topology(data);
  const normals = t.faces.map(([a, b, c]) =>
    t.vertices[b]
      .clone()
      .sub(t.vertices[a])
      .cross(t.vertices[c].clone().sub(t.vertices[a]))
      .normalize(),
  );
  const parents = t.faces.map((_, i) => i);
  const find = (x: number): number =>
    parents[x] === x ? x : (parents[x] = find(parents[x]));
  for (const e of t.edges.values())
    if (
      e.faces.length === 2 &&
      normals[e.faces[0]].dot(normals[e.faces[1]]) > 0.99999
    )
      parents[find(e.faces[1])] = find(e.faces[0]);
  const groups = new Map<number, number[]>();
  t.faces.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) || []), i]);
  });
  const vertices: THREE.Vector3[] = [];
  const faces: number[][] = [];
  const insetByVertex = new Map<number, number[]>();
  const insetEdges = new Map<
    string,
    { a: number; b: number; ia: number; ib: number }[]
  >();
  for (const faceIds of groups.values()) {
    const boundary: [number, number][] = [];
    const selected = new Set(faceIds);
    for (const fi of faceIds) {
      const f = t.faces[fi];
      for (let i = 0; i < 3; i++) {
        const a = f[i],
          b = f[(i + 1) % 3];
        const e = t.edges.get(edgeKey(a, b))!;
        if (e.faces.filter((id) => selected.has(id)).length === 1)
          boundary.push([a, b]);
      }
    }
    const remaining = [...boundary];
    const contours: { ids: number[]; points: THREE.Vector3[] }[] = [];
    while (remaining.length) {
      const first = remaining.shift()!;
      const loop = [first[0], first[1]];
      while (loop[loop.length - 1] !== loop[0]) {
        const index = remaining.findIndex(
          (e) => e[0] === loop[loop.length - 1],
        );
        if (index < 0) break;
        loop.push(remaining.splice(index, 1)[0][1]);
      }
      if (loop[loop.length - 1] !== loop[0] || loop.length < 4) continue;
      loop.pop();
      const normal = normals[faceIds[0]];
      const ids: number[] = [];
      const points: THREE.Vector3[] = [];
      loop.forEach((id, i) => {
        const current = t.vertices[id],
          previous = t.vertices[loop[(i + loop.length - 1) % loop.length]],
          next = t.vertices[loop[(i + 1) % loop.length]];
        const e1 = current.clone().sub(previous).normalize(),
          e2 = next.clone().sub(current).normalize();
        const inward1 = normal.clone().cross(e1),
          inward2 = normal.clone().cross(e2);
        const bisector = inward1.clone().add(inward2).normalize();
        const denom = Math.max(0.15, bisector.dot(inward1));
        const clearance = boundary
          .filter(([a, b]) => a !== id && b !== id)
          .reduce((minimum, [a, b]) => {
            const segment = t.vertices[b].clone().sub(t.vertices[a]);
            const nearest = t.vertices[a]
              .clone()
              .addScaledVector(
                segment,
                THREE.MathUtils.clamp(
                  current.clone().sub(t.vertices[a]).dot(segment) /
                    Math.max(segment.lengthSq(), 1e-20),
                  0,
                  1,
                ),
              );
            return Math.min(minimum, current.distanceTo(nearest));
          }, Infinity);
        const localWidth = Math.min(
          width,
          current.distanceTo(previous) * 0.25,
          current.distanceTo(next) * 0.25,
          clearance * 0.45,
        );
        const p = current.clone().addScaledVector(bisector, localWidth / denom);
        const vid = vertices.length;
        vertices.push(p);
        points.push(p);
        ids.push(vid);
        insetByVertex.set(id, [...(insetByVertex.get(id) || []), vid]);
      });
      contours.push({ points, ids });
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % loop.length];
        const key = edgeKey(a, b);
        insetEdges.set(key, [
          ...(insetEdges.get(key) || []),
          { a, b, ia: ids[i], ib: ids[(i + 1) % loop.length] },
        ]);
      });
    }
    triangulateContours(contours, normals[faceIds[0]]).forEach((f) =>
      faces.push(f),
    );
  }
  for (const entries of insetEdges.values()) {
    if (entries.length === 2) {
      const [a, b] = entries;
      const ba = b.a === a.a ? b.ia : b.ib,
        bb = b.b === a.b ? b.ib : b.ia;
      faces.push([a.ib, a.ia, ba], [a.ib, ba, bb]);
    } else if (entries.length === 1) {
      const e = entries[0];
      const a = vertices.length;
      vertices.push(t.vertices[e.a].clone(), t.vertices[e.b].clone());
      faces.push([e.ib, e.ia, a], [e.ib, a, a + 1]);
    }
  }
  for (const [original, ids] of insetByVertex)
    if (ids.length >= 3) {
      const center = ids
        .reduce((sum, id) => sum.add(vertices[id]), new THREE.Vector3())
        .divideScalar(ids.length);
      const n = t.vertices[original].clone().sub(center).normalize();
      const axis = vertices[ids[0]].clone().sub(center).normalize();
      const axis2 = n.clone().cross(axis);
      ids.sort(
        (a, b) =>
          Math.atan2(
            vertices[a].clone().sub(center).dot(axis2),
            vertices[a].clone().sub(center).dot(axis),
          ) -
          Math.atan2(
            vertices[b].clone().sub(center).dot(axis2),
            vertices[b].clone().sub(center).dot(axis),
          ),
      );
      triangulatePolygon(
        ids.map((id) => vertices[id]),
        n,
      ).forEach((f) => faces.push(f.map((i) => ids[i])));
    }
  if (!faces.length)
    throw new Error(
      "Ce maillage ne possède pas de contours compatibles avec le chanfrein.",
    );
  return fromTopology(vertices, faces);
}
function triangulateContours(
  contours: { ids: number[]; points: THREE.Vector3[] }[],
  normal: THREE.Vector3,
): number[][] {
  if (!contours.length) return [];
  const axis =
    Math.abs(normal.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  const u = axis.cross(normal).normalize(),
    v = normal.clone().cross(u).normalize();
  const loops = contours.map((contour) => ({
    ...contour,
    projected: contour.points.map((p) => new THREE.Vector2(p.dot(u), p.dot(v))),
  }));
  loops.sort(
    (a, b) =>
      Math.abs(THREE.ShapeUtils.area(b.projected)) -
      Math.abs(THREE.ShapeUtils.area(a.projected)),
  );
  const ids = loops.flatMap((loop) => loop.ids),
    points = loops.flatMap((loop) => loop.points);
  return THREE.ShapeUtils.triangulateShape(
    loops[0].projected,
    loops.slice(1).map((loop) => loop.projected),
  ).map((face) => {
    const n = points[face[1]]
      .clone()
      .sub(points[face[0]])
      .cross(points[face[2]].clone().sub(points[face[0]]));
    const oriented = n.dot(normal) < 0 ? [face[0], face[2], face[1]] : face;
    return oriented.map((i) => ids[i]);
  });
}
function triangulatePolygon(
  points: THREE.Vector3[],
  normal: THREE.Vector3,
): number[][] {
  const axis =
    Math.abs(normal.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  const u = axis.cross(normal).normalize(),
    v = normal.clone().cross(u).normalize();
  const contour = points.map((p) => new THREE.Vector2(p.dot(u), p.dot(v)));
  const result = THREE.ShapeUtils.triangulateShape(contour, []);
  return result.map((f) => {
    const n = points[f[1]]
      .clone()
      .sub(points[f[0]])
      .cross(points[f[2]].clone().sub(points[f[0]]));
    return n.dot(normal) < 0 ? [f[0], f[2], f[1]] : f;
  });
}
export function spinConfiguration(
  data: GeometryData,
  faces: number[] = [],
): { axis: "x" | "y" | "z"; center: Vec3 } {
  const t = topology(data);
  const first = t.faces[faces[0] ?? 0];
  if (!first) return { axis: "y", center: [3, 0, 0] };
  const normal = t.vertices[first[1]]
    .clone()
    .sub(t.vertices[first[0]])
    .cross(t.vertices[first[2]].clone().sub(t.vertices[first[0]]))
    .normalize();
  const axis =
    Math.abs(normal.y) < 0.001 ? "y" : Math.abs(normal.z) < 0.001 ? "z" : "x";
  const vector = new THREE.Vector3(
    axis === "x" ? 1 : 0,
    axis === "y" ? 1 : 0,
    axis === "z" ? 1 : 0,
  );
  const points = faces.length
    ? [...new Set(faces.flatMap((i) => t.faces[i] || []))].map(
        (i) => t.vertices[i],
      )
    : t.vertices;
  const bounds = new THREE.Box3().setFromPoints(points),
    size = bounds.getSize(new THREE.Vector3());
  const center = bounds
    .getCenter(new THREE.Vector3())
    .addScaledVector(
      vector.cross(normal).normalize(),
      -Math.max(size.x, size.y, size.z, 1) - 1,
    );
  return { axis, center: center.toArray() as Vec3 };
}
/** Extrusion angulaire d’un profil plan, raccordée et soudée ; fermeture automatique à 360 degrés. */
export function spinGeometry(
  data: GeometryData,
  selectedFaces: number[],
  axis: "x" | "y" | "z",
  center: Vec3,
  steps = 48,
  angle = Math.PI * 2,
): GeometryData {
  if (
    !["x", "y", "z"].includes(axis) ||
    !center.every(Number.isFinite) ||
    !Number.isFinite(angle) ||
    Math.abs(angle) < 1e-6 ||
    Math.abs(angle) > Math.PI * 2 + 1e-6
  )
    throw new Error("Axe, centre ou angle de Spin invalide.");
  const t = topology(data),
    selected = new Set(
      selectedFaces.length ? selectedFaces : t.faces.map((_, i) => i),
    );
  if ([...selected].some((i) => !Number.isInteger(i) || !t.faces[i]))
    throw new Error("La sélection du profil est invalide.");
  const boundary: [number, number][] = [];
  for (const i of selected) {
    const face = t.faces[i];
    for (let j = 0; j < 3; j++) {
      const a = face[j],
        b = face[(j + 1) % 3],
        edge = t.edges.get(edgeKey(a, b))!;
      if (edge.faces.filter((fi) => selected.has(fi)).length === 1)
        boundary.push([a, b]);
    }
  }
  if (!boundary.length)
    throw new Error(
      "Spin nécessite un profil ouvert ou une région de faces. Sélectionnez une face, ou utilisez un plan.",
    );
  const sourceIds = [...new Set([...selected].flatMap((i) => t.faces[i]))],
    sourcePoints = sourceIds.map((i) => t.vertices[i]);
  const origin = new THREE.Vector3(...center),
    axisVector = new THREE.Vector3(
      axis === "x" ? 1 : 0,
      axis === "y" ? 1 : 0,
      axis === "z" ? 1 : 0,
    );
  const first = t.faces[[...selected][0]],
    normal = t.vertices[first[1]]
      .clone()
      .sub(t.vertices[first[0]])
      .cross(t.vertices[first[2]].clone().sub(t.vertices[first[0]]))
      .normalize();
  if (!normal.lengthSq())
    throw new Error(
      "Le profil de Spin est dégénéré. Sélectionnez une surface plane non vide.",
    );
  if (
    Math.abs(normal.dot(axisVector)) > 1e-5 ||
    sourcePoints.some(
      (p) => Math.abs(p.clone().sub(t.vertices[first[0]]).dot(normal)) > 1e-5,
    ) ||
    Math.abs(origin.clone().sub(t.vertices[first[0]]).dot(normal)) > 1e-5
  )
    throw new Error(
      "Le profil doit être plan, avec l’axe et son centre dans ce plan. Ajustez l’axe et les coordonnées du centre.",
    );
  const reference = new THREE.Box3()
    .setFromPoints(sourcePoints)
    .getCenter(new THREE.Vector3())
    .sub(origin);
  reference.addScaledVector(axisVector, -reference.dot(axisVector)).normalize();
  if (
    !reference.lengthSq() ||
    sourcePoints.some((p) => p.clone().sub(origin).dot(reference) <= 1e-5)
  )
    throw new Error(
      "L’axe ne doit pas traverser le profil. Décalez le centre à l’extérieur de la section.",
    );
  const segments = Math.max(2, Math.min(128, Math.round(steps))),
    closed = Math.abs(Math.abs(angle) - Math.PI * 2) < 1e-6,
    ringCount = closed ? segments : segments + 1;
  const ringIds = closed ? [...new Set(boundary.flat())] : sourceIds;
  if (ringIds.length * ringCount > 1500000)
    throw new Error(
      "Le Spin dépasserait 1,5 million de sommets. Réduisez le nombre de segments.",
    );
  const localIds = new Map(ringIds.map((id, i) => [id, i]));
  const vertices: THREE.Vector3[] = [],
    faces: number[][] = [];
  for (let ring = 0; ring < ringCount; ring++) {
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      axisVector,
      (angle * ring) / segments,
    );
    for (const id of ringIds)
      vertices.push(
        t.vertices[id]
          .clone()
          .sub(origin)
          .applyQuaternion(rotation)
          .add(origin),
      );
  }
  const tangent = axisVector
    .clone()
    .cross(reference)
    .multiplyScalar(Math.sign(angle));
  const reverse = normal.dot(tangent) < 0;
  const add = (ids: number[], invert = false) =>
    faces.push(invert ? [ids[0], ids[2], ids[1]] : ids);
  for (let ring = 0; ring < segments; ring++)
    for (const [a, b] of boundary) {
      const current = ring * ringIds.length,
        next = ((ring + 1) % ringCount) * ringIds.length,
        ai = localIds.get(a)!,
        bi = localIds.get(b)!;
      add([current + ai, current + bi, next + bi], reverse);
      add([current + ai, next + bi, next + ai], reverse);
    }
  if (!closed)
    for (const i of selected) {
      const face = t.faces[i].map((id) => localIds.get(id)!);
      add(face, !reverse);
      add(
        face.map((id) => id + segments * ringIds.length),
        reverse,
      );
    }
  return fromTopology(vertices, faces);
}
export function latheGeometry(
  data: GeometryData,
  segments: number,
  angle = Math.PI * 2,
): GeometryData {
  const t = topology(data);
  const bounds = new THREE.Box3().setFromPoints(t.vertices);
  const steps = 16;
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, i / steps);
    const candidates = t.vertices.filter(
      (v) =>
        Math.abs(v.y - y) <=
        Math.max(0.01, (bounds.max.y - bounds.min.y) / steps),
    );
    const radius = candidates.length
      ? Math.max(...candidates.map((v) => Math.hypot(v.x, v.z)))
      : Math.max(Math.abs(bounds.max.x), Math.abs(bounds.min.x));
    profile.push(new THREE.Vector2(Math.max(0.01, radius), y));
  }
  const g = new THREE.LatheGeometry(profile, Math.max(8, segments), 0, angle);
  const result = serializeGeometry(g);
  g.dispose();
  return result;
}
export function sweepGeometry(
  data: GeometryData,
  points: Vec3[],
  segments: number,
): GeometryData {
  if (points.length < 2)
    throw new Error("Le chemin doit contenir au moins deux points.");
  const t = topology(data);
  const box = new THREE.Box3().setFromPoints(t.vertices);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const shape = new THREE.Shape();
  const radiusX = Math.max(size.x / 2, 0.05),
    radiusY = Math.max(size.y / 2, 0.05);
  const projected = t.vertices.map(
    (p) => new THREE.Vector2(p.x - center.x, p.y - center.y),
  );
  const hull = convexHull(projected);
  if (hull.length >= 3) {
    shape.moveTo(hull[0].x, hull[0].y);
    hull.slice(1).forEach((p) => shape.lineTo(p.x, p.y));
    shape.closePath();
  } else shape.absellipse(0, 0, radiusX, radiusY, 0, Math.PI * 2, false, 0);
  const g = new THREE.ExtrudeGeometry(shape, {
    steps: Math.max(8, segments),
    bevelEnabled: false,
    extrudePath: new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
    ),
  });
  const result = serializeGeometry(g);
  g.dispose();
  return result;
}
function convexHull(points: THREE.Vector2[]): THREE.Vector2[] {
  const unique = [
    ...new Map(
      points.map((p) => [`${p.x.toFixed(6)},${p.y.toFixed(6)}`, p]),
    ).values(),
  ].sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length < 3) return unique;
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [],
    upper: THREE.Vector2[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  for (const p of unique.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
export function cleanGeometry(data: GeometryData): GeometryData {
  const g = deserializeGeometry(data);
  const welded = mergeVertices(g);
  welded.computeVertexNormals();
  const result = serializeGeometry(welded);
  g.dispose();
  welded.dispose();
  return result;
}

export function deleteComponents(
  data: GeometryData,
  mode: "vertex" | "edge" | "face",
  selected: number[],
): GeometryData | null {
  const t = topology(data);
  const remove = new Set<number>();
  if (mode === "face") selected.forEach((id) => remove.add(id));
  if (mode === "vertex") {
    const ids = new Set(selected);
    t.faces.forEach((f, i) => {
      if (f.some((v) => ids.has(v))) remove.add(i);
    });
  }
  if (mode === "edge") {
    const edges = [...t.edges.values()];
    selected.forEach((id) =>
      edges[id]?.faces.forEach((face) => remove.add(face)),
    );
  }
  const kept = t.faces.filter((_, i) => !remove.has(i));
  if (!kept.length) return null;
  const used = [...new Set(kept.flat())];
  const remap = new Map(used.map((old, index) => [old, index]));
  return fromTopology(
    used.map((id) => t.vertices[id]),
    kept.map((face) => face.map((id) => remap.get(id)!)),
  );
}
