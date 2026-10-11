import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
const directory = await mkdtemp(join(tmpdir(), "3dmaker-simple-"));
process.env.THREEDMAKER_PREVIEW_DATA = directory;
let application, browser, fixture;
try {
  application = await createViteServer({
    server: { host: "0.0.0.0", port: 0, strictPort: false, allowedHosts: true },
    logLevel: "error",
  });
  await application.listen();
  const base = `http://localhost:${application.httpServer.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: process.env.CHROMIUM_ARGS_JSON
      ? JSON.parse(process.env.CHROMIUM_ARGS_JSON)
      : ["--enable-unsafe-swiftshader"],
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 940 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(
    async () => (await import("/src/store/ai.ts")).useAI.getState().loaded,
  );
  await page.evaluate(async () => {
    window.__editorStore = (await import("/src/store/editor.ts")).useEditor;
    window.__aiStore = (await import("/src/store/ai.ts")).useAI;
    window.__workspace = (await import("/src/store/workspace.ts")).useWorkspace;
    window.__viewportEngine = (
      await import("/src/engine/ViewportEngine.ts")
    ).viewport.get();
    window.__editorStore.getState().setRender({ shadows: false });
  });
  assert.equal(await page.locator(".simple-mode").count(), 1);
  assert.equal(await page.locator(".viewport-error").count(), 0);
  assert.equal(
    await page.locator(".scene-panel .tools-scroll").isVisible(),
    false,
  );
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page
    .locator(".creation-shapes")
    .getByRole("button", { name: /Sphère/ })
    .click();
  await page.waitForFunction(
    () => window.__editorStore.getState().document.nodes.length === 5,
  );
  await page
    .getByRole("button", { name: "Position et dimensions", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Position Y", exact: true })
    .fill("4");
  await page
    .getByRole("spinbutton", { name: "Position Y", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "Poser au sol", exact: true }).click();
  assert.ok(
    await page.evaluate(async () => {
      const { worldBounds } = await import("/src/engine/library.ts");
      const s = window.__editorStore.getState();
      return (
        Math.abs(
          worldBounds(s.document.nodes.find((n) => n.id === s.selection[0])).min
            .y,
        ) < 1e-5
      );
    }),
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Position Y"]').value === "4",
  );
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "Position Y", exact: true })
      .inputValue(),
    "4",
  );
  console.log(
    "PASS: interface Simple, ajout, coordonnées, poser au sol et annulation",
  );
  await page.keyboard.press("Control+k");
  await page.getByLabel("Rechercher une commande").fill("centrer");
  await page.getByLabel("Rechercher une commande").press("Enter");
  await page.waitForFunction(
    () => window.__editorStore.getState().dialog === null,
  );
  await page.keyboard.press("F10");
  assert.equal(await page.locator(".scene-panel").isVisible(), false);
  await page.keyboard.press("F10");
  assert.equal(await page.locator(".scene-panel").isVisible(), true);
  await page.getByRole("button", { name: "Simple", exact: true }).click();
  assert.equal(await page.locator(".expert-mode").count(), 1);
  await page.getByRole("button", { name: "Expert", exact: true }).click();
  console.log(
    "PASS: palette Ctrl K, mode concentration et bascule Expert / Simple",
  );
  await page.getByRole("button", { name: "Fond", exact: true }).first().click();
  await page.getByRole("button", { name: "Couleur", exact: true }).click();
  await page.getByRole("button", { name: "Fond Blanc", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => window.__editorStore.getState().document.render.background,
    ),
    "#eef0f3",
  );
  await page.getByRole("button", { name: "Dégradé", exact: true }).click();
  await page.getByRole("button", { name: "Fond Océan", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => window.__viewportEngine.scene.background.isDataTexture,
    ),
    true,
  );
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    const x = c.getContext("2d");
    x.fillStyle = "#336699";
    x.fillRect(0, 0, 200, 100);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .getByLabel("Importer une image de fond")
    .setInputFiles({
      name: "fond.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await page.waitForFunction(
    () =>
      window.__viewportEngine.scene.background?.isTexture &&
      window.__editorStore.getState().document.render.backgroundImage,
  );
  const background = await page.evaluate(async () => {
    await window.__viewportEngine.scene.background?.image?.decode?.();
    const texture = window.__viewportEngine.scene.background;
    return {
      image: window.__editorStore.getState().document.render.backgroundImage,
      repeat: texture.repeat.toArray(),
      offset: texture.offset.toArray(),
    };
  });
  assert.ok(background.image.startsWith("data:image/png;base64,"));
  assert.ok(background.repeat[0] <= 1 && background.repeat[1] <= 1);
  await page.getByRole("button", { name: "HDR", exact: true }).click();
  await page
    .locator(".background-panel")
    .getByRole("button", { name: "Nuit", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.__viewportEngine.scene.background ===
        window.__viewportEngine.scene.environment &&
      !!window.__viewportEngine.scene.environment,
  );
  console.log("PASS: fonds couleur, dégradé, photo importée et HDR réel");
  await page.evaluate(async () => {
    const { createAsset, placeAlongside } =
      await import("/src/engine/library.ts");
    const s = window.__editorStore.getState();
    s.addNodes(
      placeAlongside(createAsset("robot"), s.document.nodes),
      "Créer Robot",
    );
    s.focus("focus");
  });
  const libraryCount = await page.evaluate(
    () => window.__editorStore.getState().document.nodes.length,
  );
  assert.equal(libraryCount, 23);
  await page.keyboard.press("Control+z");
  assert.equal(
    await page.evaluate(
      () => window.__editorStore.getState().document.nodes.length,
    ),
    5,
  );
  await page.keyboard.press("Control+Shift+z");
  assert.equal(
    await page.evaluate(
      () => window.__editorStore.getState().document.nodes.length,
    ),
    23,
  );
  console.log(
    "PASS: bibliothèque locale de vrais maillages, ajout en une transaction et undo / redo",
  );
  const alpha = await page.evaluate(async () => {
    const engine = window.__viewportEngine,
      blob = await engine.capture(
        640,
        480,
        "image/png",
        false,
        undefined,
        true,
      ),
      bitmap = await createImageBitmap(blob),
      c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const x = c.getContext("2d");
    x.drawImage(bitmap, 0, 0);
    const pixels = x.getImageData(0, 0, 640, 480).data;
    let transparent = 0,
      opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) transparent++;
      if (pixels[i] > 250) opaque++;
    }
    bitmap.close();
    return {
      transparent,
      opaque,
      corners: [
        pixels[3],
        pixels[(640 - 1) * 4 + 3],
        pixels[640 * (480 - 1) * 4 + 3],
        pixels[(640 * 480 - 1) * 4 + 3],
      ],
      backgroundRestored: !!engine.scene.background,
      destroyed: engine.destroyed,
      backgroundMode:
        window.__editorStore.getState().document.render.backgroundMode,
      camera: engine.camera.position.toArray(),
      grid: engine.grid.visible,
      clear: engine.renderer.getClearAlpha(),
    };
  });
  console.log("Capture alpha :", alpha);
  assert.ok(alpha.corners.includes(0));
  assert.ok(alpha.transparent > 10000);
  assert.ok(alpha.opaque > 100);
  assert.equal(alpha.backgroundRestored, true);
  console.log(
    "PASS: capture PNG avec alpha réellement transparent et objets opaques",
    alpha,
  );
  let inferenceRequests = 0,
    visionReceived = false;
  fixture = createHttpServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    let raw = "";
    for await (const part of req) raw += part;
    const data = JSON.parse(raw);
    const user = data.messages?.at(-1)?.content;
    const isTest =
      typeof user === "string" && user.startsWith("Test de connexion");
    if (isTest) inferenceRequests++;
    else
      visionReceived =
        Array.isArray(user) &&
        user.some(
          (p) =>
            p.type === "image_url" &&
            p.image_url?.url.startsWith("data:image/jpeg;base64,"),
        );
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                message: isTest
                  ? "Connexion établie"
                  : "Je propose de colorer les objets sélectionnés.",
                actions: isTest
                  ? []
                  : [
                      {
                        type: "set_material",
                        target: "selection",
                        material: { color: "#8844cc" },
                      },
                    ],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  await page.evaluate(async (port) => {
    const ai = window.__aiStore.getState();
    await ai.saveSettings({
      ...ai.settings,
      chat: {
        ...ai.settings.chat,
        endpoint: `http://127.0.0.1:${port}/v1`,
        apiKey: "",
        model: "missing-model",
        review: true,
        vision: true,
      },
    });
  }, fixture.address().port);
  await page
    .getByRole("button", { name: "Assistant", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Configurer le modèle de chat", exact: true })
    .click();
  await page.getByRole("button", { name: "Détecter", exact: true }).click();
  await page.waitForFunction(
    () => window.__aiStore.getState().settings.chat.model === "fixture-model",
  );
  assert.equal(
    await page.getByLabel("Nom du modèle de chat").inputValue(),
    "fixture-model",
  );
  await page.getByRole("button", { name: "Tester l’IA", exact: true }).click();
  await page.waitForFunction(
    () => window.__aiStore.getState().connection === "ready",
  );
  assert.equal(inferenceRequests, 1);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForFunction(
    () => window.__editorStore.getState().dialog === null,
  );
  await page.evaluate(() => {
    const s = window.__editorStore.getState();
    s.select(s.document.nodes.find((n) => n.kind === "mesh").id);
  });
  const originalColor = await page.evaluate(
    () =>
      window.__editorStore
        .getState()
        .document.nodes.find(
          (n) => n.id === window.__editorStore.getState().selection[0],
        ).material.color,
  );
  await page
    .getByLabel("Votre demande à l’assistant")
    .fill("Colorie ma sélection en violet");
  await page
    .getByRole("button", { name: "Envoyer la demande", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !!window.__aiStore.getState().proposal ||
      !!window.__aiStore.getState().chatError,
    undefined,
    { timeout: 60000 },
  );
  assert.equal(
    await page.evaluate(() => window.__aiStore.getState().chatError),
    null,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__editorStore
          .getState()
          .document.nodes.find(
            (n) => n.id === window.__editorStore.getState().selection[0],
          ).material.color,
    ),
    originalColor,
  );
  assert.equal(visionReceived, true);
  await page
    .getByRole("button", { name: "Appliquer le plan", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () =>
        window.__editorStore
          .getState()
          .document.nodes.find(
            (n) => n.id === window.__editorStore.getState().selection[0],
          ).material.color,
    ),
    "#8844cc",
  );
  await page.keyboard.press("Control+z");
  assert.equal(
    await page.evaluate(
      () =>
        window.__editorStore
          .getState()
          .document.nodes.find(
            (n) => n.id === window.__editorStore.getState().selection[0],
          ).material.color,
    ),
    originalColor,
  );
  console.log(
    "PASS: vraie requête de test, chat multimodal HTTP de test, proposition sans mutation, confirmation et annulation",
  );
  await page.getByLabel("Votre demande à l’assistant").fill("Refais le violet");
  await page
    .getByRole("button", { name: "Envoyer la demande", exact: true })
    .click();
  await page.waitForFunction(
    () => !!window.__aiStore.getState().proposal,
    undefined,
    { timeout: 60000 },
  );
  await page.evaluate(() =>
    window.__editorStore.getState().setRender({ grid: false }),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Appliquer le plan", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Ignorer", exact: true }).click();
  console.log(
    "PASS: une proposition périmée ne peut pas écraser une scène modifiée",
  );
  assert.deepEqual(errors, []);
  await mkdir(".arena", { recursive: true });
  await page.screenshot({ path: ".arena/simple-workflow.png" });
  console.log(
    "PASS: aucune erreur JavaScript non interceptée dans le nouveau mode Simple",
  );
} finally {
  await browser?.close();
  if (fixture) await new Promise((resolve) => fixture.close(resolve));
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
