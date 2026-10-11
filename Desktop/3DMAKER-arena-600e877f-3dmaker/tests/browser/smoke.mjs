import assert from "node:assert/strict";
import { chromium as playwright } from "playwright";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
const directory = await mkdtemp(join(tmpdir(), "3dmaker-browser-"));
process.env.THREEDMAKER_PREVIEW_DATA = directory;
const application = await createViteServer({
  server: { port: 0, strictPort: false, host: "0.0.0.0", allowedHosts: true },
  logLevel: "error",
});
await application.listen();
const address = application.httpServer.address(),
  baseUrl = `http://localhost:${address.port}`;
const browser = await playwright.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: process.env.CHROMIUM_ARGS_JSON
    ? JSON.parse(process.env.CHROMIUM_ARGS_JSON)
    : ["--enable-unsafe-swiftshader"],
  headless: true,
});
await mkdir(".arena", { recursive: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 940 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (error) => {
  errors.push(error.message);
  console.error("PAGE ERROR:", error.message);
});
page.on("console", (message) => {
  if (message.type() === "error") console.error("CONSOLE:", message.text());
});
const state = () =>
  page.evaluate(async () => {
    const { useEditor } = await import("/src/store/editor.ts");
    const s = useEditor.getState();
    return {
      count: s.document.nodes.length,
      triangles: s.document.nodes
        .filter((n) => n.geometry)
        .map(
          (n) =>
            (n.geometry.indices?.length || n.geometry.positions.length / 3) / 3,
        ),
      past: s.past.length,
      selection: s.selection,
      nodes: s.document.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        color: n.material.color,
        anisotropy: n.material.anisotropy,
        normalMap: !!n.material.textures.normalMap,
        position: n.transform.position,
      })),
    };
  });
