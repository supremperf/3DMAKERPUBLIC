import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  coverTransform,
  gradientTexture,
  SceneBackground,
} from "../src/engine/background";
import { DEFAULT_RENDER } from "../src/types";
import { validateDocument } from "../src/engine/io";
describe("Fonds, proportions et projets", () => {
  it("recadre une photo large dans une vue carrée sans déformation", () => {
    expect(coverTransform(2, 1)).toEqual({
      repeat: [0.5, 1],
      offset: [0.25, 0],
    });
  });
  it("recadre une photo carrée dans une vue large", () => {
    expect(coverTransform(1, 2)).toEqual({
      repeat: [1, 0.5],
      offset: [0, 0.25],
    });
  });
  it("conserve une photo de mêmes proportions", () => {
    expect(coverTransform(1.5, 1.5)).toEqual({
      repeat: [1, 1],
      offset: [0, 0],
    });
  });
  it("refuse des proportions nulles ou infinies", () => {
    expect(() => coverTransform(0, 1)).toThrow("invalides");
    expect(() => coverTransform(1, Infinity)).toThrow("invalides");
  });
  it("génère un vrai dégradé avec les bons pixels et le bon alpha", () => {
    const texture = gradientTexture("#ff0000", "#0000ff"),
      data = texture.image.data as Uint8Array;
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 255, 255]);
    expect(Array.from(data.slice(-4))).toEqual([255, 0, 0, 255]);
    expect(data[128 * 4]).toBeGreaterThan(120);
    texture.dispose();
  });
  it("restaure le fond courant après une capture et conserve la texture du dégradé", () => {
    const scene = new THREE.Scene(),
      controller = new SceneBackground(scene, () => {});
    controller.update(DEFAULT_RENDER, 1);
    const gradient = scene.background;
    scene.background = null;
    controller.update(DEFAULT_RENDER, 1.5);
    expect(scene.background).toBe(gradient);
    controller.update(
      { ...DEFAULT_RENDER, backgroundMode: "color", background: "#123456" },
      1,
    );
    expect(scene.background).toEqual(new THREE.Color("#123456"));
    controller.dispose();
  });
  it("complète les anciens projets sans casser leur couleur de fond", () => {
    const {
      backgroundMode: _mode,
      backgroundEnd: _end,
      environmentRotation: _rotation,
      ...legacy
    } = DEFAULT_RENDER;
    const loaded = validateDocument({
      version: 1,
      name: "Ancien",
      nodes: [],
      render: { ...legacy, background: "#334455" },
    });
    expect(loaded.render.background).toBe("#334455");
    expect(loaded.render.environmentRotation).toBe(0);
    expect(loaded.render.backgroundMode).toBe("color");
  });
  it("préserve la photo de fond dans le projet", () => {
    const data = "data:image/png;base64,iVBORw0KGgo=",
      loaded = validateDocument({
        version: 1,
        name: "Photo",
        nodes: [],
        render: {
          ...DEFAULT_RENDER,
          backgroundMode: "image",
          backgroundImage: data,
        },
      });
    expect(loaded.render.backgroundImage).toBe(data);
  });
  it("rejette les fonds distants, SVG et les rotations invalides", () => {
    for (const patch of [
      { backgroundImage: "https://example.com/private.png" },
      { backgroundImage: "data:image/svg+xml;base64,abc" },
      { environmentRotation: 190 },
      { backgroundMode: "unknown" },
    ])
      expect(() =>
        validateDocument({
          version: 1,
          name: "Test",
          nodes: [],
          render: { ...DEFAULT_RENDER, ...patch },
        }),
      ).toThrow("rendu");
  });
});
