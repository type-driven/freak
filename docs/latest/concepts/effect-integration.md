---
description: |
  Freak extends Fresh 2 with first-class Effect integration for typed services,
  Effect-returning handlers, shared atoms, and typed APIs.
---

Freak keeps the Fresh 2 programming model: file routing, middleware, layouts,
and islands all work the same way. The difference is that you can opt into
[Effect](https://effect.website/) where it helps: service layers,
structured errors, shared state, and typed APIs.

You can adopt these features incrementally. Plain handlers and plain islands
continue to work unchanged.

## Create an Effect app

Start by creating your app with `createEffectApp()` and an Effect `Layer` that
provides your services:

```ts main.ts
import { staticFiles } from "@freak/core";
import { createEffectApp } from "@freak/core/effect";
import { AppLayer } from "./services/layers.ts";

const effectApp = createEffectApp({ layer: AppLayer });

export const app = effectApp
  .use(staticFiles())
  .fsRoutes();
```

```ts services/layers.ts
import { TodoLayer } from "./TodoService.ts";

export const AppLayer = TodoLayer;
```

The `layer` is available to your Effect-based handlers, `HttpApi` handlers, and
RPC handlers. If you need custom error mapping, add a `mapError` function when
creating the app.

## Return `Effect` from route handlers

Use `createEffectDefine()` when a route needs services from your layer:

```tsx routes/index.tsx
import { page } from "@freak/core";
import { createEffectDefine } from "@freak/core/effect";
import { Effect } from "effect";
import { TodoService, type TodoServiceR } from "@/services/TodoService.ts";

const define = createEffectDefine<unknown, TodoServiceR>();

export const handler = define.handlers({
  GET: (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      return page({ todos });
    }),
});

export default define.page<{ todos: { id: string; text: string }[] }>(
  ({ data }) => (
    <ul>
      {data.todos.map((todo) => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  ),
);
```

This keeps the same request/response flow as Freak, but your handler now gets
typed access to services from the Effect environment.

## Share state across islands with atoms

For state shared by multiple islands, use Effect atoms instead of signals:

```ts atoms.ts
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

export const counterAtom = Atom.serializable(
  Atom.make(0),
  {
    key: "counter",
    schema: Schema.Number,
  },
);
```

```tsx islands/Counter.tsx
import { useAtom } from "@freak/core/effect/island";
import { counterAtom } from "@/atoms.ts";

export default function Counter() {
  const [count, setCount] = useAtom(counterAtom);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

If you want the initial atom value to come from the server, call
`setAtom(ctx, atom, value)` in your route handler before returning `page()` or
`ctx.render()`. The value is serialized into the HTML and read by the island
during hydration.

## Mount typed APIs

Freak can mount schema-first APIs directly on the app. Use `httpApi()` for
Effect HttpApi groups or `rpc()` for typed request/response and streaming
procedures.

```ts main.ts
import { Layer } from "effect";
import { TodoApi, TodosLive } from "./services/api.ts";
import { TodoRpc, TodoRpcHandlers } from "./services/rpc.ts";

const TodosWithDeps = Layer.provide(TodosLive, AppLayer);
const RpcWithDeps = Layer.provide(TodoRpcHandlers, AppLayer);

effectApp.httpApi("/api", TodoApi, TodosWithDeps);

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
```

In islands, you can consume those APIs with typed hooks:

```tsx islands/RpcDemo.tsx
import { useRpcResult, useRpcStream } from "@freak/core/effect/island";
import { TodoRpc } from "@/services/rpc.ts";

export default function RpcDemo() {
  const [result, client] = useRpcResult(TodoRpc, { url: "/rpc/todos" });
  const stream = useRpcStream(TodoRpc, {
    url: "ws://localhost:8000/rpc/todos/ws",
    procedure: "WatchTodos",
  });

  return (
    <div>
      <button onClick={() => client.ListTodos({})}>Refresh</button>
      <pre>{JSON.stringify(result, null, 2)}</pre>
      <pre>{JSON.stringify(stream, null, 2)}</pre>
    </div>
  );
}
```

These APIs are optional. You can keep using plain route handlers and `fetch`
where that is the right tradeoff.

## Next steps

- [Migrating to Freak](/docs/migration)
- [Sharing state between islands](/docs/examples/sharing-state-between-islands)
- [Testing](/docs/testing)
