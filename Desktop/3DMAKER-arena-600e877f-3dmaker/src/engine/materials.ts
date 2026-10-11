import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import {
  DEFAULT_MATERIAL,
  type MaterialData,
  type TextureSlot,
} from "../types";
import { useEditor } from "../store/editor";
interface CachedTexture {
  url: string;
  texture: THREE.Texture;
  ready: Promise<void>;
}
const textureCache = new Map<string, CachedTexture>();
const loader = new THREE.TextureLoader();
const hdrLoader = new HDRLoader().setDataType(THREE.FloatType);
export function materialFromData(
  data: MaterialData,
  wireframe = false,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: data.color,
    roughness: data.roughness,
    metalness: data.metalness,
    emissive: data.emissive,
    emissiveIntensity: data.emissiveIntensity,
    transmission: data.transmission,
    ior: data.ior,
    thickness: data.thickness,
    clearcoat: data.clearcoat,
    clearcoatRoughness: data.clearcoatRoughness,
    anisotropy: data.anisotropy,
    transparent: data.opacity < 1,
    opacity: data.opacity,
    flatShading: data.flatShading,
    side: data.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    normalScale: new THREE.Vector2(data.normalScale, data.normalScale),
    aoMapIntensity: data.aoIntensity,
    wireframe,
  });
  for (const [slot, url] of Object.entries(data.textures)) {
    if (!url) continue;
    const isColor = ["map", "emissiveMap"].includes(slot);
    const isHDR = url.startsWith("data:image/vnd.radiance");
    const key = `${isColor ? "color" : "data"}:${url}`;
    let cached = textureCache.get(key);
    if (!cached) {
      let resolve!: () => void, reject!: (error: Error) => void;
      const ready = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      ready.catch(() => undefined);
      const onError = () => {
        const error = new Error(
          "Une texture ne peut pas être chargée. Vérifiez le fichier PNG, JPG ou HDR.",
        );
        reject(error);
        if (typeof window !== "undefined")
          useEditor.getState().notify(error.message, "error");
      };
      const texture = isHDR
        ? hdrLoader.load(url, resolve, undefined, onError)
        : loader.load(url, resolve, undefined, onError);
      texture.colorSpace = isColor
        ? isHDR
          ? THREE.LinearSRGBColorSpace
          : THREE.SRGBColorSpace
        : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      if (isHDR) texture.flipY = true;
      cached = { url, texture, ready };
      textureCache.set(key, cached);
    }
    material[slot as TextureSlot] = cached.texture;
  }
  return material;
}
export async function waitForMaterialTextures(
  material: THREE.MeshStandardMaterial,
): Promise<void> {
  const slots = [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "emissiveMap",
    "aoMap",
  ] as const;
  const textures = slots
    .map((slot) => material[slot])
    .filter((t): t is THREE.Texture => !!t);
  await Promise.all(
    [...textureCache.values()]
      .filter((c) => textures.includes(c.texture))
      .map((c) => c.ready),
  );
}
export function pruneTextureCache(liveUrls: Set<string>) {
  for (const [key, cached] of textureCache)
    if (!liveUrls.has(cached.url)) {
      cached.texture.dispose();
      textureCache.delete(key);
    }
}
function imageCanvas(texture: THREE.Texture): HTMLCanvasElement {
  const image = texture.image as
    | (CanvasImageSource & { width: number; height: number })
    | {
        width: number;
        height: number;
        data: Uint8Array | Float32Array | Uint16Array;
      };
  if (!image?.width || !image.height)
    throw new Error("Les données de la texture sont vides.");
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  if ("data" in image) {
    const pixels = new Uint8ClampedArray(image.width * image.height * 4);
    const stride = image.data.length / (image.width * image.height);
    const floating =
      image.data instanceof Float32Array ||
      texture.type === THREE.HalfFloatType;
    const convert = (index: number, alpha = false) => {
      const raw =
        texture.type === THREE.HalfFloatType
          ? THREE.DataUtils.fromHalfFloat(image.data[index])
          : image.data[index];
      if (!floating) return raw;
      const linear = THREE.MathUtils.clamp(raw, 0, 1);
      return Math.round(
        (alpha || texture.colorSpace !== THREE.LinearSRGBColorSpace
          ? linear
          : linear < 0.0031308
            ? 12.92 * linear
            : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055) * 255,
      );
    };
    for (let p = 0; p < image.width * image.height; p++) {
      for (let c = 0; c < 3; c++) pixels[p * 4 + c] = convert(p * stride + c);
      pixels[p * 4 + 3] = stride === 4 ? convert(p * stride + 3, true) : 255;
    }
    context.putImageData(
      new ImageData(pixels, canvas.width, canvas.height),
      0,
      0,
    );
  } else context.drawImage(image, 0, 0);
  return canvas;
}
export function serializeMaterial(material: THREE.Material): MaterialData {
  const m = material as THREE.MeshPhysicalMaterial;
  const textures: MaterialData["textures"] = {};
  for (const slot of [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "emissiveMap",
    "aoMap",
  ] as TextureSlot[]) {
    const texture = m[slot];
    if (!texture?.image) continue;
    const canvas = imageCanvas(texture);
    if (texture.flipY === false) {
      const flipped = document.createElement("canvas");
      flipped.width = canvas.width;
      flipped.height = canvas.height;
      const context = flipped.getContext("2d")!;
      context.translate(0, canvas.height);
      context.scale(1, -1);
      context.drawImage(canvas, 0, 0);
      textures[slot] = flipped.toDataURL("image/png");
    } else textures[slot] = canvas.toDataURL("image/png");
  }
  return {
    ...structuredClone(DEFAULT_MATERIAL),
    color: m.color?.getHexString
      ? `#${m.color.getHexString()}`
      : DEFAULT_MATERIAL.color,
    roughness: m.roughness ?? 0.5,
    metalness: m.metalness ?? 0,
    emissive: m.emissive?.getHexString
      ? `#${m.emissive.getHexString()}`
      : "#000000",
    emissiveIntensity: m.emissiveIntensity ?? 0,
    opacity: m.opacity ?? 1,
    transmission: m.transmission ?? 0,
    ior: m.ior ?? 1.5,
    thickness: m.thickness ?? 0.1,
    clearcoat: m.clearcoat ?? 0,
    clearcoatRoughness: m.clearcoatRoughness ?? 0,
    anisotropy: m.anisotropy ?? 0,
    normalScale: m.normalScale?.x ?? 1,
    aoIntensity: m.aoMapIntensity ?? 1,
    doubleSided: m.side === THREE.DoubleSide,
    flatShading: m.flatShading ?? false,
    textures,
  };
}
export async function exportableMaterial(
  data: MaterialData,
): Promise<MaterialData> {
  if (
    !Object.values(data.textures).some((url) =>
      url?.startsWith("data:image/vnd.radiance"),
    )
  )
    return data;
  const material = materialFromData(data);
  await waitForMaterialTextures(material);
  try {
    return { ...data, textures: serializeMaterial(material).textures };
  } finally {
    material.dispose();
  }
}
