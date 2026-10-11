import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createAsset, worldBounds, type AssetId } from "./library";
import { deserializeGeometry, transformMatrix } from "./geometry";
let renderer: THREE.WebGLRenderer | null = null;
let environment: THREE.WebGLRenderTarget | null = null;
const cache = new Map<AssetId, string>();
/** Miniatures calculées à partir des mêmes maillages que ceux ajoutés à la scène. */
export function assetPreview(id: AssetId): string {
  const cached = cache.get(id);
  if (cached) return cached;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(300, 230);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    const room = new RoomEnvironment(),
      generator = new THREE.PMREMGenerator(renderer);
    environment = generator.fromScene(room);
    room.dispose();
    generator.dispose();
  }
  const nodes = createAsset(id),
    scene = new THREE.Scene(),
    bounds = new THREE.Box3();
  scene.environment = environment!.texture;
  scene.environmentIntensity = 0.65;
  scene.add(new THREE.AmbientLight("#ffffff", 0.35));
  const light = new THREE.DirectionalLight("#fff5e6", 2);
  light.position.set(3, 6, 4);
  scene.add(light);
  const meshes = nodes.map((node) => {
    bounds.union(worldBounds(node));
    const material = new THREE.MeshStandardMaterial({
      color: node.material.color,
      roughness: node.material.roughness,
      metalness: node.material.metalness,
    });
    const mesh = new THREE.Mesh(deserializeGeometry(node.geometry!), material);
    mesh.applyMatrix4(transformMatrix(node.transform));
    scene.add(mesh);
    return mesh;
  });
  try {
    const center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3()),
      distance = Math.max(...size.toArray()) * 1.6;
    const camera = new THREE.PerspectiveCamera(35, 300 / 230, 0.01, 1000);
    camera.position
      .copy(center)
      .addScaledVector(new THREE.Vector3(1, 0.72, 1).normalize(), distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    renderer.setClearColor("#000000", 0);
    renderer.render(scene, camera);
    const result = renderer.domElement.toDataURL("image/png");
    cache.set(id, result);
    return result;
  } finally {
    meshes.forEach((m) => {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    environment?.dispose();
    renderer?.dispose();
    renderer = null;
    environment = null;
    cache.clear();
  });
