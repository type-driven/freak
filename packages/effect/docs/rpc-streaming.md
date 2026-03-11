# RPC Streaming with @fresh/effect

`@fresh/effect` provides typed RPC streaming over WebSocket for Fresh 2 apps,
combining Effect's `RpcGroup` definitions with Preact hooks for real-time
server-push updates.

This guide covers the full stack: defining streaming procedures, mounting them
on the server, and consuming the stream in island components.

---

## How it works

### Architecture

```
Browser (island)                     Deno server (Fresh 2)
  useRpcStream()                      effectApp.rpc({ protocol: "websocket" })
       |                                        |
  BrowserSocket  ── WebSocket (NDJSON) ──>  Deno.upgradeWebSocket
       |                                        |
  RpcClient        <── Stream<A> ──────  RpcServer + SocketServer
  (layerProtocolSocket)                  (layerProtocolSocketServer)
```

**Protocol**: Each WebSocket connection carries NDJSON (newline-delimited JSON)
frames. The client sends the procedure name and payload; the server pushes
stream values as they are emitted.

**Layer composition**: Both sides use Effect's Layer system. The server creates
a per-connection `ManagedRuntime` with a fresh `SocketServer` wrapping the
upgraded Deno WebSocket. The client creates a `ManagedRuntime` with
`BrowserSocket.layerWebSocket(url)` providing the browser-side socket. Both
sides share `RpcSerialization.layerNdjson` for the wire format.

**Lifecycle**: The server-side runtime is disposed when the WebSocket closes
(via the `"close"` event listener). The client-side runtime is disposed when the
hook's cleanup runs on unmount. This ensures no leaked fibers or connections.

---

## Defining a streaming RPC

### 1. Define the Schema types

```typescript
// types.ts
import * as Schema from "effect/Schema";

export const TodoSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  done: Schema.Boolean,
});

export type Todo = typeof TodoSchema.Type;
```

### 2. Define the RPC group with a streaming procedure

Use `RpcSchema.Stream(successSchema, errorSchema)` in the `success` field to
declare a streaming procedure. Do **not** use `stream: true` -- that is the
older API. `RpcSchema.Stream` gives correct TypeScript types so the handler
returns `Stream<A, E, R>` directly (not `Effect<Stream<...>>`).

```typescript
// services/rpc.ts
import { Effect, Schedule, Schema, Stream } from "effect";
import { Rpc, RpcGroup, RpcSchema } from "effect/unstable/rpc";
import { TodoSchema } from "../types.ts";
import { TodoService } from "./TodoService.ts";

// Request/response procedures
const ListTodos = Rpc.make("ListTodos", {
  success: Schema.Array(TodoSchema),
});

const CreateTodo = Rpc.make("CreateTodo", {
  payload: Schema.Struct({ text: Schema.String }),
  success: TodoSchema,
});

const DeleteTodo = Rpc.make("DeleteTodo", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
});

// Streaming procedure -- emits the full todo list on a schedule.
// RpcSchema.Stream wraps the success type so the handler returns Stream directly.
const WatchTodos = Rpc.make("WatchTodos", {
  success: RpcSchema.Stream(Schema.Array(TodoSchema), Schema.Never),
});

export const TodoRpc = RpcGroup.make(
  ListTodos,
  CreateTodo,
  DeleteTodo,
  WatchTodos,
);
```

### 3. Implement the handlers

Streaming procedure handlers return a `Stream` value directly -- they do **not**
use `yield*` or wrap in `Effect`. Non-streaming handlers return `Effect` as
usual.

```typescript
export const TodoRpcHandlers = TodoRpc.toLayer({
  ListTodos: () =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.list();
    }),

  CreateTodo: ({ text }) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.create(text);
    }),

  DeleteTodo: ({ id }) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      yield* Effect.ignore(svc.remove(id));
    }),

  // Returns Stream directly (not Effect<Stream>)
  WatchTodos: () =>
    Stream.fromEffectSchedule(
      Effect.gen(function* () {
        const svc = yield* TodoService;
        return yield* svc.list();
      }),
      Schedule.spaced("2 seconds"),
    ),
});
```

---

## Mounting the endpoint

In your `main.ts`, mount the RPC group on the `EffectApp`. You typically mount
two endpoints for the same group: one HTTP for request/response calls, one
WebSocket for streaming.

