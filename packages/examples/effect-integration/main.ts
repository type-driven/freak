import { HttpError, staticFiles } from "@fresh/core";
import { createEffectApp } from "@fresh/effect";
import { Cause, Layer } from "effect";
import { AppLayer } from "./services/layers.ts";
import { NotFoundError } from "./services/errors.ts";
import { TodoApi, TodosLive } from "./services/api.ts";

// Pre-compose TodosLive with AppLayer so TodoService is available inside
// group handlers. httpApi() merges groupLayers — without pre-composition,
// TodoService would not be in scope when TodosLive builds its handlers.
const TodosWithDeps = Layer.provide(TodosLive, AppLayer);

export const app = createEffectApp({
  layer: AppLayer,
  mapError: (cause) => {
    const defect = Cause.squash(cause as never);
    if (defect instanceof NotFoundError) {
      throw new HttpError(404);
    }
    throw new HttpError(500);
  },
})
  .httpApi("/api", TodoApi, TodosWithDeps)
  .use(staticFiles())
  .fsRoutes();
