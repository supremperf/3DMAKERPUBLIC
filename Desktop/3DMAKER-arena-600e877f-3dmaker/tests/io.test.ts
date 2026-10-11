import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { exportFBX } from "../src/engine/fbxExporter";
import { createPrimitive } from "../src/engine/geometry";
import { validateDocument } from "../src/engine/io";
import { DEFAULT_RENDER, type SceneDocument } from "../src/types";
describe("Fichiers et FBX natif", () => {
  it("produit un FBX réellement relisible par FBXLoader", () => {
    const node = createPrimitive("cube", "Cube français");
    node.transform.position = [1, 2, 3];
    node.material.color = "#cc4422";
    const text = exportFBX([node]);
    const loaded = new FBXLoader().parse(
      new TextEncoder().encode(text).buffer,
      "",
    );
    const mesh = loaded.children.find(
      (c) => (c as THREE.Mesh).isMesh,
    ) as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect(mesh.geometry.getAttribute("position").count).toBe(36);
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    const color = (mesh.material as THREE.MeshPhongMaterial).color;
    expect(`#${color.getHexString()}`).toBe("#cc4422");
  });
  it("préserve les UV et les rotations d’un FBX exporté", () => {
    const node = createPrimitive("sphere");
    node.transform.rotation[1] = Math.PI / 4;
    const loaded = new FBXLoader().parse(
      new TextEncoder().encode(exportFBX([node])).buffer,
      "",
    );
    const mesh = loaded.children[0] as THREE.Mesh;
    expect(mesh.geometry.getAttribute("uv").count).toBe(
      mesh.geometry.getAttribute("position").count,
    );
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 4, 4);
  });
  it("refuse les projets invalides et les identifiants dupliqués", () => {
    expect(() => validateDocument({ version: 5 })).toThrow("projet");
    const node = createPrimitive("cube");
    const document: SceneDocument = {
      version: 1,
      name: "Test",
      nodes: [node, node],
      render: DEFAULT_RENDER,
    };
    expect(() => validateDocument(document)).toThrow("invalide");
  });
  it("rejette les groupes nuls et un environnement HDR mal typé", () => {
    const node = createPrimitive("cube");
    node.geometry!.groups = [
      null as unknown as {
        start: number;
        count: number;
        materialIndex: number;
      },
    ];
    expect(() =>
      validateDocument({
        version: 1,
        name: "Test",
        nodes: [node],
        render: DEFAULT_RENDER,
      }),
    ).toThrow("corrompus");
    node.geometry!.groups = [];
    expect(() =>
      validateDocument({
        version: 1,
        name: "Test",
        nodes: [node],
        render: { ...DEFAULT_RENDER, hdri: 12 },
      }),
    ).toThrow("rendu");
  });
  it("refuse les indices qui sortent du maillage", () => {
    const node = createPrimitive("cube");
    node.geometry!.indices = [0, 1, 100000];
    expect(() =>
      validateDocument({
        version: 1,
        name: "Test",
        nodes: [node],
        render: DEFAULT_RENDER,
      }),
    ).toThrow("corrompu");
  });
});
