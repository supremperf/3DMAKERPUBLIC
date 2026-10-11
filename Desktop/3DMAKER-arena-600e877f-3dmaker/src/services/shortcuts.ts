import { useWorkspace } from "../store/workspace";
import { useEditor } from "../store/editor";
import { handleImport, saveProject } from "../engine/io";
import { viewport } from "../engine/ViewportEngine";
let lastMode: "vertex" | "edge" | "face" = "face";
export function installShortcuts(): () => void {
  const handler = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target?.closest('input, textarea, select, [contenteditable="true"]'))
      return;
    const s = useEditor.getState();
    if (s.dialog) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const run = (action: () => void) => {
      event.preventDefault();
      action();
    };
    if (viewport.get()?.transforming) {
      if (key === "escape" || (ctrl && key === "z"))
        run(() => {
          viewport.get()?.cancelTransform();
        });
      else if (ctrl) event.preventDefault();
      return;
    }
    if (ctrl) {
      if (key === "k") run(() => s.openDialog("commands"));
      else if (key === "s") run(() => void saveProject());
      else if (key === "o" || key === "i") run(() => void handleImport());
      else if (key === "n")
        run(() => {
          if (
            s.document === s.savedDocument ||
            confirm(
              "Créer une nouvelle scène ? L’ancienne reste accessible avec Annuler.",
            )
          )
            s.newDocument();
        });
      else if (key === "e") run(() => s.openDialog("export"));
      else if (key === "z")
        run(() => {
          if (!viewport.get()?.cancelTransform())
            (event.shiftKey ? s.redo : s.undo)();
        });
      else if (key === "y") run(s.redo);
      else if (event.code === "Numpad1") run(() => s.focus("back"));
      else if (key === "a") run(s.selectAll);
      else if (key === "j") run(s.mergeSelected);
      return;
    }
    if (event.altKey) return;
    if (viewport.get()?.transforming) {
      if (key === "escape")
        run(() => {
          viewport.get()?.cancelTransform();
        });
      return;
    }
    if (key === "tab")
      run(() => {
        if (event.shiftKey) useEditor.setState({ snap: !s.snap });
        else {
          if (s.mode !== "object") lastMode = s.mode;
          s.setMode(s.mode === "object" ? lastMode : "object");
        }
      });
    else if (key === "escape")
      run(() => {
        if (s.tool === "measure" && s.measurement.length)
          useEditor.setState({ measurement: [] });
        else if (s.components.length) s.setComponents([]);
        else {
          s.select(null);
          s.setTool("select");
        }
      });
    else if (key === "delete" || key === "backspace") run(s.deleteSelected);
    else if (key === "d" && event.shiftKey) run(s.duplicateSelected);
    else if (key === "f") run(() => s.focus("focus"));
    else if (key === "home") run(() => s.focus("all"));
    else if (key === "g")
      run(() => s.setRender({ grid: !s.document.render.grid }));
    else if (key === "m") run(() => s.setTool("measure"));
    else if (key === "v") run(() => s.setTool("select"));
    else if (key === "w") run(() => s.setTool("translate"));
    else if (key === "e") run(() => s.setTool("rotate"));
    else if (key === "r") run(() => s.setTool("scale"));
    else if (event.code === "Numpad1") run(() => s.focus("front"));
    else if (event.code === "Numpad3") run(() => s.focus("right"));
    else if (event.code === "Numpad7") run(() => s.focus("top"));
    else if (event.code === "Numpad5")
      run(() => {
        const engine = viewport.get();
        if (engine)
          engine.setProjection(
            "isPerspectiveCamera" in engine.camera
              ? "orthographic"
              : "perspective",
          );
      });
    else if (["1", "2", "3"].includes(key))
      run(() =>
        s.setMode(
          ({ "1": "vertex", "2": "edge", "3": "face" } as const)[
            key as "1" | "2" | "3"
          ],
        ),
      );
    else if (key === "x" || key === "y" || key === "z")
      run(() => {
        if (key === "z" && s.tool === "select")
          s.setRender({ wireframe: !s.document.render.wireframe });
        else useEditor.setState({ axisLock: s.axisLock === key ? null : key });
      });
    else if (key === "?") run(() => s.openDialog("help"));
    else if (key === "/")
      run(() =>
        (
          document.querySelector(".scene-search input") as HTMLInputElement
        )?.focus(),
      );
    else if (key === "f10") run(() => useWorkspace.getState().toggleFocus());
    else if (key === "f11")
      run(() => {
        if (window.desktop) void window.desktop.setFullscreen();
        else
          void (
            document.fullscreenElement
              ? document.exitFullscreen()
              : document.documentElement.requestFullscreen()
          ).catch(() => s.notify("Le plein écran n’est pas autorisé.", "info"));
      });
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
