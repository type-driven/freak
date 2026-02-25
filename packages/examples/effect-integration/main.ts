import { HttpError, staticFiles } from "@fresh/core";
import { createEffectApp } from "@fresh/effect";
import { Cause } from "effect";
import { AppLayer } from "./services/layers.ts";
import { NotFoundError } from "./services/errors.ts";

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
  .use(staticFiles())
  .fsRoutes();
