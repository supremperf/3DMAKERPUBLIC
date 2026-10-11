export type Vec3 = [number, number, number];
export type Primitive =
  "cube" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "tube" | "box";
export type EditMode = "object" | "vertex" | "edge" | "face";
export type Tool = "select" | "translate" | "rotate" | "scale" | "measure";
export type TextureSlot =
  | "map"
  | "normalMap"
  | "roughnessMap"
  | "metalnessMap"
  | "emissiveMap"
  | "aoMap";
export interface GeometryData {
  positions: number[];
  indices?: number[];
  normals?: number[];
  uvs?: number[];
  groups?: { start: number; count: number; materialIndex: number }[];
}
export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}
export interface MaterialData {
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  transmission: number;
  ior: number;
  thickness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  anisotropy: number;
  flatShading: boolean;
  doubleSided: boolean;
  normalScale: number;
  aoIntensity: number;
  textures: Partial<Record<TextureSlot, string>>;
}
export interface LightData {
  type: "ambient" | "directional" | "point" | "spot";
  color: string;
  intensity: number;
  distance: number;
  angle: number;
  penumbra: number;
  castShadow: boolean;
  target: Vec3;
}
export interface CameraData {
  fov: number;
  near: number;
  far: number;
  target: Vec3;
}
export interface SceneNode {
  id: string;
  name: string;
  kind: "mesh" | "light" | "camera";
  visible: boolean;
  locked: boolean;
  transform: Transform;
  geometry?: GeometryData;
  material: MaterialData;
  light?: LightData;
  camera?: CameraData;
}
export interface RenderSettings {
  background: string;
  backgroundMode: "color" | "gradient" | "image" | "environment";
  backgroundEnd: string;
  backgroundImage?: string;
  environmentRotation: number;
  exposure: number;
  gamma: number;
  toneMapping: "aces" | "filmic" | "linear";
  antialias: boolean;
  shadows: boolean;
  shadowQuality: 512 | 1024 | 2048 | 4096;
  grid: boolean;
  axes: boolean;
  wireframe: boolean;
  fog: boolean;
  fogColor: string;
  fogDensity: number;
  environment: "studio" | "sunset" | "night" | "custom";
  environmentIntensity: number;
  hdri?: string;
}
export interface SceneDocument {
  version: 1;
  name: string;
  nodes: SceneNode[];
  render: RenderSettings;
}
export interface HistoryEntry {
  document: SceneDocument;
  label: string;
}
export interface Toast {
  id: string;
  message: string;
  kind: "success" | "error" | "info";
}
export interface GenerationProgress {
  percent: number;
  message: string;
  taskId?: string;
  status: "idle" | "running" | "success" | "error";
  error?: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionCount?: number;
}
export interface ViewportStats {
  fps: number;
  triangles: number;
  vertices: number;
  objects: number;
}
export interface MeasurePoint {
  position: Vec3;
}
export const DEFAULT_MATERIAL: MaterialData = {
  color: "#d9ddd1",
  roughness: 0.32,
  metalness: 0.08,
  emissive: "#000000",
  emissiveIntensity: 0,
  opacity: 1,
  transmission: 0,
  ior: 1.5,
  thickness: 0.1,
  clearcoat: 0,
  clearcoatRoughness: 0,
  anisotropy: 0,
  flatShading: false,
  doubleSided: false,
  normalScale: 1,
  aoIntensity: 1,
  textures: {},
};
export const DEFAULT_RENDER: RenderSettings = {
  background: "#25282b",
  backgroundMode: "gradient",
  backgroundEnd: "#444b55",
  environmentRotation: 0,
  exposure: 1.15,
  gamma: 2.2,
  toneMapping: "aces",
  antialias: true,
  shadows: true,
  shadowQuality: 2048,
  grid: true,
  axes: true,
  wireframe: false,
  fog: false,
  fogColor: "#25282b",
  fogDensity: 0.035,
  environment: "studio",
  environmentIntensity: 0.8,
};
export const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
export const uid = () => crypto.randomUUID();
export const primitiveNames: Record<Primitive, string> = {
  cube: "Cube",
  sphere: "Sphère",
  cylinder: "Cylindre",
  cone: "Cône",
  torus: "Tore",
  plane: "Plan",
  tube: "Tube",
  box: "Boîte",
};
