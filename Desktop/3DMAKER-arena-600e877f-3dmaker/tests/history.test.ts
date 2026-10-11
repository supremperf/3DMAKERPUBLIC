import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "../src/store/editor";
import { DEFAULT_RENDER } from "../src/types";
beforeEach(() => {
  vi.stubGlobal("window", { setTimeout });
  useEditor.setState({
    document: {
      version: 1,
      name: "Test",
      nodes: [],
      render: { ...DEFAULT_RENDER },
    },
    past: [],
    future: [],
    selection: [],
    components: [],
    mode: "object",
    toasts: [],
  });
});
describe("Historique des documents", () => {
  it("annule et rétablit une création", () => {
    const s = useEditor.getState();
    s.addPrimitive("cube");
    expect(useEditor.getState().document.nodes).toHaveLength(1);
    s.undo();
    expect(useEditor.getState().document.nodes).toHaveLength(0);
    s.redo();
    expect(useEditor.getState().document.nodes).toHaveLength(1);
  });
  it("conserve exactement les 500 dernières actions", () => {
    for (let i = 0; i < 550; i++)
      useEditor
        .getState()
        .apply(`Action ${i}`, (d) => ({ ...d, name: String(i) }));
    expect(useEditor.getState().past).toHaveLength(500);
    for (let i = 0; i < 500; i++) useEditor.getState().undo();
    expect(useEditor.getState().document.name).toBe("49");
    expect(useEditor.getState().future).toHaveLength(500);
  });
  it("regroupe les prévisualisations numériques dans une transaction", () => {
    const s = useEditor.getState();
    s.beginTransaction();
    for (let i = 0; i < 20; i++)
      s.apply("Exposition", (d) => ({
        ...d,
        render: { ...d.render, exposure: i },
      }));
    expect(useEditor.getState().past).toHaveLength(0);
    s.endTransaction("Exposition");
    expect(useEditor.getState().past).toHaveLength(1);
    s.undo();
    expect(useEditor.getState().document.render.exposure).toBe(
      DEFAULT_RENDER.exposure,
    );
  });
  it("invalide le redo dès qu’une nouvelle action est réalisée", () => {
    const s = useEditor.getState();
    s.addPrimitive("cube");
    s.undo();
    s.addPrimitive("sphere");
    expect(useEditor.getState().future).toHaveLength(0);
  });
  it("préserve les objets verrouillés lors de la suppression", () => {
    const s = useEditor.getState();
    s.addPrimitive("cube");
    const n = useEditor.getState().document.nodes[0];
    s.patchNode(n.id, { locked: true });
    s.deleteSelected();
    expect(useEditor.getState().document.nodes).toHaveLength(1);
  });
});
