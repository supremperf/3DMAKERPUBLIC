import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { useEditor } from "../store/editor";
import {
  deserializeGeometry,
  topology,
  transformMatrix,
  transformComponents,
  transformNodeWorld,
  triangleCount,
} from "./geometry";
import {
  materialFromData,
  pruneTextureCache,
  waitForMaterialTextures,
} from "./materials";
import { createEnvironment } from "./environments";
import { SceneBackground } from "./background";
import type { SceneNode, SceneDocument, Vec3 } from "../types";

interface Callbacks {
  onBox?: (box: { x: number; y: number; w: number; h: number } | null) => void;
  onContextMenu?: (x: number, y: number) => void;
  onCamera?: (label: string, projection: string) => void;
}
interface ObjectRecord {
  node: SceneNode;
  object: THREE.Object3D;
}
const lime = "#c7f38b";
export class ViewportEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private gammaPass: ShaderPass;
  private fxaa: ShaderPass;
  private root = new THREE.Group();
  private helpers = new THREE.Group();
  private selectionHelpers = new THREE.Group();
  private componentHelpers = new THREE.Group();
  private measureHelpers = new THREE.Group();
  private proxy = new THREE.Object3D();
  private gizmoHelper: THREE.Object3D;
  private grid: THREE.Mesh;
  private floor: THREE.Mesh;
  private axes = new THREE.AxesHelper(3);
  private records = new Map<string, ObjectRecord>();
  private raycaster = new THREE.Raycaster();
  private resizeObserver: ResizeObserver;
  private unsubscribe: () => void;
  private frame = 0;
  private destroyed = false;
  private dragging = false;
  private dragDocument: SceneDocument | null = null;
  private dragProxyMatrix = new THREE.Matrix4();
  private dragSelection: string[] = [];
  private dragComponents: number[] = [];
  private environmentTarget?: THREE.WebGLRenderTarget;
  private environmentKey = "";
  private environmentVersion = 0;
  private environmentReady: Promise<void> = Promise.resolve();
  private background = new SceneBackground(this.scene, (message) =>
    useEditor.getState().notify(message, "error"),
  );
  private rightPointerStart: { x: number; y: number } | null = null;
  private pointerStart: {
    x: number;
    y: number;
    shift: boolean;
    boxing: boolean;
    id: number;
  } | null = null;
  private cameraTween?: {
    start: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    targetFrom: THREE.Vector3;
    targetTo: THREE.Vector3;
  };
  private frames = 0;
  private lastStats = performance.now();
  private width = 1;
  private height = 1;
  constructor(
    private container: HTMLElement,
    private callbacks: Callbacks = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "viewport-canvas";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "Scène 3D interactive");
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 3000);
    this.camera.position.set(8.5, 6.2, 9.5);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.8, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 0.1;
    this.orbit.maxDistance = 700;
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.orbit.screenSpacePanning = true;
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.8);
    this.gizmoHelper = this.gizmo.getHelper();
    this.scene.add(
      this.gizmoHelper,
      this.proxy,
      this.root,
      this.helpers,
      this.selectionHelpers,
      this.componentHelpers,
      this.measureHelpers,
    );
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.dragging = Boolean(e.value);
      this.orbit.enabled = !this.dragging;
    });
    this.gizmo.addEventListener("mouseDown", () => this.beginDrag());
    this.gizmo.addEventListener("objectChange", () => this.changeDrag());
    this.gizmo.addEventListener("mouseUp", () => this.endDrag());
    this.grid = this.makeGrid();
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.ShadowMaterial({
        color: "#080a0d",
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.006;
    this.floor.receiveShadow = true;
    this.axes.position.y = 0.004;
    this.axes.visible = true;
    (this.axes.material as THREE.LineBasicMaterial).transparent = true;
    (this.axes.material as THREE.LineBasicMaterial).opacity = 0.55;
    this.scene.add(this.grid, this.floor, this.axes);
    // Un éclairage de travail neutre complète les lumières créées par l’utilisateur.
    const ambient = new THREE.HemisphereLight("#f5f5e5", "#404851", 1.1);
    this.scene.add(ambient);
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new OutputPass());
    this.gammaPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, gamma: { value: 2.2 } },
      vertexShader:
        "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader:
        "uniform sampler2D tDiffuse; uniform float gamma; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv);gl_FragColor=vec4(pow(max(c.rgb,vec3(0.0)),vec3(2.2/gamma)),c.a);}",
    });
    this.composer.addPass(this.gammaPass);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.onPointerDown, true);
    canvas.addEventListener("pointermove", this.onPointerMove, true);
    canvas.addEventListener("pointerup", this.onPointerUp, true);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    this.orbit.addEventListener("start", () => {
      this.cameraTween = undefined;
    });
    this.unsubscribe = useEditor.subscribe((s, previous) => {
      if (s.document !== previous.document) this.syncDocument(s.document);
      if (
        s.selection !== previous.selection ||
        s.mode !== previous.mode ||
        s.components !== previous.components ||
        s.tool !== previous.tool ||
        s.axisLock !== previous.axisLock ||
        s.transformSpace !== previous.transformSpace ||
        s.snap !== previous.snap ||
        s.document !== previous.document
      )
        this.syncSelection();
      if (s.measurement !== previous.measurement) this.syncMeasurement();
      if (s.cameraCommand.id !== previous.cameraCommand.id)
        this.cameraView(s.cameraCommand.view, s.cameraCommand.nodeId);
    });
    this.syncDocument(useEditor.getState().document);
    this.syncSelection();
    this.animate();
  }
  private makeGrid() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { cameraPos: { value: new THREE.Vector3() } },
      vertexShader:
        "varying vec3 worldPos; void main(){worldPos=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(worldPos,1.0);}",
      fragmentShader: `varying vec3 worldPos; uniform vec3 cameraPos;
      float grid(vec2 p,float size){vec2 r=abs(fract(p/size-0.5)-0.5)/max(fwidth(p/size),vec2(0.0001));return 1.0-min(min(r.x,r.y),1.0);}
      void main(){float minor=grid(worldPos.xz,1.0);float major=grid(worldPos.xz,5.0);float fade=1.0-smoothstep(12.0,65.0,distance(worldPos.xz,cameraPos.xz));float a=(minor*0.09+major*0.06)*fade;gl_FragColor=vec4(vec3(0.19,0.21,0.23),a);}`,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), material);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -0.003;
    return grid;
  }
  private resize() {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    this.updateAspect(this.width / this.height);
    const ratio = this.renderer.getPixelRatio();
    this.fxaa.uniforms.resolution.value.set(
      1 / (this.width * ratio),
      1 / (this.height * ratio),
    );
  }
  private updateAspect(aspect: number) {
    this.background.update(useEditor.getState().document.render, aspect);
    if (this.camera instanceof THREE.PerspectiveCamera)
      this.camera.aspect = aspect;
    else {
      const halfHeight = (this.camera.top - this.camera.bottom) / 2;
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
    }
    this.camera.updateProjectionMatrix();
  }
  private createObject(node: SceneNode): THREE.Object3D {
    if (node.kind === "mesh" && node.geometry) {
      const mesh = new THREE.Mesh(
        deserializeGeometry(node.geometry),
        materialFromData(
          node.material,
          useEditor.getState().document.render.wireframe,
        ),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }
    const group = new THREE.Group();
    if (node.light) {
      const l = node.light;
      let light: THREE.Light;
      if (l.type === "ambient")
        light = new THREE.AmbientLight(l.color, l.intensity);
      else if (l.type === "directional")
        light = new THREE.DirectionalLight(l.color, l.intensity);
      else if (l.type === "point")
        light = new THREE.PointLight(l.color, l.intensity, l.distance, 2);
      else
        light = new THREE.SpotLight(
          l.color,
          l.intensity,
          l.distance,
          THREE.MathUtils.degToRad(l.angle),
          l.penumbra,
          2,
        );
      if ("castShadow" in light) light.castShadow = l.castShadow;
      if ("shadow" in light) {
        const shadow = (light as THREE.DirectionalLight).shadow;
        shadow.mapSize.setScalar(
          useEditor.getState().document.render.shadowQuality,
        );
        shadow.bias = -0.00025;
        shadow.normalBias = 0.025;
        if (shadow.camera instanceof THREE.OrthographicCamera) {
          shadow.camera.left = shadow.camera.bottom = -20;
          shadow.camera.right = shadow.camera.top = 20;
          shadow.camera.far = 150;
        }
      }
      if (
        light instanceof THREE.DirectionalLight ||
        light instanceof THREE.SpotLight
      ) {
        light.target.position.copy(
          new THREE.Vector3(...l.target).sub(
            new THREE.Vector3(...node.transform.position),
          ),
        );
        group.add(light.target);
      }
      group.add(light);
      const handle = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.14),
        new THREE.MeshBasicMaterial({ color: l.color, wireframe: true }),
      );
      handle.userData.helper = true;
      group.add(handle);
    } else if (node.camera) {
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.22, 0.22),
        new THREE.MeshBasicMaterial({ color: "#90a7d4", wireframe: true }),
      );
      handle.userData.helper = true;
      group.add(handle);
    }
    return group;
  }
  private syncDocument(document: SceneDocument) {
    const ids = new Set(document.nodes.map((n) => n.id));
    for (const [id, record] of this.records)
      if (!ids.has(id)) {
        this.root.remove(record.object);
        this.disposeObject(record.object);
        this.records.delete(id);
      }
    for (const node of document.nodes) {
      let record = this.records.get(node.id);
      if (
        !record ||
        record.node.kind !== node.kind ||
        record.node.geometry !== node.geometry ||
        record.node.light !== node.light ||
        record.node.camera !== node.camera
      ) {
        if (record) {
          this.root.remove(record.object);
          this.disposeObject(record.object);
        }
        const object = this.createObject(node);
        object.userData.nodeId = node.id;
        this.root.add(object);
        record = { node, object };
        this.records.set(node.id, record);
      } else if (
        record.node.material !== node.material &&
        record.object instanceof THREE.Mesh
      ) {
        (record.object.material as THREE.Material).dispose();
        record.object.material = materialFromData(
          node.material,
          document.render.wireframe,
        );
      }
      record.node = node;
      record.object.name = node.name;
      record.object.visible = node.visible;
      record.object.position.fromArray(node.transform.position);
      record.object.rotation.set(...node.transform.rotation);
      record.object.scale.fromArray(node.transform.scale);
      if (record.object instanceof THREE.Mesh) {
        (record.object.material as THREE.MeshStandardMaterial).wireframe =
          document.render.wireframe;
      }
      record.object.updateMatrixWorld(true);
      record.object.traverse((object) => {
        if (
          (object instanceof THREE.DirectionalLight ||
            object instanceof THREE.SpotLight) &&
          node.light
        )
          object.target.position
            .fromArray(node.light.target)
            .applyMatrix4(record.object.matrixWorld.clone().invert());
        if (
          object instanceof THREE.DirectionalLight ||
          object instanceof THREE.PointLight ||
          object instanceof THREE.SpotLight
        ) {
          const quality = document.render.shadowQuality;
          if (object.shadow.mapSize.x !== quality) {
            object.shadow.mapSize.set(quality, quality);
            object.shadow.map?.dispose();
            object.shadow.map = null;
            object.shadow.needsUpdate = true;
          }
        }
      });
    }
    this.root.updateMatrixWorld(true);
    const s = document.render;
    this.background.update(s, this.width / this.height);
    this.renderer.toneMapping = {
      aces: THREE.ACESFilmicToneMapping,
      filmic: THREE.AgXToneMapping,
      linear: THREE.LinearToneMapping,
    }[s.toneMapping];
    this.renderer.toneMappingExposure = s.exposure;
    this.renderer.shadowMap.enabled = s.shadows;
    (this.floor.material as THREE.MeshStandardMaterial).color
      .set(s.background)
      .multiplyScalar(0.5);
    this.floor.visible = s.grid;
    this.grid.visible = s.grid;
    this.axes.visible = s.axes;
    this.scene.fog = s.fog ? new THREE.FogExp2(s.fogColor, s.fogDensity) : null;
    this.gammaPass.uniforms.gamma.value = s.gamma;
    this.fxaa.enabled = s.antialias;
    this.scene.environmentIntensity = s.environmentIntensity;
    const key = `${s.environment}:${s.hdri || ""}`;
    if (key !== this.environmentKey) {
      this.environmentKey = key;
      const version = ++this.environmentVersion;
      this.environmentReady = createEnvironment(this.renderer, s)
        .then((target) => {
          if (this.destroyed || version !== this.environmentVersion) {
            target.dispose();
            return;
          }
          this.scene.environment = target.texture;
          this.environmentTarget?.dispose();
          this.environmentTarget = target;
          this.background.update(
            useEditor.getState().document.render,
            this.width / this.height,
          );
        })
        .catch((error) => {
          this.environmentKey = "";
          useEditor
            .getState()
            .notify(`Environnement HDR : ${(error as Error).message}`, "error");
        });
    }
    pruneTextureCache(
      new Set(
        document.nodes.flatMap((n) =>
          Object.values(n.material.textures).filter((v): v is string => !!v),
        ),
      ),
    );
  }
  private syncSelection() {
    const s = useEditor.getState();
    this.clearGroup(this.selectionHelpers);
    this.clearGroup(this.componentHelpers);
    const selected = s.selection
      .map((id) => this.records.get(id))
      .filter((r): r is ObjectRecord => !!r && r.node.visible);
    for (const record of selected)
      if (record.node.kind === "mesh") {
        const box = new THREE.Box3().setFromObject(record.object);
        this.selectionHelpers.add(this.cornerBox(box));
      }
    if (s.mode !== "object" && selected[0]?.node.geometry)
      this.buildComponentHelpers(
        selected[0].node,
        selected[0].object.matrixWorld,
      );
    if (this.dragging) return;
    const editable = selected.filter((r) => !r.node.locked);
    if (
      !editable.length ||
      ["select", "measure"].includes(s.tool) ||
      (s.mode !== "object" && !s.components.length)
    ) {
      this.gizmo.detach();
      return;
    }
    this.gizmo.setMode(s.tool as "translate" | "rotate" | "scale");
    this.gizmo.setSpace(s.transformSpace);
    this.gizmo.setTranslationSnap(s.snap ? 0.25 : null);
    this.gizmo.setRotationSnap(s.snap ? Math.PI / 12 : null);
    this.gizmo.setScaleSnap(s.snap ? 0.1 : null);
    this.gizmo.showE = !s.axisLock;
    this.gizmo.showXYZE = !s.axisLock;
    this.gizmo.showX = !s.axisLock || s.axisLock === "x";
    this.gizmo.showY = !s.axisLock || s.axisLock === "y";
    this.gizmo.showZ = !s.axisLock || s.axisLock === "z";
    const center =
      s.mode !== "object"
        ? this.componentCenter(editable[0].node, editable[0].object.matrixWorld)
        : editable.length === 1
          ? editable[0].object.position.clone()
          : editable
              .reduce((v, r) => v.add(r.object.position), new THREE.Vector3())
              .divideScalar(editable.length);
    this.proxy.position.copy(center);
    this.proxy.quaternion.identity();
    this.proxy.scale.set(1, 1, 1);
    if (s.transformSpace === "local" && editable.length === 1)
      this.proxy.quaternion.copy(editable[0].object.quaternion);
    this.proxy.updateMatrixWorld(true);
    this.gizmo.attach(this.proxy);
  }
  private cornerBox(box: THREE.Box3) {
    const values: number[] = [];
    const { min, max } = box;
    const length = Math.min(
      box.getSize(new THREE.Vector3()).length() * 0.08,
      0.3,
    );
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          for (const axis of [0, 1, 2]) {
            const a = [x, y, z],
              b = [...a];
            b[axis] +=
              (a[axis] === [min.x, min.y, min.z][axis] ? 1 : -1) * length;
            values.push(...a, ...b);
          }
        }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
    return new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({
        color: lime,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      }),
    );
  }
  private componentVertexIds(node: SceneNode): Set<number> {
    const s = useEditor.getState();
    const t = topology(node.geometry!);
    const vertices = new Set<number>();
    const edges = [...t.edges.values()];
    s.components.forEach((id) => {
      if (s.mode === "vertex") vertices.add(id);
      if (s.mode === "edge" && edges[id]) {
        vertices.add(edges[id].a);
        vertices.add(edges[id].b);
      }
      if (s.mode === "face") t.faces[id]?.forEach((v) => vertices.add(v));
    });
    return vertices;
  }
  private componentCenter(node: SceneNode, world: THREE.Matrix4) {
    const t = topology(node.geometry!);
    const ids = [...this.componentVertexIds(node)];
    return ids.length
      ? ids
          .reduce((sum, id) => sum.add(t.vertices[id]), new THREE.Vector3())
          .divideScalar(ids.length)
          .applyMatrix4(world)
      : new THREE.Vector3().setFromMatrixPosition(world);
  }
  private buildComponentHelpers(node: SceneNode, world: THREE.Matrix4) {
    const s = useEditor.getState();
    const t = topology(node.geometry!);
    const selected = new Set(s.components);
    if (s.mode === "vertex") {
      for (const active of [false, true]) {
        const positions = t.vertices
          .filter((_, i) => selected.has(i) === active)
          .flatMap((v) => v.clone().applyMatrix4(world).toArray());
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        const points = new THREE.Points(
          g,
          new THREE.PointsMaterial({
            color: active ? lime : "#92a5aa",
            size: active ? 8 : 5,
            sizeAttenuation: false,
            depthTest: false,
          }),
        );
        this.componentHelpers.add(points);
      }
    } else if (s.mode === "edge") {
      for (const active of [false, true]) {
        const positions = [...t.edges.values()]
          .filter((_, i) => selected.has(i) === active)
          .flatMap((e) =>
            [t.vertices[e.a], t.vertices[e.b]].flatMap((v) =>
              v.clone().applyMatrix4(world).toArray(),
            ),
          );
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        this.componentHelpers.add(
          new THREE.LineSegments(
            g,
            new THREE.LineBasicMaterial({
              color: active ? lime : "#5b6c74",
              transparent: true,
              opacity: active ? 1 : 0.55,
              depthTest: false,
            }),
          ),
        );
      }
    } else {
      const positions = t.faces
        .filter((_, i) => selected.has(i))
        .flatMap((f) =>
          f.flatMap((id) =>
            t.vertices[id].clone().applyMatrix4(world).toArray(),
          ),
        );
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      this.componentHelpers.add(
        new THREE.Mesh(
          g,
          new THREE.MeshBasicMaterial({
            color: lime,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }),
        ),
      );
      const edges = new THREE.EdgesGeometry(
        deserializeGeometry(node.geometry!),
        12,
      );
      edges.applyMatrix4(world);
      this.componentHelpers.add(
        new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({
            color: "#809292",
            transparent: true,
            opacity: 0.4,
          }),
        ),
      );
    }
  }
  private beginDrag() {
    const s = useEditor.getState();
    this.dragDocument = s.document;
    this.dragSelection = [...s.selection];
    this.dragComponents = [...s.components];
    this.proxy.updateMatrixWorld(true);
    this.dragProxyMatrix.copy(this.proxy.matrixWorld);
    s.beginTransaction();
  }
  private changeDrag() {
    if (!this.dragDocument) return;
    if (this.gizmo.mode === "scale")
      for (const axis of ["x", "y", "z"] as const)
        if (Math.abs(this.proxy.scale[axis]) < 0.0001)
          this.proxy.scale[axis] =
            this.proxy.scale[axis] < 0 ? -0.0001 : 0.0001;
    this.proxy.updateMatrixWorld(true);
    const delta = this.proxy.matrixWorld
      .clone()
      .multiply(this.dragProxyMatrix.clone().invert());
    const s = useEditor.getState();
    const document = {
      ...this.dragDocument,
      nodes: this.dragDocument.nodes.map((node) => {
        if (!this.dragSelection.includes(node.id) || node.locked) return node;
        if (
          s.mode !== "object" &&
          node.id === this.dragSelection[0] &&
          node.geometry
        ) {
          const world = transformMatrix(node.transform);
          const localDelta = world
            .clone()
            .invert()
            .multiply(delta)
            .multiply(world);
          return {
            ...node,
            geometry: transformComponents(
              node.geometry,
              s.mode,
              this.dragComponents,
              localDelta,
            ),
          };
        }
        return transformNodeWorld(node, delta);
      }),
    };
    s.preview(document);
  }
  private endDrag() {
    this.dragDocument = null;
    useEditor.getState().endTransaction("Transformer la sélection");
    this.dragging = false;
    this.syncSelection();
  }
  get transforming(): boolean {
    return this.dragDocument !== null;
  }
  cancelTransform(): boolean {
    if (!this.dragDocument) return false;
    const original = this.dragDocument;
    this.gizmo.reset();
    this.dragDocument = null;
    this.gizmo.dragging = false;
    this.gizmo.axis = null;
    this.dragging = false;
    this.orbit.enabled = true;
    useEditor.getState().preview(original);
    useEditor.getState().endTransaction("Transformer la sélection");
    this.syncSelection();
    return true;
  }
  private setRay(event: PointerEvent | MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
  }
  private onPointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      this.rightPointerStart = { x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0) return;
    const s = useEditor.getState();
    const boxing = event.shiftKey && s.tool === "select" && s.mode === "object";
    this.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      shift: event.shiftKey || event.ctrlKey || event.metaKey,
      boxing,
      id: event.pointerId,
    };
    if (boxing) {
      this.orbit.enabled = false;
      event.stopImmediatePropagation();
      this.renderer.domElement.setPointerCapture(event.pointerId);
    }
  };
  private onPointerMove = (event: PointerEvent) => {
    const start = this.pointerStart;
    if (!start?.boxing) return;
    const r = this.container.getBoundingClientRect();
    this.callbacks.onBox?.({
      x: Math.min(start.x, event.clientX) - r.left,
      y: Math.min(start.y, event.clientY) - r.top,
      w: Math.abs(start.x - event.clientX),
      h: Math.abs(start.y - event.clientY),
    });
    event.stopImmediatePropagation();
  };
  private onPointerUp = (event: PointerEvent) => {
    if (event.button === 2) {
      const right = this.rightPointerStart;
      this.rightPointerStart = null;
      if (
        right &&
        Math.hypot(event.clientX - right.x, event.clientY - right.y) < 5
      )
        this.callbacks.onContextMenu?.(event.clientX, event.clientY);
      return;
    }
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || event.button !== 0) return;
    const distance = Math.hypot(
      start.x - event.clientX,
      start.y - event.clientY,
    );
    if (start.boxing) {
      this.callbacks.onBox?.(null);
      this.orbit.enabled = true;
      if (this.renderer.domElement.hasPointerCapture(event.pointerId))
        this.renderer.domElement.releasePointerCapture(event.pointerId);
      event.stopImmediatePropagation();
      if (distance > 4) {
        this.selectBox(start, event);
        return;
      }
    }
    if (distance > 5 || this.dragging || this.dragDocument || this.gizmo.axis)
      return;
    this.pick(event, start.shift);
  };
  private onPointerCancel = () => {
    this.pointerStart = null;
    this.rightPointerStart = null;
    this.cancelTransform();
    this.orbit.enabled = true;
    this.callbacks.onBox?.(null);
  };
  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  private onDoubleClick = (event: MouseEvent) => {
    this.pick(event, false);
    useEditor.getState().focus("focus");
  };
  private selectBox(start: { x: number; y: number }, event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ids: string[] = [];
    for (const [id, r] of this.records) {
      if (!r.node.visible || r.node.locked) continue;
      const p = new THREE.Box3()
        .setFromObject(r.object)
        .getCenter(new THREE.Vector3())
        .project(this.camera);
      const x = rect.left + ((p.x + 1) * rect.width) / 2,
        y = rect.top + ((1 - p.y) * rect.height) / 2;
      if (
        p.z >= -1 &&
        p.z <= 1 &&
        x >= Math.min(start.x, event.clientX) &&
        x <= Math.max(start.x, event.clientX) &&
        y >= Math.min(start.y, event.clientY) &&
        y <= Math.max(start.y, event.clientY)
      )
        ids.push(id);
    }
    useEditor.setState((s) => ({
      selection: [...new Set([...s.selection, ...ids])],
      components: [],
    }));
  }
  private pick(event: PointerEvent | MouseEvent, additive: boolean) {
    const s = useEditor.getState();
    this.scene.updateMatrixWorld(true);
    this.setRay(event);
    const visible = [...this.records.values()]
      .filter((r) => r.node.visible)
      .map((r) => r.object);
    const hits = this.raycaster.intersectObjects(visible, true);
    if (s.tool === "measure") {
      const point =
        hits[0]?.point ||
        this.raycaster.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
          new THREE.Vector3(),
        );
      if (point)
        useEditor.setState({
          measurement:
            s.measurement.length === 1
              ? [...s.measurement, point.toArray() as Vec3]
              : [point.toArray() as Vec3],
        });
      return;
    }
    if (s.mode !== "object") {
      this.pickComponent(event, hits, additive);
      return;
    }
    let object: THREE.Object3D | undefined = hits[0]?.object;
    while (object && !object.userData.nodeId)
      object = object.parent || undefined;
    s.select(object?.userData.nodeId || null, additive);
  }
  private pickComponent(
    event: MouseEvent | PointerEvent,
    hits: THREE.Intersection[],
    additive: boolean,
  ) {
    const s = useEditor.getState();
    const record = this.records.get(s.selection[0]);
    if (!record?.node.geometry || record.node.locked) return;
    const t = topology(record.node.geometry);
    let component: number | undefined;
    if (s.mode === "face")
      component =
        hits.find((h) => h.object === record.object)?.faceIndex ?? undefined;
    else {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const toScreen = (p: THREE.Vector3) => {
        const projected = p
          .clone()
          .applyMatrix4(record.object.matrixWorld)
          .project(this.camera);
        return new THREE.Vector3(
          ((projected.x + 1) * rect.width) / 2 + rect.left,
          ((1 - projected.y) * rect.height) / 2 + rect.top,
          projected.z,
        );
      };
      const pointer = new THREE.Vector2(event.clientX, event.clientY);
      let best = s.mode === "vertex" ? 12 : 9;
      if (s.mode === "vertex")
        t.vertices.forEach((v, i) => {
          const p = toScreen(v);
          const d = Math.hypot(p.x - pointer.x, p.y - pointer.y);
          if (p.z >= -1 && p.z <= 1 && d < best) {
            best = d;
            component = i;
          }
        });
      else
        [...t.edges.values()].forEach((e, i) => {
          const a = toScreen(t.vertices[e.a]),
            b = toScreen(t.vertices[e.b]);
          const aa = new THREE.Vector2(a.x, a.y),
            bb = new THREE.Vector2(b.x, b.y);
          const ab = bb.clone().sub(aa);
          const u = THREE.MathUtils.clamp(
            pointer.clone().sub(aa).dot(ab) / Math.max(1e-9, ab.lengthSq()),
            0,
            1,
          );
          const d = aa.addScaledVector(ab, u).distanceTo(pointer);
          if (a.z >= -1 && a.z <= 1 && d < best) {
            best = d;
            component = i;
          }
        });
    }
    s.setComponents(
      component === undefined
        ? additive
          ? s.components
          : []
        : additive
          ? s.components.includes(component)
            ? s.components.filter((v) => v !== component)
            : [...s.components, component]
          : [component],
    );
  }
  private syncMeasurement() {
    this.clearGroup(this.measureHelpers);
    const points = useEditor
      .getState()
      .measurement.map((p) => new THREE.Vector3(...p));
    if (!points.length) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.measureHelpers.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: "#ffd27e",
          size: 9,
          sizeAttenuation: false,
          depthTest: false,
        }),
      ),
    );
    if (points.length === 2) {
      this.measureHelpers.add(
        new THREE.Line(
          geometry.clone(),
          new THREE.LineBasicMaterial({ color: "#ffd27e", depthTest: false }),
        ),
      );
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 70;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#222529";
      ctx.beginPath();
      ctx.roundRect(0, 0, 320, 70, 12);
      ctx.fill();
      ctx.font = "600 30px sans-serif";
      ctx.fillStyle = "#ffd27e";
      ctx.textAlign = "center";
      ctx.fillText(`${points[0].distanceTo(points[1]).toFixed(3)} m`, 160, 45);
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, depthTest: false }),
      );
      sprite.position
        .copy(points[0])
        .lerp(points[1], 0.5)
        .add(new THREE.Vector3(0, 0.2, 0));
      sprite.scale.set(1.3, 0.28, 1);
      sprite.userData.ownTexture = true;
      this.measureHelpers.add(sprite);
    }
  }
  cameraView(
    view:
      | "perspective"
      | "front"
      | "back"
      | "top"
      | "right"
      | "focus"
      | "all"
      | "camera",
    nodeId?: string,
  ) {
    const s = useEditor.getState();
    let target = this.orbit.target.clone();
    let position = this.camera.position.clone();
    const distance = Math.max(4, position.distanceTo(target));
    if (view === "camera") {
      const node = s.document.nodes.find((n) => n.id === nodeId && n.camera);
      if (!node?.camera) return;
      if (this.camera instanceof THREE.OrthographicCamera)
        this.setProjection("perspective");
      if (this.camera instanceof THREE.PerspectiveCamera) {
        this.camera.fov = node.camera.fov;
        this.camera.near = node.camera.near;
        this.camera.far = node.camera.far;
        this.camera.updateProjectionMatrix();
      }
      position.fromArray(node.transform.position);
      target.fromArray(node.camera.target);
    } else if (view === "focus" || view === "all") {
      const records = [...this.records.values()].filter(
        (r) =>
          r.node.visible &&
          r.node.geometry &&
          (view === "all" ||
            !s.selection.length ||
            s.selection.includes(r.node.id)),
      );
      if (!records.length) return;
      const bounds = new THREE.Box3();
      records.forEach((r) =>
        bounds.union(new THREE.Box3().setFromObject(r.object)),
      );
      target = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3()).length();
      const direction = position.clone().sub(this.orbit.target).normalize();
      position = target
        .clone()
        .addScaledVector(direction, Math.max(2, size * 1.6));
      if (this.camera instanceof THREE.OrthographicCamera) {
        this.camera.zoom = Math.max(0.01, 10 / Math.max(1, size));
        this.camera.updateProjectionMatrix();
      }
    } else {
      const directions = {
        perspective: new THREE.Vector3(1, 0.7, 1).normalize(),
        front: new THREE.Vector3(0, 0, 1),
        back: new THREE.Vector3(0, 0, -1),
        top: new THREE.Vector3(0, 1, 0.0001),
        right: new THREE.Vector3(1, 0, 0),
      };
      position = target.clone().addScaledVector(directions[view], distance);
    }
    this.cameraTween = {
      start: performance.now(),
      from: this.camera.position.clone(),
      to: position,
      targetFrom: this.orbit.target.clone(),
      targetTo: target,
    };
    const labels = {
      perspective: "Perspective",
      front: "Face",
      back: "Arrière",
      top: "Dessus",
      right: "Droite",
      focus: "Perspective",
      all: "Perspective",
      camera: "Caméra",
    };
    this.callbacks.onCamera?.(
      labels[view],
      this.camera instanceof THREE.OrthographicCamera
        ? "Orthographique"
        : "Perspective",
    );
  }
  setProjection(projection: "perspective" | "orthographic") {
    const previous = this.camera;
    const distance = previous.position.distanceTo(this.orbit.target);
    const aspect = this.width / this.height;
    if (projection === "orthographic") {
      const h = distance * Math.tan(THREE.MathUtils.degToRad(21));
      this.camera = new THREE.OrthographicCamera(
        -h * aspect,
        h * aspect,
        h,
        -h,
        0.01,
        3000,
      );
    } else this.camera = new THREE.PerspectiveCamera(42, aspect, 0.01, 3000);
    this.camera.position.copy(previous.position);
    this.camera.quaternion.copy(previous.quaternion);
    this.orbit.object = this.camera;
    this.gizmo.camera = this.camera;
    this.renderPass.camera = this.camera;
    this.camera.updateProjectionMatrix();
    this.callbacks.onCamera?.(
      "Perspective",
      projection === "perspective" ? "Perspective" : "Orthographique",
    );
  }
  private animate = () => {
    if (this.destroyed) return;
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now();
    if (this.cameraTween) {
      const u = Math.min(1, (now - this.cameraTween.start) / 330),
        ease = 1 - Math.pow(1 - u, 3);
      this.camera.position.lerpVectors(
        this.cameraTween.from,
        this.cameraTween.to,
        ease,
      );
      this.orbit.target.lerpVectors(
        this.cameraTween.targetFrom,
        this.cameraTween.targetTo,
        ease,
      );
      if (u === 1) this.cameraTween = undefined;
    }
    this.orbit.update();
    this.grid.position.x = this.floor.position.x = this.camera.position.x;
    this.grid.position.z = this.floor.position.z = this.camera.position.z;
    (this.grid.material as THREE.ShaderMaterial).uniforms.cameraPos.value.copy(
      this.camera.position,
    );
    this.composer.render();
    this.frames++;
    if (now - this.lastStats > 1000) {
      const nodes = useEditor
        .getState()
        .document.nodes.filter((n) => n.visible && n.geometry);
      useEditor.setState({
        stats: {
          fps: Math.round((this.frames * 1000) / (now - this.lastStats)),
          triangles: nodes.reduce(
            (count, n) => count + triangleCount(n.geometry!),
            0,
          ),
          vertices: nodes.reduce(
            (count, n) => count + n.geometry!.positions.length / 3,
            0,
          ),
          objects: nodes.length,
        },
      });
      this.frames = 0;
      this.lastStats = now;
    }
  };
  private captureQueue: Promise<void> = Promise.resolve();
  capture(
    width: number,
    height: number,
    mime: "image/png" | "image/jpeg",
    includeGrid: boolean,
    signal?: AbortSignal,
    transparent = false,
  ): Promise<Blob> {
    const result = this.captureQueue.then(async () => {
      if (signal?.aborted)
        throw new DOMException("Aperçu annulé.", "AbortError");
      return this.captureFrame(
        width,
        height,
        mime,
        includeGrid,
        signal,
        transparent,
      );
    });
    this.captureQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async captureFrame(
    width: number,
    height: number,
    mime: "image/png" | "image/jpeg",
    includeGrid: boolean,
    signal?: AbortSignal,
    transparent = false,
  ): Promise<Blob> {
    const limit = Math.min(8192, this.renderer.capabilities.maxTextureSize);
    if (
      ![width, height].every(Number.isInteger) ||
      width < 128 ||
      height < 128 ||
      width > limit ||
      height > limit
    )
      throw new Error(`Résolution autorisée : 128 à ${limit} pixels.`);
    await Promise.all(
      [...this.records.values()].flatMap((record) => {
        const material = (record.object as THREE.Mesh).material;
        return material instanceof THREE.MeshStandardMaterial
          ? [waitForMaterialTextures(material)]
          : [];
      }),
    );
    await Promise.all([this.background.ready(), this.environmentReady]);
    if (signal?.aborted || this.destroyed)
      throw new DOMException("Capture annulée.", "AbortError");
    const oldBackground = this.scene.background,
      oldAlpha = this.renderer.getClearAlpha();
    const oldRatio = this.renderer.getPixelRatio(),
      oldGrid = this.grid.visible,
      oldFloor = this.floor.visible,
      oldAxes = this.axes.visible;
    const helperStates = [
      this.gizmoHelper,
      this.selectionHelpers,
      this.componentHelpers,
      this.measureHelpers,
    ].map((o) => o.visible);
    const objectHelpers: { object: THREE.Object3D; visible: boolean }[] = [];
    this.root.traverse((o) => {
      if (o.userData.helper) {
        objectHelpers.push({ object: o, visible: o.visible });
        o.visible = false;
      }
    });
    [
      this.gizmoHelper,
      this.selectionHelpers,
      this.componentHelpers,
      this.measureHelpers,
    ].forEach((o) => (o.visible = false));
    this.grid.visible = includeGrid && oldGrid;
    this.axes.visible = false;
    this.floor.visible = oldFloor;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.composer.setPixelRatio(1);
      this.composer.setSize(width, height);
      this.updateAspect(width / height);
      this.fxaa.uniforms.resolution.value.set(1 / width, 1 / height);
      if (transparent && mime === "image/png") {
        this.scene.background = null;
        this.renderer.setClearAlpha(0);
        this.grid.visible = false;
      }
      this.composer.render();
      return await new Promise<Blob>((resolve, reject) =>
        this.renderer.domElement.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("La capture du rendu a échoué.")),
          mime,
          0.95,
        ),
      );
    } finally {
      this.grid.visible = oldGrid;
      this.floor.visible = oldFloor;
      this.axes.visible = oldAxes;
      [
        this.gizmoHelper,
        this.selectionHelpers,
        this.componentHelpers,
        this.measureHelpers,
      ].forEach((o, i) => (o.visible = helperStates[i]));
      objectHelpers.forEach(
        ({ object, visible }) => (object.visible = visible),
      );
      this.scene.background = oldBackground;
      this.renderer.setClearAlpha(oldAlpha);
      this.renderer.setPixelRatio(oldRatio);
      this.composer.setPixelRatio(oldRatio);
      this.resize();
    }
  }
  private disposeObject(object: THREE.Object3D) {
    object.traverse((child) => {
      const rendered = child as THREE.Mesh;
      if (rendered.geometry) rendered.geometry.dispose();
      if (rendered.material)
        (Array.isArray(rendered.material)
          ? rendered.material
          : [rendered.material]
        ).forEach((material) => {
          if (child.userData.ownTexture && "map" in material)
            (material.map as THREE.Texture)?.dispose();
          material.dispose();
        });
      if (
        child instanceof THREE.PointLight ||
        child instanceof THREE.DirectionalLight ||
        child instanceof THREE.SpotLight
      )
        child.dispose();
    });
  }
  private clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      this.disposeObject(child);
      group.remove(child);
    }
  }
  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.gizmo.dispose();
    this.environmentTarget?.dispose();
    this.background.dispose();
    this.composer.passes.forEach((pass) => pass.dispose());
    this.composer.dispose();
    this.disposeObject(this.scene);
    pruneTextureCache(new Set());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
let currentEngine: ViewportEngine | null = null;
export const viewport = {
  get: () => currentEngine,
  set: (engine: ViewportEngine | null) => {
    currentEngine = engine;
  },
};
