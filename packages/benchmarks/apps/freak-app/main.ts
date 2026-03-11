import { createEffectApp } from "@fresh/core/effect";
import { staticFiles } from "@fresh/core";
import { TodoLayer } from "./services/TodoService.ts";

const effectApp = createEffectApp({ layer: TodoLayer });

export const app = effectApp.use(staticFiles()).fsRoutes().app;
