import * as THREE from "three";
import type { RenderSettings } from "../types";

export const BACKGROUND_PRESETS = [
  { name: "Ardoise", background: "#25282b", backgroundEnd: "#4b5461" },
  { name: "Blanc", background: "#eef0f3", backgroundEnd: "#c9d0d8" },
  { name: "Sable", background: "#dbc9b2", backgroundEnd: "#9c8d7d" },
  { name: "Océan", background: "#1a3445", backgroundEnd: "#59849b" },
  { name: "Lavande", background: "#3d344e", backgroundEnd: "#8b80a4" },
  { name: "Forêt", background: "#273c35", backgroundEnd: "#667f6e" },
] as const;
export function coverTransform(imageAspect: number, viewportAspect: number) {
  if (
    !Number.isFinite(imageAspect) ||
    imageAspect <= 0 ||
    !Number.isFinite(viewportAspect) ||
    viewportAspect <= 0
  )
    throw new Error("Proportions du fond invalides.");
  const x = Math.min(1, viewportAspect / imageAspect),
    y = Math.min(1, imageAspect / viewportAspect);
  return {
    repeat: [x, y] as [number, number],
    offset: [(1 - x) / 2, (1 - y) / 2] as [number, number],
  };
}
export function gradientTexture(
  top: string,
  bottom: string,
): THREE.DataTexture {
  const a = new THREE.Color(top),
    b = new THREE.Color(bottom),
    data = new Uint8Array(256 * 4),
    color = new THREE.Color();
  // Données encodées en sRGB : Three effectue la conversion une seule fois.
  a.convertLinearToSRGB();
  b.convertLinearToSRGB();
  for (let i = 0; i < 256; i++) {
    color.copy(b).lerp(a, i / 255);
    data[i * 4] = Math.round(color.r * 255);
    data[i * 4 + 1] = Math.round(color.g * 255);
    data[i * 4 + 2] = Math.round(color.b * 255);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 1, 256, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
export class SceneBackground {
  private texture?: THREE.Texture;
  private key = "";
  private version = 0;
  private aspect = 1;
  private settings?: RenderSettings;
  private pending: Promise<void> = Promise.resolve();
  constructor(
    private scene: THREE.Scene,
    private onError: (message: string) => void,
  ) {}
  update(settings: RenderSettings, aspect: number) {
    this.settings = settings;
    this.aspect = aspect;
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(
      settings.environmentRotation,
    );
    this.scene.backgroundRotation.y = THREE.MathUtils.degToRad(
      settings.environmentRotation,
    );
    const key = JSON.stringify([
      settings.backgroundMode,
      settings.background,
      settings.backgroundEnd,
      settings.backgroundImage,
    ]);
    if (key !== this.key) {
      this.key = key;
      const version = ++this.version;
      this.pending = Promise.resolve();
      this.texture?.dispose();
      this.texture = undefined;
      this.scene.background = new THREE.Color(settings.background);
      if (settings.backgroundMode === "gradient") {
        this.texture = gradientTexture(
          settings.background,
          settings.backgroundEnd,
        );
        this.scene.background = this.texture;
      } else if (
        settings.backgroundMode === "image" &&
        settings.backgroundImage
      ) {
        this.pending = new THREE.TextureLoader()
          .loadAsync(settings.backgroundImage)
          .then((texture) => {
            if (version !== this.version) {
              texture.dispose();
              return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            this.texture = texture;
            this.scene.background = texture;
            this.fit();
          })
          .catch((e: unknown) => {
            if (version === this.version)
              this.onError(
                `Le fond ne peut pas être chargé : ${e instanceof Error ? e.message : "image invalide"}.`,
              );
          });
      } else this.pending = Promise.resolve();
    }
    if (settings.backgroundMode === "environment")
      this.scene.background =
        this.scene.environment || new THREE.Color(settings.background);
    else if (
      (settings.backgroundMode === "gradient" ||
        settings.backgroundMode === "image") &&
      this.texture
    )
      this.scene.background = this.texture;
    else this.scene.background = new THREE.Color(settings.background);
    this.fit();
  }
  private fit() {
    if (this.settings?.backgroundMode !== "image" || !this.texture) return;
    const image = this.texture.image as { width: number; height: number };
    const { repeat, offset } = coverTransform(
      image.width / image.height,
      this.aspect,
    );
    this.texture.repeat.set(...repeat);
    this.texture.offset.set(...offset);
    this.texture.updateMatrix();
  }
  async ready() {
    await this.pending;
  }
  dispose() {
    ++this.version;
    this.texture?.dispose();
  }
}

/** Décode réellement la photo et limite son coût mémoire avant stockage dans le projet. */
export async function prepareBackground(file: File): Promise<string> {
  if (!/image\/(png|jpeg|webp)/.test(file.type) || file.size > 20 * 1024 * 1024)
    throw new Error("Choisissez une image PNG, JPG ou WebP de 20 Mo maximum.");
  const bitmap = await createImageBitmap(file);
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 80_000_000
    )
      throw new Error(
        "La résolution de cette image est trop élevée (80 mégapixels maximum).",
      );
    const ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Le décodage du fond est indisponible.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}
