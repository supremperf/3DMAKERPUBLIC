import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createPrimitive,
  topology,
  triangleCount,
  booleanOperation,
  bevel,
  subdivide,
  extrude,
  mirror,
  mergeNodes,
  transformComponents,
  decimate,
  latheGeometry,
  sweepGeometry,
  serializeGeometry,
  deserializeGeometry,
  spinGeometry,
  spinConfiguration,
  transformNodeWorld,
  transformMatrix,
} from "../src/engine/geometry";
import type { GeometryData, Primitive } from "../src/types";
function volume(data: GeometryData): number {
  const t = topology(data);
  return Math.abs(
    t.faces.reduce(
      (sum, [a, b, c]) =>
        sum + t.vertices[a].dot(t.vertices[b].clone().cross(t.vertices[c])) / 6,
      0,
    ),
  );
}
function valid(g: GeometryData) {
  expect(g.positions.every(Number.isFinite)).toBe(true);
  expect(triangleCount(g)).toBeGreaterThan(0);
  expect(g.normals?.length).toBe(g.positions.length);
  expect(g.uvs?.length).toBe((g.positions.length / 3) * 2);
  const geometry = deserializeGeometry(g);
  expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
  geometry.dispose();
}
describe("Primitives et sérialisation", () => {
  for (const primitive of [
    "cube",
    "sphere",
    "cylinder",
    "cone",
    "torus",
    "plane",
    "tube",
    "box",
  ] as Primitive[])
    it(`crée un ${primitive} exploitable`, () => {
      const g = createPrimitive(primitive).geometry!;
      valid(g);
      const restored = deserializeGeometry(g);
      expect(serializeGeometry(restored).positions).toEqual(g.positions);
      restored.dispose();
    });
  it("soude les sommets du cube indépendamment des coutures UV", () => {
    const t = topology(createPrimitive("cube").geometry!);
    expect(t.vertices).toHaveLength(8);
    expect(t.faces).toHaveLength(12);
    expect([...t.edges.values()].every((e) => e.faces.length === 2)).toBe(true);
  });
});
describe("Opérations géométriques réelles", () => {
  for (const [operation, expectedVolume] of [
    ["union", 12],
    ["difference", 4],
    ["intersection", 4],
  ] as const)
    it(`calcule la ${operation} et son volume`, () => {
      const a = createPrimitive("cube");
      const b = createPrimitive("cube");
      b.transform.position[0] = 1;
      const result = booleanOperation(a, b, operation);
      valid(result.geometry!);
      expect(volume(result.geometry!)).toBeCloseTo(expectedVolume, 3);
    });
  it("refuse une surface ouverte et accepte un cône avec ses triangles dégénérés nettoyés", () => {
    const a = createPrimitive("cube");
    expect(() =>
      booleanOperation(a, createPrimitive("plane"), "union"),
    ).toThrow("volumes fermés");
    const cone = createPrimitive("cone");
    cone.transform.position[0] = 0.7;
    valid(booleanOperation(a, cone, "union").geometry!);
    const intermediate = booleanOperation(
      a,
      createPrimitive("cube", undefined, [1, 1, 0]),
      "union",
    );
    valid(
      booleanOperation(
        intermediate,
        createPrimitive("sphere", undefined, [1, 1, 0]),
        "difference",
      ).geometry!,
    );
  });
  it("signale une intersection vide", () => {
    const a = createPrimitive("cube");
    const b = createPrimitive("cube");
    b.transform.position[0] = 5;
    expect(() => booleanOperation(a, b, "intersection")).toThrow("vide");
  });
  it("chanfreine un cube en conservant un volume fermé", () => {
    const g = bevel(createPrimitive("cube").geometry!, 0.1);
    valid(g);
    expect(volume(g)).toBeLessThan(8);
    expect(volume(g)).toBeGreaterThan(7.5);
    expect(
      [...topology(g).edges.values()].every((e) => e.faces.length === 2),
    ).toBe(true);
  });
  it("construit une boîte creuse sans faces internes superposées", () => {
    const g = createPrimitive("box").geometry!;
    expect(
      [...topology(g).edges.values()].every((e) => e.faces.length === 2),
    ).toBe(true);
    expect(volume(g)).toBeCloseTo(3.392, 5);
  });
  it("chanfreine une boîte sans boucher son ouverture", () => {
    const g = bevel(createPrimitive("box").geometry!, 0.1);
    valid(g);
    expect(
      [...topology(g).edges.values()].every((e) => e.faces.length === 2),
    ).toBe(true);
    const t = topology(g),
      ray = new THREE.Ray(
        new THREE.Vector3(0, 5, 0),
        new THREE.Vector3(0, -1, 0),
      );
    const hits = t.faces
      .map(([a, b, c]) =>
        ray.intersectTriangle(
          t.vertices[a],
          t.vertices[b],
          t.vertices[c],
          false,
          new THREE.Vector3(),
        ),
      )
      .filter((p): p is THREE.Vector3 => !!p);
    expect(Math.max(...hits.map((p) => p.y))).toBeLessThan(-0.6);
  });
  it("extrude les deux triangles de la face supérieure avec des raccords", () => {
    const g = extrude(createPrimitive("cube").geometry!, [4, 5], 0.5);
    valid(g);
    expect(volume(g)).toBeCloseTo(10, 5);
    expect(
      [...topology(g).edges.values()].every((e) => e.faces.length === 2),
    ).toBe(true);
  });
  it("subdivise sans lisser en préservant le volume", () => {
    const g = subdivide(createPrimitive("cube").geometry!, 2, false);
    valid(g);
    expect(triangleCount(g)).toBe(192);
    expect(volume(g)).toBeCloseTo(8, 5);
  });
  it("subdivise et lisse réellement les sommets", () => {
    const g = subdivide(createPrimitive("cube").geometry!, 1, true);
    valid(g);
    expect(triangleCount(g)).toBe(48);
    expect(volume(g)).toBeLessThan(8);
  });
  it("réoriente les faces après une réflexion", () => {
    const g = mirror(createPrimitive("cube").geometry!, "x", false);
    valid(g);
    expect(volume(g)).toBeCloseTo(8, 5);
  });
  it("fusionne dans le repère global", () => {
    const a = createPrimitive("cube");
    const b = createPrimitive("cube");
    b.transform.position[0] = 3;
    const merged = mergeNodes([a, b]);
    valid(merged.geometry!);
    expect(triangleCount(merged.geometry!)).toBe(24);
    expect(volume(merged.geometry!)).toBeCloseTo(16, 4);
    expect(merged.transform.position[0]).toBeCloseTo(1.5, 5);
  });
  it("préserve exactement une échelle globale sur un objet tourné", () => {
    const node = createPrimitive("cube");
    node.transform.rotation[1] = Math.PI / 4;
    const delta = new THREE.Matrix4().makeScale(2, 1, 1),
      result = transformNodeWorld(node, delta);
    const expected = transformMatrix(node.transform).premultiply(delta),
      actual = transformMatrix(result.transform);
    for (let i = 0; i < node.geometry!.positions.length; i += 3) {
      const a = new THREE.Vector3(
          ...(node.geometry!.positions.slice(i, i + 3) as [
            number,
            number,
            number,
          ]),
        ).applyMatrix4(expected),
        b = new THREE.Vector3(
          ...(result.geometry!.positions.slice(i, i + 3) as [
            number,
            number,
            number,
          ]),
        ).applyMatrix4(actual);
      expect(a.distanceTo(b)).toBeLessThan(0.00001);
    }
  });
  it("déplace toutes les copies UV d’un sommet soudé", () => {
    const source = createPrimitive("cube").geometry!;
    const t = topology(source);
    const g = transformComponents(
      source,
      "vertex",
      [0],
      new THREE.Matrix4().makeTranslation(0.5, 0, 0),
    );
    t.sourceMap.forEach((id, index) => {
      expect(g.positions[index * 3]).toBeCloseTo(
        source.positions[index * 3] + (id === 0 ? 0.5 : 0),
        5,
      );
    });
  });
  it("décime effectivement une sphère", async () => {
    const source = createPrimitive("sphere").geometry!;
    const g = await decimate(source, 0.5);
    valid(g);
    expect(triangleCount(g)).toBeLessThan(triangleCount(source) * 0.65);
  });
  it("réalise un Spin soudé et un arc fermé, sans dupliquer des objets", () => {
    const source = createPrimitive("plane").geometry!,
      config = spinConfiguration(source);
    for (const angle of [Math.PI * 2, Math.PI / 2]) {
      const g = spinGeometry(source, [], config.axis, config.center, 24, angle);
      valid(g);
      expect(
        [...topology(g).edges.values()].every((e) => e.faces.length === 2),
      ).toBe(true);
      expect(volume(g)).toBeGreaterThan(20);
    }
    expect(() =>
      spinGeometry(createPrimitive("cube").geometry!, [], "y", [3, 0, 0]),
    ).toThrow("profil");
  });
  it("produit une révolution et une extrusion sur chemin", () => {
    const source = createPrimitive("cube").geometry!;
    valid(latheGeometry(source, 32));
    valid(
      sweepGeometry(
        source,
        [
          [0, 0, 0],
          [0, 1, 2],
          [2, 2, 4],
        ],
        24,
      ),
    );
  });
});
