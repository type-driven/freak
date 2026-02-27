import { HttpError, staticFiles } from "@fresh/core";
import { createEffectApp } from "@fresh/effect";
import { Cause, Layer } from "effect";
import { AppLayer } from "./services/layers.ts";
import { NotFoundError } from "./services/errors.ts";
import { TodoApi, TodosLive } from "./services/api.ts";
import { TodoRpc, TodoRpcHandlers } from "./services/rpc.ts";

// Pre-compose handler layers with AppLayer so service dependencies are available
// when group/handler builds run inside the Effect sub-handler.
const TodosWithDeps = Layer.provide(TodosLive, AppLayer);
const RpcWithDeps = Layer.provide(TodoRpcHandlers, AppLayer);

const app = createEffectApp({
  layer: AppLayer,
  mapError: (cause) => {
    const defect = Cause.squash(cause as never);
    if (defect instanceof NotFoundError) {
      throw new HttpError(404);
    }
    throw new HttpError(500);
  },
});

// Mount HttpApi — app.httpApi() returns this, but we call it as a statement
// since rpc() returns void and can't be chained.
app.httpApi("/api", TodoApi, TodosWithDeps);

// Mount RPC — HTTP protocol for request/response (ListTodos, CreateTodo, DeleteTodo)
app.rpc({
  group: TodoRpc,
  path: "/rpc/todos",
  protocol: "http",
  handlerLayer: RpcWithDeps,
});

// Mount RPC — WebSocket protocol for streaming (WatchTodos)
app.rpc({
  group: TodoRpc,
  path: "/rpc/todos/ws",
  protocol: "websocket",
  handlerLayer: RpcWithDeps,
});

// Continue with Fresh middleware and file-system routes
app.use(staticFiles()).fsRoutes();

// Re-export as named export for Fresh's dev server (same shape as before)
export { app };
