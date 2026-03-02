# freak

**Fresh 2 + Effect-TS.** A fork of [@fresh/core](https://jsr.io/@fresh/core)
that adds first-class [Effect](https://effect.website/) integration for typed
services, structured errors, and full-stack RPC.

## Packages

| Package                                                       | Description                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@fresh/core`](./packages/fresh/)                            | Fresh 2 framework (forked)                                                          |
| [`@fresh/effect`](./packages/effect/)                         | Effect integration — `createEffectApp`, HTTP API, RPC, atom hydration, client hooks |
| [`@fresh/plugin-effect`](./packages/plugin-effect/)           | Re-export shim (backward compat — prefer `@fresh/effect`)                           |
| [`@fresh/plugin-tailwindcss`](./packages/plugin-tailwindcss/) | Tailwind CSS v4 plugin                                                              |

## Getting started

```sh
# Clone and run the example app
git clone https://github.com/type-driven/freak
cd freak
deno task --cwd packages/examples/effect-integration dev
```

## Usage

### 1. Create the app

```ts
// main.ts
import { createEffectApp } from "@fresh/effect";
import { staticFiles } from "@fresh/core";
import { AppLayer } from "./layers.ts";

const app = createEffectApp({ layer: AppLayer });

export const appInstance = app
  .use(staticFiles())
  .fsRoutes();
```

`createEffectApp({ layer })` creates a `ManagedRuntime` from your Layer and:

- Registers an `EffectRunner` so any handler can return an `Effect` directly
- Wires atom hydration automatically (no manual `setAtomHydrationHook` needed)
- Registers SIGINT/SIGTERM signal handlers for clean disposal

### 2. Effect-returning handlers

```ts
// routes/todos.ts
import { createEffectDefine } from "@fresh/effect";
import { Effect } from "effect";
import { TodoService } from "../services/TodoService.ts";

const define = createEffectDefine<unknown, TodoService>();

export const handlers = define.handlers({
  GET: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      return Response.json(todos);
    }),
});
```

Plain handlers (`Response`, `PageResponse`, `Promise`) continue to work
unchanged — Effect support is additive.

### 3. Mount an HttpApi

```ts
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Schema } from "effect";

const Api = HttpApi.make("todos").add(
  HttpApiGroup.make("todos").prefix("/todos").add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(TodoSchema) }),
    HttpApiEndpoint.post("create", "/", {
      payload: Schema.Struct({ text: Schema.String }),
      success: TodoSchema,
    }),
  ),
);

const TodosLive = HttpApiBuilder.group(Api, "todos", (h) =>
  h
    .handle("list", () =>
      Effect.gen(function* () {
        return yield* (yield* TodoService).list();
      }))
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        return yield* (yield* TodoService).create(payload.text);
      })));

app.httpApi("/api", Api, Layer.provide(TodosLive, AppLayer));
```

### 4. Mount RPC

Define procedures once; get typed client hooks automatically.

**Server:**

```ts
// services/rpc.ts
import { Rpc, RpcGroup, RpcSchema } from "effect/unstable/rpc";
import { Effect, Schedule, Schema, Stream } from "effect";

const ListTodos = Rpc.make("ListTodos", { success: Schema.Array(TodoSchema) });
const CreateTodo = Rpc.make("CreateTodo", {
  payload: Schema.Struct({ text: Schema.String }),
  success: TodoSchema,
});
const WatchTodos = Rpc.make("WatchTodos", {
  success: RpcSchema.Stream(Schema.Array(TodoSchema), Schema.Never),
});

export const TodoRpc = RpcGroup.make(ListTodos, CreateTodo, WatchTodos);

export const TodoRpcHandlers = TodoRpc.toLayer({
  ListTodos: () => Effect.flatMap(TodoService, (s) => s.list()),
  CreateTodo: ({ text }) => Effect.flatMap(TodoService, (s) => s.create(text)),
  WatchTodos: () =>
    Stream.fromEffectSchedule(
      Effect.flatMap(TodoService, (s) => s.list()),
      Schedule.spaced("2 seconds"),
    ),
});
```

**Mount on the app:**

```ts
// main.ts
const RpcWithDeps = Layer.provide(TodoRpcHandlers, AppLayer);

