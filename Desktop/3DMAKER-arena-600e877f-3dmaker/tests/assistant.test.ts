import { describe, expect, it } from "vitest";
import { executePlan, parseAssistantPlan } from "../src/services/assistant";
import { worldBounds } from "../src/engine/library";
import { createPrimitive } from "../src/engine/geometry";
import { DEFAULT_RENDER, type SceneDocument } from "../src/types";
function document(): SceneDocument {
  return {
    version: 1,
    name: "Test",
    nodes: [createPrimitive("cube", "Cube")],
    render: { ...DEFAULT_RENDER },
  };
}
describe("Assistant : validation et exécution atomique", () => {
  it("applique un acier brossé rouge avec une vraie normal map et anisotropie", () => {
    const cube = createPrimitive("cube");
    const source = {
      version: 1 as const,
      name: "Test",
      nodes: [cube],
      render: DEFAULT_RENDER,
    };
    const result = executePlan(source, [cube.id], {
      message: "Acier brossé appliqué.",
      actions: [
        {
          type: "set_material",
          target: "selection",
          material: {
            color: "#bb2211",
            metalness: 1,
            roughness: 0.3,
            finish: "brushed",
          },
        },
      ],
    });
    const material = result.document.nodes[0].material;
    expect(material.color).toBe("#bb2211");
    expect(material.anisotropy).toBe(0.85);
    expect(material.textures.normalMap).toMatch(/^data:image\/png;base64,/);
    expect(
      Buffer.from(
        material.textures.normalMap!.split(",")[1],
        "base64",
      ).subarray(0, 8),
    ).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
  it("extrude les faces sélectionnées au lieu de gonfler toute la surface", () => {
    const source = document();
    const result = executePlan(
      source,
      [source.nodes[0].id],
      {
        message: "Face extrudée.",
        actions: [
          { type: "mesh_operation", operation: "extrude", amount: 0.5 },
        ],
      },
      { mode: "face", components: [4, 5] },
    );
    expect(
      Math.max(
        ...result.document.nodes[0].geometry!.positions.filter(
          (_, i) => i % 3 === 1,
        ),
      ),
    ).toBe(1.5);
  });
  it("refuse un JSON invalide et les plans trop grands", () => {
    expect(() => parseAssistantPlan("hello")).toThrow("JSON");
    expect(() =>
      parseAssistantPlan(
        JSON.stringify({
          message: "Test",
          actions: Array(201).fill({ type: "delete" }),
        }),
      ),
    ).toThrow("200");
  });
  it("accepte un bloc JSON balisé sans exécuter de code", () => {
    expect(
      parseAssistantPlan('```json\n{"message":"OK","actions":[]}\n```').message,
    ).toBe("OK");
  });
  it("modifie réellement un matériau sans muter la scène source", () => {
    const d = document();
    const result = executePlan(d, [d.nodes[0].id], {
      message: "Acier rouge",
      actions: [
        {
          type: "set_material",
          target: "selection",
          material: { color: "#bb2020", metalness: 1, roughness: 0.25 },
        },
      ],
    });
    expect(result.document.nodes[0].material.color).toBe("#bb2020");
    expect(result.document.nodes[0].material.metalness).toBe(1);
    expect(d.nodes[0].material.color).not.toBe("#bb2020");
  });
  it("crée un bâtiment et trois lumières par commandes réelles", () => {
    const d = document();
    const result = executePlan(d, [], {
      message: "Créé",
      actions: [
        {
          type: "create_primitive",
          primitive: "cylinder",
          name: "Tour",
          position: [0, 3, 0],
          scale: [1, 3, 1],
        },
        { type: "array", target: "Tour", count: 4, offset: [4, 0, 0] },
        ...[0, 1, 2].map((i) => ({
          type: "create_light",
          lightType: "point",
          name: `Orange ${i}`,
          position: [i, -1, 0],
          color: "#ff8800",
          intensity: 30,
        })),
      ],
    });
    expect(result.document.nodes.filter((n) => n.light)).toHaveLength(3);
    expect(result.document.nodes.filter((n) => n.geometry)).toHaveLength(5);
    expect(result.selection).toHaveLength(7);
  });
  it("refuse une action arbitraire sans modification partielle", () => {
    const d = document();
    expect(() =>
      executePlan(d, [], {
        message: "non",
        actions: [
          { type: "create_primitive", primitive: "sphere", name: "Test" },
          { type: "eval", code: 'fetch("secret")' },
        ],
      }),
    ).toThrow("non autorisée");
    expect(d.nodes).toHaveLength(1);
  });
  it("refuse les matériaux et les nombres dangereux", () => {
    const d = document();
    expect(() =>
      executePlan(d, [d.nodes[0].id], {
        message: "",
        actions: [
          {
            type: "set_material",
            material: { color: "url(javascript:alert(1))" },
          },
        ],
      }),
    ).toThrow("couleur");
    expect(() =>
      executePlan(d, [], {
        message: "",
        actions: [
          { type: "create_primitive", primitive: "cube", scale: [0, 0, 0] },
        ],
      }),
    ).toThrow("nulle");
  });
  it("respecte le verrouillage des objets", () => {
    const d = document();
    d.nodes[0].locked = true;
    expect(() =>
      executePlan(d, [d.nodes[0].id], {
        message: "",
        actions: [{ type: "delete" }],
      }),
    ).toThrow("modifiable");
    expect(d.nodes).toHaveLength(1);
  });
  it("crée un robot de vrais maillages sans modifier la scène originale", () => {
    const d = document();
    const result = executePlan(d, [], {
      message: "Robot proposé",
      actions: [
        {
          type: "create_asset",
          asset: "robot",
          size: 2,
          position: [5, 0, 0],
          name: "Robot",
        },
      ],
    });
    expect(result.document.nodes).toHaveLength(19);
    expect(result.selection).toHaveLength(18);
    expect(
      result.document.nodes
        .slice(1)
        .every((n) => n.geometry && n.name.startsWith("Robot")),
    ).toBe(true);
    expect(d.nodes).toHaveLength(1);
  });
  it("pose et centre une sélection par actions validées", () => {
    const d = document();
    d.nodes[0].transform.position = [8, 7, 4];
    const result = executePlan(d, [d.nodes[0].id], {
      message: "Disposition proposée",
      actions: [
        { type: "layout", operation: "ground" },
        { type: "layout", operation: "center" },
      ],
    });
    expect(result.document.nodes[0].transform.position).toEqual([0, 1, 0]);
    expect(worldBounds(result.document.nodes[0]).min.y).toBe(0);
    expect(d.nodes[0].transform.position).toEqual([8, 7, 4]);
  });
  it("configure les lumières et les caméras créées dans le même plan", () => {
    const d = document();
    const result = executePlan(d, [], {
      message: "Éclairage et cadrage proposés",
      actions: [
        { type: "create_light", lightType: "spot", name: "Projecteur" },
        {
          type: "set_light",
          target: "Projecteur",
          color: "#ffbb66",
          intensity: 75,
          angle: 30,
          targetPoint: [0, 1, 0],
          castShadow: false,
        },
        { type: "create_camera", name: "Vue" },
        { type: "set_camera", target: "Vue", fov: 60, targetPoint: [0, 2, 0] },
      ],
    });
    expect(result.document.nodes[1].light).toMatchObject({
      color: "#ffbb66",
      intensity: 75,
      angle: 30,
      target: [0, 1, 0],
      castShadow: false,
    });
    expect(result.document.nodes[2].camera).toMatchObject({
      fov: 60,
      target: [0, 2, 0],
    });
  });
  it("propose un dégradé, la rotation HDR et la suppression des guides sans mutation", () => {
    const d = document();
    const result = executePlan(d, [], {
      message: "Fond proposé",
      actions: [
        {
          type: "render",
          background: "#112233",
          backgroundEnd: "#445566",
          backgroundMode: "gradient",
          environmentRotation: 90,
          environmentIntensity: 0.8,
          grid: false,
          axes: false,
        },
      ],
    });
    expect(result.document.render).toMatchObject({
      background: "#112233",
      backgroundEnd: "#445566",
      backgroundMode: "gradient",
      environmentRotation: 90,
      environmentIntensity: 0.8,
      grid: false,
      axes: false,
    });
    expect(d.render).toEqual(DEFAULT_RENDER);
  });
  it("rejette les créations inconnues, les mauvaises cibles et les paramètres hors limites atomiquement", () => {
    for (const action of [
      { type: "create_asset", asset: "inconnu" },
      { type: "create_asset", asset: "robot", size: 50 },
      { type: "layout", operation: "random" },
      { type: "set_light" },
      { type: "set_camera", fov: 180 },
      { type: "render", environmentRotation: 360 },
    ]) {
      const d = document();
      expect(() =>
        executePlan(d, [d.nodes[0].id], {
          message: "Refus",
          actions: [
            { type: "create_primitive", primitive: "sphere", name: "Nouvelle" },
            action,
          ],
        }),
      ).toThrow();
      expect(d.nodes).toHaveLength(1);
    }
  });
  it("convertit les rotations de degrés en radians", () => {
    const d = document();
    const result = executePlan(d, [], {
      message: "ok",
      actions: [{ type: "transform", target: "Cube", rotation: [0, 90, 0] }],
    });
    expect(result.document.nodes[0].transform.rotation[1]).toBeCloseTo(
      Math.PI / 2,
    );
  });
});