```typescript
// main.ts
import { createEffectApp } from "@fresh/effect";
import { Layer } from "effect";
import { AppLayer } from "./services/layers.ts";
import { TodoRpc, TodoRpcHandlers } from "./services/rpc.ts";

const effectApp = createEffectApp({ layer: AppLayer });

// Pre-compose handler layer with AppLayer so service deps are available.
const RpcWithDeps = Layer.provide(TodoRpcHandlers, AppLayer);

// HTTP -- request/response (ListTodos, CreateTodo, DeleteTodo)
effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos",
  protocol: "http",
  handlerLayer: RpcWithDeps,
});

// WebSocket -- streaming (WatchTodos)
effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos/ws",
  protocol: "websocket",
  handlerLayer: RpcWithDeps,
});

export const app = effectApp.use(staticFiles()).fsRoutes().app;
```

### `effectApp.rpc()` options

| Option         | Type                    | Description                                                |
| -------------- | ----------------------- | ---------------------------------------------------------- |
| `group`        | `RpcGroup`              | The RPC group definition                                   |
| `path`         | `string`                | URL path prefix (must start with `/`)                      |
| `protocol`     | `"http" \| "websocket"` | `"http"` for request/response, `"websocket"` for streaming |
| `handlerLayer` | `Layer`                 | Layer providing handler implementations                    |

The WebSocket endpoint handles `Deno.upgradeWebSocket` directly and creates a
per-connection `ManagedRuntime`. The app's `memoMap` is shared so service
instances (in-memory stores, DB pools) are reused across HTTP and WebSocket
handlers rather than duplicated per connection.

---

## Client hook: `useRpcStream`

```typescript
import { useRpcStream } from "@fresh/effect/island";
```

`useRpcStream` is a Preact hook that establishes a WebSocket connection to a
streaming RPC endpoint and delivers server-push events as state updates.

### Signature

```typescript
function useRpcStream<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: {
    url: string; // Full WebSocket URL (ws:// or wss://)
    procedure: string; // Name of the streaming procedure
    payload?: unknown; // Optional payload (omit for no-arg procedures)
  },
): RpcStreamState<any, any>;
```

### State tags

The returned `RpcStreamState` transitions through these tags:

| `_tag`         | Fields            | Meaning                                                                           |
| -------------- | ----------------- | --------------------------------------------------------------------------------- |
| `"connecting"` | --                | Initial state. WebSocket is being established.                                    |
| `"connected"`  | `latest: A\|null` | Connection open. `latest` is `null` until first push, then the most recent value. |
| `"error"`      | `error: E`        | The stream or connection failed.                                                  |
| `"closed"`     | --                | Stream ended or component unmounted.                                              |

### WebSocket URL construction

The hook requires a full WebSocket URL. Construct it dynamically to handle both
HTTP and HTTPS environments:

```typescript
const wsUrl = `${
  window.location.protocol === "https:" ? "wss" : "ws"
}://${window.location.host}/rpc/todos/ws`;
```

### Cleanup

The hook creates a `ManagedRuntime` per mount. On unmount, `runtime.dispose()`
is called, which closes the WebSocket and interrupts all running fibers. You do
not need to manage cleanup manually.

### Dependency array

The `useEffect` inside the hook depends on
`[options.url, options.procedure, options.payload]`. Changing any of these
values closes the existing connection and opens a new one.

### Full example

```typescript
import { useRpcStream } from "@fresh/effect/island";
import { TodoRpc } from "../services/rpc.ts";

export default function TodoStream() {
  const streamState = useRpcStream(TodoRpc, {
    url: `${
      window.location.protocol === "https:" ? "wss" : "ws"
    }://${window.location.host}/rpc/todos/ws`,
    procedure: "WatchTodos",
  });

  switch (streamState._tag) {
    case "connecting":
      return <p>Connecting...</p>;
    case "connected":
      if (streamState.latest === null) return <p>Waiting for data...</p>;
      return (
        <ul>
          {streamState.latest.map((todo) => <li key={todo.id}>{todo.text}</li>)}
        </ul>
      );
    case "error":
      return <p>Stream error: {String(streamState.error)}</p>;
    case "closed":
      return <p>Connection closed.</p>;
  }
}
```

---

## Client hook: `useRpcResult`

```typescript
import { useRpcResult } from "@fresh/effect/island";
```

`useRpcResult` is for **request/response** RPC calls over HTTP. Use it for
one-shot operations (create, delete, fetch) rather than streaming.

### Signature

```typescript
function useRpcResult<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: { url: string },
): [RpcResultState<any, any>, client: any];
```

### State tags

| `_tag`      | Fields     | Meaning                    |
| ----------- | ---------- | -------------------------- |
| `"idle"`    | --         | No call has been made yet. |
| `"loading"` | --         | A request is in flight.    |
| `"ok"`      | `value: A` | The call succeeded.        |
| `"err"`     | `error: E` | The call failed.           |

### Usage

```typescript
const [state, client] = useRpcResult(TodoRpc, { url: "/rpc/todos" });

