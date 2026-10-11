import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { RenderSettings } from "../types";
export async function createEnvironment(
  renderer: THREE.WebGLRenderer,
  settings: RenderSettings,
): Promise<THREE.WebGLRenderTarget> {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  try {
    if (settings.environment === "custom" && settings.hdri) {
      const texture = await new HDRLoader().loadAsync(settings.hdri);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const target = pmrem.fromEquirectangular(texture);
      texture.dispose();
      return target;
    }
    if (
      settings.environment === "studio" ||
      settings.environment === "custom"
    ) {
      const room = new RoomEnvironment();
      const target = pmrem.fromScene(room, 0.04);
      room.dispose();
      return target;
    }
    // Panoramas à radiance flottante : soleil, horizon et ciel restent en véritable HDR.
    const width = 512,
      height = 256,
      data = new Float32Array(width * height * 4);
    const sunset = settings.environment === "sunset";
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const elevation = Math.sin((0.5 - y / height) * Math.PI),
          longitude = (x / width) * Math.PI * 2;
        const horizon = Math.exp(-elevation * elevation * 24);
        const sky = sunset ? [0.22, 0.32, 0.52] : [0.012, 0.025, 0.075];
        const horizonColor = sunset ? [2.8, 0.7, 0.12] : [0.16, 0.22, 0.5];
        const sun = Math.exp(
          -(
            (elevation - (sunset ? 0.12 : 0.65)) ** 2 +
            (longitude - 1.8) ** 2
          ) * (sunset ? 450 : 800),
        );
        const index = (y * width + x) * 4;
        for (let c = 0; c < 3; c++)
          data[index + c] =
            (elevation < -0.05
              ? sunset
                ? 0.06
                : 0.008
              : sky[c] + horizonColor[c] * horizon) +
            sun * (sunset ? [35, 15, 3][c] : [4, 6, 12][c]);
        data[index + 3] = 1;
      }
    const texture = new THREE.DataTexture(
      data,
      width,
      height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    const target = pmrem.fromEquirectangular(texture);
    texture.dispose();
    return target;
  } finally {
    pmrem.dispose();
  }
}
