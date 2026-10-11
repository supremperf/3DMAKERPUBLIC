import type { GeometryData, SceneNode } from "../types";
import {
  calculateJob,
  type GeometryJob,
  type AssistantJobResult,
} from "./calculations";
export type { GeometryJob, MeshOperation, MeshOptions } from "./calculations";
export function runGeometryJob<
  T extends GeometryData | SceneNode | AssistantJobResult,
>(job: GeometryJob, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted)
    return Promise.reject(new DOMException("Calcul annulé.", "AbortError"));
  if (typeof Worker === "undefined") return calculateJob(job) as Promise<T>;
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./geometry.worker.ts", import.meta.url),
      { type: "module", name: "3DMAKER · géométrie" },
    );
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Calcul annulé.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Le calcul dépasse cinq minutes. Réduisez la complexité du maillage.",
        ),
      );
    }, 300000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ result?: T; error?: string }>,
    ) => {
      cleanup();
      if (event.data.error || !event.data.result)
        reject(
          new Error(
            event.data.error || "Le calcul n’a retourné aucun résultat.",
          ),
        );
      else resolve(event.data.result);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(`Le moteur de calcul a échoué : ${event.message}`));
    };
    worker.postMessage(job);
  });
}
