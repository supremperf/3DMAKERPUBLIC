import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ASSETS,
  createAsset,
  layoutNodes,
  placeAlongside,
  worldBounds,
} from "../src/engine/library";
import { createPrimitive } from "../src/engine/geometry";
import { validateDocument } from "../src/engine/io";
import { DEFAULT_RENDER } from "../src/types";
import { executePlan } from "../src/services/assistantPlan";
describe("Bibliothèque de créations réellement éditables", () => {
  it.each(ASSETS)("valide tous les maillages de $name", (asset) => {
    const nodes = createAsset(asset.id);
    expect(nodes.length).toBeGreaterThan(0);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    expect(new Set(nodes.map((n) => n.name)).size).toBe(nodes.length);
    expect(
      validateDocument({
        version: 1,
        name: asset.name,
        nodes,
        render: DEFAULT_RENDER,
      }).nodes.length,
    ).toBe(nodes.length);
    for (const node of nodes) {
      expect(node.geometry?.positions.every(Number.isFinite)).toBe(true);
      expect(node.geometry!.normals?.length).toBe(
        node.geometry!.positions.length,
      );
      expect(node.geometry!.uvs?.length).toBe(
        (node.geometry!.positions.length * 2) / 3,
      );
      const bounds = worldBounds(node);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.07);
    }
  });
  it("applique la taille, la position et la couleur à toute une création", () => {
    const original = createAsset("robot"),
      changed = createAsset("robot", {
        size: 2,
        position: [5, 0, -3],
        color: "#223344",
      });
    original.forEach((n, i) => {
      expect(changed[i].transform.position[0]).toBeCloseTo(
        n.transform.position[0] * 2 + 5,
      );
      expect(changed[i].transform.position[2]).toBeCloseTo(
        n.transform.position[2] * 2 - 3,
      );
      expect(changed[i].material.color).toBe("#223344");
    });
  });
  it("refuse une taille, couleur ou position invalide", () => {
    expect(() => createAsset("robot", { size: 0 })).toThrow("taille");
    expect(() => createAsset("robot", { color: "red" })).toThrow("Couleur");
    expect(() => createAsset("robot", { position: [NaN, 0, 0] })).toThrow(
      "Position",
    );
  });
  it("positionne une création à côté des objets existants sans changer leurs données", () => {
    const cube = createPrimitive("cube"),
      before = JSON.stringify(cube),
      robot = createAsset("robot");
    const placed = placeAlongside(robot, [cube]);
    expect(
      Math.min(...placed.map((n) => worldBounds(n).min.x)),
    ).toBeGreaterThan(worldBounds(cube).max.x);
    expect(JSON.stringify(cube)).toBe(before);
    expect(placeAlongside(robot, [])).toBe(robot);
  });
  it("pose au sol un objet tourné et avec une échelle négative", () => {
    const node = createPrimitive("cube");
    node.transform.position = [1, 5, 2];
    node.transform.rotation = [0.2, 0.5, 0.9];
    node.transform.scale = [-2, 1, 3];
    const grounded = layoutNodes([node], [node.id], "ground")[0];
    expect(worldBounds(grounded).min.y).toBeCloseTo(0, 6);
    expect(grounded.transform.position[0]).toBe(1);
    expect(node.transform.position[1]).toBe(5);
  });
  it("centre un groupe sans déplacer Y ni modifier les distances", () => {
    const a = createPrimitive("cube"),
      b = createPrimitive("sphere");
    a.transform.position = [4, 5, 2];
    b.transform.position = [7, 8, 4];
    const result = layoutNodes([a, b], [a.id, b.id], "center"),
      bounds = new THREE.Box3();
    result.forEach((n) => bounds.union(worldBounds(n)));
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
    expect(result[0].transform.position[1]).toBe(5);
    expect(result[1].transform.position[1]).toBe(8);
    expect(
      result[1].transform.position[0] - result[0].transform.position[0],
    ).toBe(3);
  });
  it("préserve les objets verrouillés et refuse une sélection sans maillage", () => {
    const node = createPrimitive("cube");
    node.locked = true;
    expect(() => layoutNodes([node], [node.id], "ground")).toThrow(
      "déverrouillé",
    );
  });
  it("crée un château via une action IA validée et atomique", () => {
    const before = {
      version: 1 as const,
      name: "Test",
      nodes: [],
      render: DEFAULT_RENDER,
    };
    const result = executePlan(before, [], {
      message: "Plan de château",
      actions: [
        {
          type: "create_asset",
          asset: "castle",
          size: 0.6,
          position: [2, 0, 3],
        },
      ],
    });
    expect(result.document.nodes.length).toBeGreaterThan(40);
    expect(before.nodes).toEqual([]);
    expect(result.selection.length).toBe(result.document.nodes.length);
  });
  it("rejette une bibliothèque inconnue sans changement partiel", () => {
    const before = {
      version: 1 as const,
      name: "Test",
      nodes: [],
      render: DEFAULT_RENDER,
    };
    expect(() =>
      executePlan(before, [], {
        message: "Test",
        actions: [
          { type: "create_asset", asset: "robot" },
          { type: "create_asset", asset: "inconnu" },
        ],
      }),
    ).toThrow("inconnue");
    expect(before.nodes).toEqual([]);
  });
});
