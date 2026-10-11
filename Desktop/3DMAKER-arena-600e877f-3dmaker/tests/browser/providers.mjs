import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer as createViteServer } from "vite";

// Les API cloud sont redirigées vers ces fixtures HTTP uniquement dans ce scénario.
// Le code applicatif, les URLs affichées, le pont et la validation de scène restent réels.
const directory = await mkdtemp(join(tmpdir(), "3dmaker-providers-"));
process.env.THREEDMAKER_PREVIEW_DATA = directory;
const originalFetch = globalThis.fetch;
let application, browser, fixture;
const calls = [];
try {
  fixture = createHttpServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const url = new URL(req.url, "http://fixture");
      const claude = url.pathname.startsWith("/anthropic/");
      if (claude) {
        assert.equal(req.headers["x-api-key"], "fixture-claude-not-a-real-key");
        assert.equal(req.headers["anthropic-version"], "2023-06-01");
        assert.equal(req.headers.authorization, undefined);
      } else {
        assert.equal(
          req.headers.authorization,
          "Bearer fixture-venice-not-a-real-key",
        );
        assert.equal(req.headers["x-api-key"], undefined);
      }
      if (req.method === "GET") {
        calls.push({
          provider: claude ? "claude" : "venice",
          method: "GET",
          url: req.url,
        });
        if (claude) {
          assert.equal(url.searchParams.get("limit"), "100");
          const more = !url.searchParams.has("after_id");
          res.end(
            JSON.stringify({
              data: more
                ? [
                    {
                      id: "claude-opus-5-5",
                      max_tokens: 4096,
                      capabilities: { image_input: { supported: true } },
                    },
                  ]
                : [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-5-5" }],
              has_more: more,
              last_id: more ? "claude-opus-5-5" : "claude-haiku-5-5",
            }),
          );
        } else {
          assert.equal(url.searchParams.get("type"), "text");
          res.end(
            JSON.stringify({
              data: [
                {
                  id: "fixture-vision",
                  type: "text",
                  model_spec: {
                    traits: ["default"],
                    maxCompletionTokens: 4096,
                    capabilities: {
                      supportsVision: true,
                      supportsResponseSchema: true,
                    },
                  },
                },
                {
                  id: "fixture-text",
                  type: "text",
                  model_spec: {
                    maxCompletionTokens: 4096,
                    capabilities: {
                      supportsVision: false,
                      supportsResponseSchema: false,
                    },
                  },
                },
                {
                  id: "fixture-offline",
                  type: "text",
                  model_spec: { offline: true },
                },
              ],
            }),
          );
        }
        return;
      }
      let raw = "";
      for await (const part of req) raw += part;
      const data = JSON.parse(raw),
        last = data.messages.at(-1).content;
      const text =
        typeof last === "string"
          ? last
          : last.find((p) => p.type === "text")?.text;
      const isTest = text.startsWith("Test de connexion");
      const vision =
        Array.isArray(last) &&
        last.some((p) =>
          claude
            ? p.type === "image" &&
              p.source.type === "base64" &&
              p.source.media_type === "image/jpeg" &&
              p.source.data.length > 1000
            : p.type === "image_url" &&
              p.image_url.url.startsWith("data:image/jpeg;base64,"),
        );
      calls.push({
        provider: claude ? "claude" : "venice",
        method: "POST",
        isTest,
        vision,
        model: data.model,
      });
      const plan = {
        message: "Plan de test reçu, à valider.",
        actions: isTest
          ? []
          : [
              {
                type: "set_material",
                target: "selection",
                material: { color: claude ? "#ee8833" : "#4488cc" },
              },
            ],
      };
      if (claude) {
        assert.equal(url.pathname, "/anthropic/v1/messages");
        assert.ok(
          data.system.includes("3DMAKER") || data.system.includes("3dmaker"),
        );
        assert.equal(
          data.messages.some((m) => m.role === "system"),
          false,
        );
        assert.equal(data.tool_choice.name, "proposer_plan_3dmaker");
        assert.equal(data.tools[0].name, "proposer_plan_3dmaker");
        for (const key of [
          "response_format",
          "reasoning_effort",
          "temperature",
          "max_completion_tokens",
        ])
          assert.equal(data[key], undefined);
        assert.ok(data.max_tokens <= 4096);
        res.end(
          JSON.stringify({
            type: "message",
            role: "assistant",
            stop_reason: "tool_use",
            content: [
              { type: "tool_use", name: "proposer_plan_3dmaker", input: plan },
            ],
          }),
        );
      } else {
        assert.equal(url.pathname, "/venice/api/v1/chat/completions");
        assert.equal(
          data.venice_parameters.include_venice_system_prompt,
          false,
        );
        assert.equal(data.venice_parameters.strip_thinking_response, true);
        assert.equal(data.venice_parameters.enable_web_search, "off");
        assert.ok(data.max_completion_tokens <= 4096);
        if (data.model === "fixture-text") {
          assert.equal(vision, false);
          assert.equal(data.response_format, undefined);
        }
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(plan) },
              },
            ],
          }),
        );
      }
    } catch (error) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({ error: { message: `Fixture: ${error.message}` } }),
      );
    }
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  globalThis.fetch = (input, options) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname === "api.anthropic.com")
      return originalFetch(
        `${origin}/anthropic${url.pathname}${url.search}`,
        options,
      );
    if (url.hostname === "api.venice.ai")
      return originalFetch(
        `${origin}/venice${url.pathname}${url.search}`,
        options,
      );
    if (url.hostname === "api.openai.com")
      throw new Error(
        "Ce scénario ne doit appeler aucun autre fournisseur cloud.",
      );
    return originalFetch(input, options);
  };
  application = await createViteServer({
    server: { host: "0.0.0.0", port: 0, strictPort: false, allowedHosts: true },
    logLevel: "error",
  });
  await application.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: process.env.CHROMIUM_ARGS_JSON
      ? JSON.parse(process.env.CHROMIUM_ARGS_JSON)
      : ["--enable-unsafe-swiftshader"],
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 940 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://localhost:${application.httpServer.address().port}`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    async () => (await import("/src/store/ai.ts")).useAI.getState().loaded,
  );
  await page.evaluate(async () => {
    window.editor = (await import("/src/store/editor.ts")).useEditor;
    window.ai = (await import("/src/store/ai.ts")).useAI;
    const s = window.editor.getState();
    s.setRender({ shadows: false, antialias: false });
    s.select(s.document.nodes.find((n) => n.kind === "mesh").id);
  });
  await page
    .getByRole("button", { name: "Assistant", exact: true })
    .first()
    .click();
  const configure = () =>
    page
      .getByRole("button", {
        name: "Configurer le modèle de chat",
        exact: true,
      })
      .click();
  const ready = () =>
    page.waitForFunction(() => window.ai.getState().connection === "ready");
  const save = async () => {
    await page
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await page.waitForFunction(() => window.editor.getState().dialog === null);
  };
  await configure();
  await page.getByLabel("Service IA préconfiguré").selectOption("claude-opus");
  assert.equal(await page.getByLabel("Clé API de chat").inputValue(), "");
  assert.equal(
    await page
      .getByRole("button", { name: "Tester l’IA", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel("Clé API de chat")
    .fill("fixture-claude-not-a-real-key");
  await page
    .getByLabel("Service IA préconfiguré")
    .selectOption("claude-sonnet");
  assert.equal(
    await page.getByLabel("Clé API de chat").inputValue(),
    "fixture-claude-not-a-real-key",
  );
  await page.getByLabel("Service IA préconfiguré").selectOption("claude-haiku");
  assert.equal(
    await page.getByLabel("Nom du modèle de chat").inputValue(),
    "claude-haiku-5-5",
  );
  await page.getByLabel("Service IA préconfiguré").selectOption("claude-opus");
  await page.getByRole("button", { name: "Détecter", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("#chat-models option").length === 3,
  );
  await page.getByRole("button", { name: "Tester l’IA", exact: true }).click();
  await ready();
  await save();
  assert.equal(
    calls.filter((call) => call.provider === "claude" && call.method === "GET")
      .length,
    2,
  );
  console.log(
    "PASS: presets Claude Opus/Sonnet/Haiku, clé conservée dans la famille, catalogue paginé et test natif HTTP",
  );
  const color = () =>
    page.evaluate(() => {
      const s = window.editor.getState();
      return s.document.nodes.find((n) => n.id === s.selection[0]).material
        .color;
    });
  const originalColor = await color();
  const send = async (text) => {
    await page.getByLabel("Votre demande à l’assistant").fill(text);
    await page
      .getByRole("button", { name: "Envoyer la demande", exact: true })
      .click();
    await page.waitForFunction(
      () => !!window.ai.getState().proposal || !!window.ai.getState().chatError,
      undefined,
      { timeout: 60000 },
    );
    assert.equal(
      await page.evaluate(() => window.ai.getState().chatError),
      null,
    );
  };
  await send("Propose de rendre le cube orange.");
  assert.equal(await color(), originalColor);
  await page
    .getByRole("button", { name: "Appliquer le plan", exact: true })
    .click();
  assert.equal(await color(), "#ee8833");
  await page.keyboard.press("Control+z");
  assert.equal(await color(), originalColor);
  assert.equal(
    calls.some(
      (call) => call.provider === "claude" && !call.isTest && call.vision,
    ),
    true,
  );
  console.log(
    "PASS: vue JPEG native Claude, tool_use validé dans le worker, confirmation et annulation d’un vrai matériau",
  );

  await configure();
  await page.getByLabel("Service IA préconfiguré").selectOption("venice");
  assert.equal(await page.getByLabel("Clé API de chat").inputValue(), "");
  assert.equal(
    await page
      .getByRole("button", { name: "Tester l’IA", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel("Clé API de chat")
    .fill("fixture-venice-not-a-real-key");
  await page.getByRole("button", { name: "Détecter", exact: true }).click();
  await page.waitForFunction(
    () => window.ai.getState().settings.chat.model === "fixture-vision",
  );
  assert.equal(await page.locator("#chat-models option").count(), 2);
  await page.getByRole("button", { name: "Tester l’IA", exact: true }).click();
  await ready();
  await page
    .getByRole("switch", {
      name: "Joindre une vue de la scène au modèle",
      exact: true,
    })
    .click();
  await save();
  await send("Propose un matériau bleu.");
  assert.equal(await color(), originalColor);
  await page
    .getByRole("button", { name: "Appliquer le plan", exact: true })
    .click();
  assert.equal(await color(), "#4488cc");
  await page.keyboard.press("Control+z");
  assert.equal(await color(), originalColor);
  assert.equal(
    calls.some(
      (call) => call.provider === "venice" && !call.isTest && call.vision,
    ),
    true,
  );
  console.log(
    "PASS: Venice, clé propre au fournisseur, catalogue textuel, trait default, JPEG OpenAI-compatible, confirmation et undo",
  );

  await configure();
  await page.getByLabel("Nom du modèle de chat").fill("fixture-text");
  assert.equal(
    await page
      .getByRole("switch", {
        name: "Joindre une vue de la scène au modèle",
        exact: true,
      })
      .getAttribute("aria-checked"),
    "false",
  );
  await page
    .getByRole("button", { name: "Réglages du serveur", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("switch", { name: "Réponse JSON structurée", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  await page.getByRole("button", { name: "Tester l’IA", exact: true }).click();
  await ready();
  await save();
  await send("Propose le bleu sans image.");
  await page.getByRole("button", { name: "Ignorer", exact: true }).click();
  assert.equal(await color(), originalColor);
  console.log(
    "PASS: un modèle Venice sans vision/schéma désactive ces options, répond en JSON texte et peut être ignoré sans mutation",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    async () => (await import("/src/store/ai.ts")).useAI.getState().loaded,
  );
  assert.deepEqual(
    await page.evaluate(async () => {
      const chat = (await import("/src/store/ai.ts")).useAI.getState().settings
        .chat;
      return {
        protocol: chat.protocol,
        model: chat.model,
        endpoint: chat.endpoint,
      };
    }),
    {
      protocol: "openai",
      model: "fixture-text",
      endpoint: "https://api.venice.ai/api/v1",
    },
  );
  assert.deepEqual(errors, []);
  await mkdir(".arena", { recursive: true });
  await page.screenshot({ path: ".arena/providers-workflow.png" });
  console.log(
    "PASS: paramètres persistants, aucune erreur JavaScript et aucune requête d’inférence cloud réelle",
  );
} finally {
  await browser?.close();
  await application?.close();
  globalThis.fetch = originalFetch;
  if (fixture) await new Promise((resolve) => fixture.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