app.rpc({
  group: TodoRpc,
  path: "/rpc/todos",
  protocol: "http",
  handlerLayer: RpcWithDeps,
});
app.rpc({
  group: TodoRpc,
  path: "/rpc/todos/ws",
  protocol: "websocket",
  handlerLayer: RpcWithDeps,
});
app.rpc({
  group: TodoRpc,
  path: "/rpc/todos/sse",
  protocol: "sse",
  handlerLayer: RpcWithDeps,
});
```

**Client (island):**

```tsx
// islands/TodoApp.tsx
import { useRpcResult, useRpcStream } from "@fresh/effect/island";
import { TodoRpc } from "../services/rpc.ts";

export default function TodoApp() {
  // Request/response — returns [state, client]
  const [state, client] = useRpcResult(TodoRpc, { url: "/rpc/todos" });

  // Server-push stream — relative paths resolve against window.location
  const stream = useRpcStream(TodoRpc, {
    url: "/rpc/todos/ws",
    procedure: "WatchTodos",
  });

  return (
    <div>
      <button onClick={() => client.ListTodos()}>Load</button>
      {state._tag === "ok" && (
        <ul>{state.value.map((t) => <li>{t.text}</li>)}</ul>
      )}
      {stream._tag === "connected" && stream.latest && (
        <p>Live count: {stream.latest.length}</p>
      )}
    </div>
  );
}
```

## RPC protocols

Four transports, identical client-side interface (`RpcStreamState`):

| Protocol              | Mount option              | Client hook                   | Best for                      |
| --------------------- | ------------------------- | ----------------------------- | ----------------------------- |
| HTTP request/response | `protocol: "http"`        | `useRpcResult`, `useRpcQuery` | CRUD operations               |
| WebSocket streaming   | `protocol: "websocket"`   | `useRpcStream`                | Low-latency push, full-duplex |
| HTTP NDJSON streaming | `protocol: "http-stream"` | `useRpcHttpStream`            | Streaming without WS upgrade  |
| Server-Sent Events    | `protocol: "sse"`         | `useRpcSse`                   | Auto-reconnect, proxies       |

## Client hooks

```ts
import {
  getCacheData, // Read cached value
  invalidateQuery, // Trigger refetch for a cache key
  setCacheData, // Optimistic writes
  useMutation, // Mutations with optimistic update support
  useQuery, // Data fetching with cache + deduplication
  useRpcHttpStream, // HTTP NDJSON streaming
  useRpcPolled, // Polling on a schedule
  useRpcQuery, // Typed RPC fetching built on useQuery
  useRpcResult, // Request/response RPC — returns [state, client proxy]
  useRpcSse, // SSE streaming
  useRpcStream, // WebSocket streaming
} from "@fresh/effect/island";
```

All hooks share a module-level `ManagedRuntime` backed by `FetchHttpClient`.
Per-URL runtimes share the same `memoMap` so services are built once per page.

## Atom hydration

Seed client-side state from the server without prop drilling. No setup required
— `createEffectApp` wires the hydration hook automatically.

```ts
// routes/index.tsx (server)
import { setAtom } from "@fresh/effect";
import { todoListAtom } from "../atoms.ts";

export const handlers = define.handlers({
  GET: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      yield* setAtom(ctx, todoListAtom, todos); // serialized into HTML
      return page();
    }),
});
```

```tsx
// islands/TodoApp.tsx (client)
import { useAtom } from "@fresh/effect/island";
import { todoListAtom } from "../atoms.ts";

export default function TodoApp() {
  const [todos, setTodos] = useAtom(todoListAtom); // hydrated from SSR
  // ...
}
```

## How it works

**Core architecture:**

- `@fresh/core` knows nothing about Effect. It defines an `EffectLike`
  structural type (duck-typed on `"~effect/Effect"`) and an `EffectRunner`
  callback slot per `App` instance.
- `createEffectApp({ layer })` builds a `ManagedRuntime`, creates a resolver,
  and registers it via `setEffectRunner`. Any handler returning an Effect-like
  value is automatically run through the runtime.
- `EffectApp` wraps `App<State>` (composition, not inheritance) and proxies all
  builder methods with Effect-compatible types. The `.app` getter exposes the
  inner `App<State>` required by `Builder.listen()`.

**WebSocket isolation:**

Each WebSocket connection gets a fresh `ManagedRuntime` with
`Layer.fresh(RpcServer.layerProtocolSocketServer)` — bypassing the shared
memoMap to prevent stale protocol state across reconnections. Shared services
(e.g., database pools) remain memoized and reused.

## Project status

Built on [Effect v4 beta](https://github.com/Effect-TS/effect). The core
integration patterns are stable and tested, but the upstream Effect API is still
evolving. Not recommended for production until Effect v4 reaches a stable
release.

## License

MIT