// Trigger a call (updates state through loading -> ok/err):
client.CreateTodo({ text: "Buy milk" });

// Render based on state:
if (state._tag === "ok") {
  console.log("Created:", state.value);
}
```

### Key difference from `useRpcStream`

| Aspect    | `useRpcResult`              | `useRpcStream`                    |
| --------- | --------------------------- | --------------------------------- |
| Transport | HTTP POST                   | WebSocket                         |
| Pattern   | Request/response            | Server-push stream                |
| Trigger   | Explicit `client.Proc(...)` | Automatic on mount                |
| State     | idle/loading/ok/err         | connecting/connected/error/closed |

---

## Complete example

This is the full working pattern from the example app.

### Server: `services/rpc.ts`

```typescript
import { Effect, Schedule, Schema, Stream } from "effect";
import { Rpc, RpcGroup, RpcSchema } from "effect/unstable/rpc";
import { TodoService } from "./TodoService.ts";
import { TodoSchema } from "../types.ts";

const ListTodos = Rpc.make("ListTodos", {
  success: Schema.Array(TodoSchema),
});

const CreateTodo = Rpc.make("CreateTodo", {
  payload: Schema.Struct({ text: Schema.String }),
  success: TodoSchema,
});

const DeleteTodo = Rpc.make("DeleteTodo", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
});

const WatchTodos = Rpc.make("WatchTodos", {
  success: RpcSchema.Stream(Schema.Array(TodoSchema), Schema.Never),
});

export const TodoRpc = RpcGroup.make(
  ListTodos,
  CreateTodo,
  DeleteTodo,
  WatchTodos,
);

export const TodoRpcHandlers = TodoRpc.toLayer({
  ListTodos: () =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.list();
    }),

  CreateTodo: ({ text }) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.create(text);
    }),

  DeleteTodo: ({ id }) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      yield* Effect.ignore(svc.remove(id));
    }),

  WatchTodos: () =>
    Stream.fromEffectSchedule(
      Effect.gen(function* () {
        const svc = yield* TodoService;
        return yield* svc.list();
      }),
      Schedule.spaced("2 seconds"),
    ),
});
```

### Server: `main.ts`

```typescript
import { staticFiles } from "@fresh/core";
import { createEffectApp } from "@fresh/effect";
import { Layer } from "effect";
import { AppLayer } from "./services/layers.ts";
import { TodoRpc, TodoRpcHandlers } from "./services/rpc.ts";

const effectApp = createEffectApp({ layer: AppLayer });

const RpcWithDeps = Layer.provide(TodoRpcHandlers, AppLayer);

effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos",
  protocol: "http",
  handlerLayer: RpcWithDeps,
});

effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos/ws",
  protocol: "websocket",
  handlerLayer: RpcWithDeps,
});

export const app = effectApp.use(staticFiles()).fsRoutes().app;
```

### Island: `islands/TodoApp.tsx`

```typescript
import { useEffect, useState } from "preact/hooks";
import { useRpcStream } from "@fresh/effect/island";
import { TodoRpc } from "../services/rpc.ts";
import type { Todo } from "../types.ts";

