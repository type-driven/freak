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

const effectApp = createEffectApp({
  layer: AppLayer,
  mapError: (cause) => {
    const defect = Cause.squash(cause as never);
    if (defect instanceof NotFoundError) {
      throw new HttpError(404);
    }
    throw new HttpError(500);
  },
});

// Mount HttpApi — returns this but called as a statement since rpc() returns void
effectApp.httpApi("/api", TodoApi, TodosWithDeps);

// Mount RPC — HTTP protocol for request/response (ListTodos, CreateTodo, DeleteTodo)
effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos",
  protocol: "http",
  handlerLayer: RpcWithDeps,
});

// Mount RPC — WebSocket protocol for streaming (WatchTodos)
effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos/ws",
  protocol: "websocket",
  handlerLayer: RpcWithDeps,
});

// Mount RPC — HTTP-stream protocol (WatchTodos over framed NDJSON POST)
effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos/stream",
  protocol: "http-stream",
  handlerLayer: RpcWithDeps,
});

// Mount RPC — SSE protocol (WatchTodos via Server-Sent Events)
effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos/sse",
  protocol: "sse",
  handlerLayer: RpcWithDeps,
});

export const app = effectApp
  .use(staticFiles())
  .fsRoutes();
