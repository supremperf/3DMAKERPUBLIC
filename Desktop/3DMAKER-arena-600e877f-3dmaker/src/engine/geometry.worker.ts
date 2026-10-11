import { calculateJob, type GeometryJob } from "./calculations";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GeometryJob>) => void) | null;
  postMessage(value: unknown): void;
};
scope.onmessage = (event) => {
  void calculateJob(event.data)
    .then((result) => scope.postMessage({ result }))
    .catch((error) =>
      scope.postMessage({
        error:
          error instanceof Error
            ? error.message
            : "Le calcul géométrique a échoué.",
      }),
    );
};