export default function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);

  const streamState = useRpcStream(TodoRpc, {
    url: `${
      window.location.protocol === "https:" ? "wss" : "ws"
    }://${window.location.host}/rpc/todos/ws`,
    procedure: "WatchTodos",
  });

  // Sync stream pushes into local state
  useEffect(() => {
    if (streamState._tag === "connected" && streamState.latest !== null) {
      setTodos(streamState.latest as Todo[]);
    }
  }, [streamState]);

  return (
    <div>
      {streamState._tag === "connecting" && <p>Connecting...</p>}
      {streamState._tag === "error" && (
        <p>Stream error: {String(streamState.error)}</p>
      )}
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            {todo.done ? <s>{todo.text}</s> : todo.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Common pitfalls

### `Schema.Void` payload -- pass `undefined`, not `{}`

Procedures without a `payload` field (like `ListTodos`) expect `undefined` as
the argument. Passing `{}` causes a Schema validation error.

```typescript
// Wrong
client.ListTodos({});

// Correct
client.ListTodos();
// or
client.ListTodos(undefined);
```

### Layer composition -- use `Layer.provide`, not `Layer.mergeAll`

Handler layers depend on service layers. Compose with `Layer.provide` to satisfy
requirements:

```typescript
// Wrong -- mergeAll creates a parallel layer, not a dependency chain
const broken = Layer.mergeAll(TodoRpcHandlers, AppLayer);

// Correct -- provide feeds AppLayer as a dependency to TodoRpcHandlers
const RpcWithDeps = Layer.provide(TodoRpcHandlers, AppLayer);
```

### Streaming handler return -- return `Stream` directly, do not `yield*`

Streaming procedure handlers must return a `Stream` value, not an
`Effect<Stream>`. Do not wrap the stream in `Effect.gen` or use `yield*`.

```typescript
// Wrong -- wrapping in Effect.gen and yielding the stream
WatchTodos: () =>
  Effect.gen(function* () {
    return yield* Stream.fromEffectSchedule(...);
  }),

// Correct -- return the Stream directly
WatchTodos: () =>
  Stream.fromEffectSchedule(
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.list();
    }),
    Schedule.spaced("2 seconds"),
  ),
```

### Use `wss://` for HTTPS deployments

In production behind TLS, the WebSocket URL must use `wss://`, not `ws://`. The
dynamic URL construction shown above handles this automatically.

---

## Error handling

### Client-side error states

The `useRpcStream` hook transitions to `"error"` when the WebSocket connection
fails or the server-side stream errors. Transition to `"closed"` happens when
the stream completes normally or the component unmounts.

```typescript
const streamState = useRpcStream(TodoRpc, {
  url: wsUrl,
  procedure: "WatchTodos",
});

if (streamState._tag === "error") {
  // Display error UI, offer retry
  return (
    <p>
      Connection lost. <button onClick={() => location.reload()}>Retry</button>
    </p>
  );
}

if (streamState._tag === "closed") {
  // Stream ended -- server stopped pushing or component is unmounting
  return <p>Stream ended.</p>;
}
```

### Reconnection pattern

`useRpcStream` does not auto-reconnect. To implement reconnection, use a key to
force remount:

```typescript
export default function ReconnectingStream() {
  const [key, setKey] = useState(0);

  return <StreamConsumer key={key} onError={() => setKey((k) => k + 1)} />;
}

function StreamConsumer({ onError }: { onError: () => void }) {
  const streamState = useRpcStream(TodoRpc, {
    url: `${
      window.location.protocol === "https:" ? "wss" : "ws"
    }://${window.location.host}/rpc/todos/ws`,
    procedure: "WatchTodos",
  });

  useEffect(() => {
    if (streamState._tag === "error") {
      // Delay to avoid tight reconnect loops
      const timer = setTimeout(onError, 3000);
      return () => clearTimeout(timer);
    }
  }, [streamState._tag]);

  if (streamState._tag === "connected" && streamState.latest !== null) {
    return (
      <ul>{streamState.latest.map((t) => <li key={t.id}>{t.text}</li>)}</ul>
    );
  }

  return <p>{streamState._tag}...</p>;
}
```

### Server-side stream errors

If the handler's `Stream` fails, the error is serialized over the WebSocket and
surfaced as the `error` field in the client's `"error"` state. To handle errors
gracefully in the stream itself, use `Stream.catchAll` or `Stream.retry` in your
handler:

```typescript
WatchTodos: () =>
  Stream.fromEffectSchedule(
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.list();
    }),
    Schedule.spaced("2 seconds"),
  ).pipe(
    Stream.retry(Schedule.exponential("1 second")),
  ),
```

---

## Production checklist

- [ ] **Use `wss://`** -- construct WebSocket URLs dynamically from
      `window.location.protocol` as shown above
- [ ] **Handle error state** -- render a meaningful UI when
      `streamState._tag === "error"` (connection drop, server restart)
- [ ] **Handle closed state** -- decide whether to show "stream ended" UI or
      trigger reconnection
- [ ] **Server-side stream errors** -- add `Stream.retry` or `Stream.catchAll`
      to your handler streams so transient failures do not kill the connection
- [ ] **Layer composition** -- verify `handlerLayer` is composed with
      `Layer.provide(handlers, AppLayer)`, not `Layer.mergeAll`
- [ ] **Schema.Void procedures** -- call with no argument or `undefined`, not
      `{}`
- [ ] **Export `.app`** -- the main.ts default export must be
      `effectApp.....app` (the inner `App<State>` instance), not the `EffectApp`
      wrapper, because Fresh's `Builder.listen()` calls `setBuildCache()` which
      requires an `App` instance
- [ ] **Dispose on shutdown** -- `createEffectApp` registers SIGINT/SIGTERM
      handlers automatically; for tests, call `effectApp.dispose()` explicitly
