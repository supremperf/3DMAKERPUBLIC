import { describe, expect, it } from "vitest";
import { parseTask } from "../src/services/imageAI";
import { abortable } from "../src/services/abort";
describe("Adaptation des fournisseurs image → 3D", () => {
  it("interprète les tâches Meshy et préfère le GLB", () => {
    const task = parseTask({
      result: "task-id",
      status: "SUCCEEDED",
      progress: 100,
      model_urls: {
        glb: "https://cdn.example.com/model.glb",
        gltf: "https://cdn.example.com/model.gltf",
      },
    });
    expect(task.taskId).toBe("task-id");
    expect(task.status).toBe("succeeded");
    expect(task.url).toMatch(/glb$/);
  });
  it("comprend les passerelles JSON génériques", () => {
    expect(
      parseTask({
        id: "a",
        state: "completed",
        download_url: "http://localhost:8000/model.glb",
      }).url,
    ).toContain("model.glb");
    expect(
      parseTask({ task_error: { message: "Reconstruction impossible" } }).error,
    ).toBe("Reconstruction impossible");
  });
  it("borne les valeurs de progression du fournisseur", () => {
    expect(parseTask({ progress: 500 }).progress).toBe(100);
    expect(parseTask({ progress: -50 }).progress).toBe(0);
  });
  it("annule immédiatement une attente sans attendre le serveur", async () => {
    const controller = new AbortController();
    const request = abortable(new Promise<string>(() => {}), controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
