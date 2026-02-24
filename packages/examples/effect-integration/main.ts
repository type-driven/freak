import { App, staticFiles } from "@fresh/core";
import { effectPlugin } from "@fresh/plugin-effect";
import { AppLayer } from "./services/layers.ts";

export const app = new App()
  .use(staticFiles())
  .use(effectPlugin({
    layer: AppLayer,
  }))
  .fsRoutes();
