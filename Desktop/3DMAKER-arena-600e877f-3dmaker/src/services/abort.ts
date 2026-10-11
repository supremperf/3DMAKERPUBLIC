/** Arrête immédiatement l’attente locale ; une tâche reçue par le fournisseur n’est pas supprimée. */
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(new DOMException("Opération annulée.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Opération annulée.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (!signal.aborted) resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        if (!signal.aborted) reject(error);
      },
    );
  });
}