let server;
let originalSettings;
let generatedId;
try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    window.__editorStore = (await import("/src/store/editor.ts")).useEditor;
    window.__aiStore = (await import("/src/store/ai.ts")).useAI;
    (await import("/src/store/workspace.ts")).useWorkspace
      .getState()
      .setExpert(true);
  });
  assert.equal(await page.locator(".viewport-error").count(), 0);
  await page.evaluate(async () => {
    const { useEditor } = await import("/src/store/editor.ts");
    useEditor.getState().setRender({ shadows: false, antialias: false });
  });
  for (const name of [
    "Cube",
    "Sphère",
    "Cylindre",
    "Cône",
    "Tore",
    "Plan",
    "Tube",
    "Boîte",
  ])
    await page
      .locator(".primitives-grid")
      .getByRole("button", { name, exact: true })
      .click();
  assert.equal((await state()).count, 12);
  console.log("PASS: huit primitives en un clic");
  await page.getByRole("button", { name: "Objet", exact: true }).click();
  const positionInput = page.getByRole("spinbutton", {
    name: "Position X",
    exact: true,
  });
  await positionInput.fill("2.5");
  await positionInput.press("Enter");
  let current = await state();
  assert.equal(
    current.nodes.find((n) => n.id === current.selection[0]).position[0],
    2.5,
  );
  const past = current.past;
  await page.keyboard.press("Control+z");
  current = await state();
  assert.equal(current.past, past - 1);
  assert.equal(
    current.nodes.find((n) => n.id === current.selection[0]).position[0],
    0,
  );
  await page.keyboard.press("Control+Shift+z");
  current = await state();
  assert.equal(
    current.nodes.find((n) => n.id === current.selection[0]).position[0],
    2.5,
  );
  console.log("PASS: transformation numérique, une action, undo / redo");
  await page.evaluate(async () => {
    const { useEditor } = await import("/src/store/editor.ts");
    const { createPrimitive } = await import("/src/engine/geometry.ts");
    const s = useEditor.getState();
    const cube = createPrimitive("cube");
    s.loadDocument({ ...s.document, nodes: [cube] });
    s.select(cube.id);
  });
  await page.evaluate(async () => {
    window.__viewportEngine = (
      await import("/src/engine/ViewportEngine.ts")
    ).viewport.get();
    const s = window.__editorStore.getState();
    s.setTool("translate");
    s.focus("focus");
  });
  await page.waitForTimeout(1500);
  async function handle(mode) {
    await page.evaluate(
      (m) => window.__editorStore.getState().setTool(m),
      mode,
    );
    return page.evaluate(async () => {
      const T = await import("/node_modules/three/build/three.module.js");
      const e = window.__viewportEngine;
      e.camera.updateMatrixWorld(true);
      e.scene.updateMatrixWorld(true);
      e.gizmo.getHelper().updateMatrixWorld(true);
      const g = e.gizmo.getHelper().children[0],
        m = g.picker[e.gizmo.mode].children.find((o) => o.name === "X");
      const c = new T.Box3()
          .setFromObject(m)
          .getCenter(new T.Vector3())
          .project(e.camera),
        r = e.renderer.domElement.getBoundingClientRect();
      return {
        x: r.x + ((c.x + 1) * r.width) / 2,
        y: r.y + ((1 - c.y) * r.height) / 2,
        mode: e.gizmo.mode,
      };
    });
  }
  for (const mode of ["translate", "scale"]) {
    const h = await handle(mode);
    await page.mouse.move(h.x, h.y);
    assert.equal(
      await page.evaluate(() => window.__viewportEngine.gizmo.axis),
      "X",
    );
    const before = await page.evaluate(() => ({
      t: window.__editorStore.getState().document.nodes[0].transform,
      past: window.__editorStore.getState().past.length,
    }));
    await page.mouse.down();
    await page.mouse.move(h.x + 70, h.y, { steps: 8 });
    await page.mouse.up();
    const after = await page.evaluate(() => ({
      t: window.__editorStore.getState().document.nodes[0].transform,
      past: window.__editorStore.getState().past.length,
    }));
    assert.equal(after.past, before.past + 1);
    if (mode === "translate")
      assert.ok(after.t.position[0] > before.t.position[0] + 0.1);
    else assert.ok(Math.abs(after.t.scale[0] - before.t.scale[0]) > 0.1);
    await page.keyboard.press("Control+z");
  }
  await page.evaluate(() => window.__editorStore.getState().setTool("rotate"));
  const points = await page.evaluate(async () => {
    const T = await import("/node_modules/three/build/three.module.js");
    const e = window.__viewportEngine;
    e.camera.updateMatrixWorld(true);
    e.scene.updateMatrixWorld(true);
    e.gizmo.getHelper().updateMatrixWorld(true);
    const m = e.gizmo
        .getHelper()
        .children[0].picker.rotate.children.find((o) => o.name === "Z"),
      a = m.geometry.getAttribute("position"),
      r = e.renderer.domElement.getBoundingClientRect();
    const points = [];
    for (let i = 0; i < Math.min(a.count, 28); i++) {
      const v = new T.Vector3()
        .fromBufferAttribute(a, i)
        .applyMatrix4(m.matrixWorld)
        .project(e.camera);
      points.push({
        x: r.x + ((v.x + 1) * r.width) / 2,
        y: r.y + ((1 - v.y) * r.height) / 2,
      });
    }
    return points;
  });
  let chosen;
  for (let i = 2; i < points.length - 5; i += 2) {
    await page.mouse.move(points[i].x, points[i].y);
    if (
      (await page.evaluate(() => window.__viewportEngine.gizmo.axis)) === "Z"
    ) {
      chosen = i;
      break;
    }
  }
  assert.ok(chosen !== undefined, "Poignée Z de rotation trouvée");
  const rotationBefore = await page.evaluate(() => ({
    t: window.__editorStore.getState().document.nodes[0].transform,
    past: window.__editorStore.getState().past.length,
  }));
  await page.mouse.down();
  await page.mouse.move(points[chosen + 5].x, points[chosen + 5].y, {
    steps: 8,
  });
  await page.mouse.up();
  const rotationAfter = await page.evaluate(() => ({
    t: window.__editorStore.getState().document.nodes[0].transform,
    past: window.__editorStore.getState().past.length,
  }));
  assert.equal(rotationAfter.past, rotationBefore.past + 1);
  assert.ok(Math.abs(rotationAfter.t.rotation[2]) > 0.05);
  await page.keyboard.press("Control+z");
  console.log("PASS: rotation Z par glissement souris réel");
  const h = await handle("translate");
  await page.mouse.move(h.x, h.y);
  const before = await page.evaluate(() => ({
    t: window.__editorStore.getState().document.nodes[0].transform,
    past: window.__editorStore.getState().past.length,
  }));
  await page.mouse.down();
  await page.mouse.move(h.x + 70, h.y, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    t: window.__editorStore.getState().document.nodes[0].transform,
    past: window.__editorStore.getState().past.length,
  }));
  assert.deepEqual(after, before);
  console.log(
    "PASS: glissements souris réels translation/échelle, une action ; Escape restaure le geste sans historique",
  );

  await page.evaluate(() => window.__editorStore.getState().setTool("select"));
  await page
    .locator(".advanced-grid")
    .getByRole("button", { name: "Chanfrein", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__editorStore.getState().dialog === null &&
      window.__editorStore.getState().document.nodes[0].geometry.indices
        .length === 132,
    undefined,
    { timeout: 20000 },
  );
  current = await state();
  assert.equal(current.triangles[0], 44);
  console.log("PASS: chanfrein calculé dans un Web Worker");
  await page.evaluate(async () => {
    const { createPrimitive } = await import("/src/engine/geometry.ts");
    const s = window.__editorStore.getState(),
      plane = createPrimitive("plane");
    s.loadDocument({ ...s.document, nodes: [plane] });
    s.select(plane.id);
  });
  await page
    .locator(".advanced-grid")
    .getByRole("button", { name: "Spin", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__editorStore.getState().dialog === null &&
      window.__editorStore.getState().document.nodes[0].geometry.indices
        .length > 1000,
    undefined,
    { timeout: 20000 },
  );
  assert.equal((await state()).count, 1);
  console.log("PASS: Spin raccordé et soudé, pas de copies d’objets");
  await page.evaluate(async () => {
    const { createPrimitive } = await import("/src/engine/geometry.ts");
    const s = window.__editorStore.getState(),
      cube = createPrimitive("cube");
    s.loadDocument({ ...s.document, nodes: [cube] });
    s.select(cube.id);
    s.setMode("vertex");
    s.setComponents([0]);
  });
  await page.keyboard.press("Delete");
  let deleted = await state();
  assert.equal(deleted.count, 1);
  assert.ok(deleted.triangles[0] < 12);
  await page.keyboard.press("Control+z");
  assert.equal((await state()).triangles[0], 12);
  await page.evaluate(() => window.__editorStore.getState().setMode("object"));
  console.log(
    "PASS: suppression d’un sommet et de ses faces incidentes, annulable",
  );
  await page.evaluate(async () => {
    const { useEditor } = await import("/src/store/editor.ts");
    const { createPrimitive } = await import("/src/engine/geometry.ts");
    const s = useEditor.getState();
    const a = createPrimitive("cube");
    const b = createPrimitive("cube");
    b.transform.position[0] = 1;
    s.loadDocument({ ...s.document, nodes: [a, b] });
    s.select(a.id);
    s.select(b.id, true);
  });
  await page
    .locator(".boolean-tools")
    .getByRole("button", { name: "Union", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !window.__editorStore.getState().busy &&
      window.__editorStore.getState().document.nodes.length === 1,
    undefined,
    { timeout: 20000 },
  );
  assert.equal((await state()).nodes[0].name, "Union");
  console.log("PASS: booléenne réelle dans un Web Worker");
  const formats = await page.evaluate(async () => {
    const { useEditor } = await import("/src/store/editor.ts");
    const { sceneForExport, importModel } = await import("/src/engine/io.ts");
    const { GLTFExporter } =
      await import("/node_modules/three/examples/jsm/exporters/GLTFExporter.js");
    const { OBJExporter } =
      await import("/node_modules/three/examples/jsm/exporters/OBJExporter.js");
    const { STLExporter } =
      await import("/node_modules/three/examples/jsm/exporters/STLExporter.js");
    const { exportFBX } = await import("/src/engine/fbxExporter.ts");
    const { bytesToBase64 } = await import("/src/services/bridge.ts");
    const nodes = useEditor.getState().document.nodes;
    const scene = sceneForExport(nodes);
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
    const gltf = await new GLTFExporter().parseAsync(scene, { binary: false });
    const stl = new STLExporter().parse(scene, { binary: true });
    const obj = new OBJExporter().parse(scene);
    const fbx = exportFBX(nodes);
    const results = {};
    for (const [name, buffer] of [
      ["test.glb", glb],
      ["test.gltf", new TextEncoder().encode(JSON.stringify(gltf)).buffer],
      ["test.stl", stl.buffer],
      ["test.obj", new TextEncoder().encode(obj).buffer],
      ["test.fbx", new TextEncoder().encode(fbx).buffer],
    ]) {
      const imported = await importModel(buffer, name);
      results[name] = {
        meshes: imported.length,
        positions: imported[0].geometry.positions.length,
      };
    }
    return { results, glbBase64: bytesToBase64(glb) };
  });
  for (const result of Object.values(formats.results))
    assert.equal(result.meshes, 1);
  console.log(
    "PASS: GLB, GLTF, STL, OBJ et FBX relus après export",
    formats.results,
  );
  const model = Buffer.from(formats.glbBase64, "base64");
  server = createHttpServer(async (req, res) => {
    try {
      if (req.method === "POST") {
        let raw = "";
        for await (const part of req) raw += part;
        const data = JSON.parse(raw);
        if (req.url === "/image-to-3d") {
          assert.ok(data.image.startsWith("data:image/png;base64,"));
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "integration-test",
              status: "queued",
              progress: 0,
            }),
          );
        } else if (req.url === "/v1/chat/completions") {
          assert.ok(data.messages.some((m) => m.role === "user"));
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      message: "Le matériau est désormais en acier rouge.",
                      actions: [
                        {
                          type: "set_material",
                          target: "selection",
                          material: {
                            color: "#cc2222",
                            metalness: 1,
                            roughness: 0.23,
                            finish: "brushed",
                          },
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          );
        } else {
          res.statusCode = 404;
          res.end();
        }
      } else if (req.url === "/image-to-3d/integration-test") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: "succeeded",
            progress: 100,
            model_url: `http://localhost:${server.address().port}/model.glb`,
          }),
        );
      } else if (req.url === "/model.glb") {
        res.setHeader("Content-Type", "model/gltf-binary");
        res.end(model);
      } else {
        res.statusCode = 404;
        res.end();
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  originalSettings = await page.evaluate(async () => {
    const { bridge } = await import("/src/services/bridge.ts");
    return bridge.getSettings();
  });
  await page.evaluate(async (port) => {
    const { useAI } = await import("/src/store/ai.ts");
    const settings = structuredClone(useAI.getState().settings);
    settings.image = {
      ...settings.image,
      provider: "generic",
      endpoint: `http://localhost:${port}/image-to-3d`,
      apiKey: "",
      model: "integration-test",
    };
    settings.chat = {
      ...settings.chat,
      endpoint: `http://localhost:${port}/v1`,
      apiKey: "",
      model: "integration-test",
      review: false,
      vision: false,
    };
    await useAI.getState().saveSettings(settings);
  }, port);
  await page
    .getByRole("button", { name: "Assistant", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Photo → 3D", exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#d9e3c4";
    ctx.fillRect(0, 0, 64, 64);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Importer une photo pour l’IA").setInputFiles({
    name: "integration-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page
    .getByRole("button", { name: "Générer le modèle 3D", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      ["success", "error"].includes(
        window.__aiStore.getState().progress.status,
      ),
    undefined,
    { timeout: 40000 },
  );
  const generation = await page.evaluate(async () => {
    const { useAI } = await import("/src/store/ai.ts");
    return {
      progress: useAI.getState().progress,
      id: useAI.getState().generations[0]?.id,
    };
  });
  generatedId = generation.id;
  assert.equal(
    generation.progress.status,
    "success",
    generation.progress.error,
  );
  assert.equal((await state()).count, 2);
  console.log(
    "PASS: photo → tâche → suivi → téléchargement GLB → scène normalisée → galerie, via une API de test HTTP",
  );
  await page
    .locator(".ai-subtabs")
    .getByRole("button", { name: "Assistant", exact: true })
    .click();
  await page
    .getByLabel("Votre demande à l’assistant")
    .fill("Rends cet objet en acier brossé rouge");
  await page
    .getByRole("button", { name: "Envoyer la demande", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !window.__aiStore.getState().chatPending &&
      window.__aiStore.getState().messages.length >= 2,
    undefined,
    { timeout: 20000 },
  );
  current = await state();
  assert.equal(
    current.nodes.find((n) => n.id === current.selection[0]).color,
    "#cc2222",
  );
  assert.equal(
    current.nodes.find((n) => n.id === current.selection[0]).anisotropy,
    0.85,
  );
  assert.equal(
    current.nodes.find((n) => n.id === current.selection[0]).normalMap,
    true,
  );
  console.log(
    "PASS: endpoint OpenAI-compatible → action réelle → confirmation française",
  );
  await page.evaluate(async () => {
    const { useAI } = await import("/src/store/ai.ts");
    await useAI.getState().loadGeneration(useAI.getState().generations[0]);
  });
  assert.equal((await state()).count, 3);
  console.log(
    "PASS: rechargement réel de la galerie, modèle binaire chargé à la demande",
  );
  const capture = await page.evaluate(async () => {
    const { viewport } = await import("/src/engine/ViewportEngine.ts");
    const blob = await viewport.get().capture(1920, 1080, "image/png", false);
    const bitmap = await createImageBitmap(blob);
    return { w: bitmap.width, h: bitmap.height, bytes: blob.size };
  });
  assert.equal(capture.w, 1920);
  assert.equal(capture.h, 1080);
  assert.ok(capture.bytes > 10000);
  console.log("PASS: capture PNG réelle en 1920 × 1080", capture);
  await page.screenshot({ path: ".arena/smoke-final.png" });
  assert.deepEqual(errors, []);
  console.log("PASS: aucune erreur JavaScript non interceptée");
} finally {
  if (generatedId)
    await page
      .evaluate(async (id) => {
        const { useAI } = await import("/src/store/ai.ts");
        await useAI.getState().deleteGeneration(id);
      }, generatedId)
      .catch(() => {});
  if (originalSettings)
    await page
      .evaluate(async (settings) => {
        const { useAI } = await import("/src/store/ai.ts");
        await useAI.getState().saveSettings(settings);
      }, originalSettings)
      .catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  await browser.close();
  await application.close();
  await rm(directory, { recursive: true, force: true });
}
