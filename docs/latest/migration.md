---
description: |
  Migrate an existing Fresh 2 application to Freak — Fresh 2 with first-class
  Effect-TS integration. The migration is incremental: plain handlers, islands,
  and routing all continue to work without changes. Effect features are added
  on top.
---

# Migrating from Fresh 2 to Freak

Freak is a fork of `@fresh/core` that adds first-class
[Effect](https://core/effect.website/) integration. The migration is **incremental**
— existing routes, islands, middleware, and Tailwind config all continue to
work. You add Effect features where you need them.

## What changes

| Area                     | Fresh 2                                      | Freak                                   |
| ------------------------ | -------------------------------------------- | --------------------------------------- |
| App entry point          | `new App(config)`                            | `createEffectApp({ layer })`            |
| `main.ts` export         | `export default app`                         | `export const app = effectApp….`        |
| Route handlers           | Return `Response \| PageResponse \| Promise` | Can also return `Effect`                |
| `utils.ts` define        | `createDefine<State>()`                      | `createEffectDefine<State, R>()`        |
| Island local state       | `useSignal` (`@preact/signals`)              | `useState` / `useAtom` (Effect atoms)   |
| SSR → island hydration   | Manual serialization / signals               | `setAtom(ctx, atom, value)` + `useAtom` |
| API routes (optional)    | Manual handler functions                     | Can mount `HttpApi` or `RpcGroup`       |
| Data fetching (optional) | Manual `fetch`                               | `useRpcResult`, `useQuery`, etc.        |

## What stays the same

- File-system routing (`routes/` directory, all URL pattern conventions)
- Islands (`islands/` directory, island boundaries, props serialization)
- `@fresh/core` exports (`page`, `PageResponse`, `HttpError`, `Middleware`,
  `staticFiles`, etc.)
- `@fresh/plugin-tailwindcss` — no changes needed
- `_app.tsx`, `_error.tsx`, layouts, middleware files

---

## Step 1 — Update `deno.json`

Add `@fresh/core/effect` to your imports. The forked `@fresh/core` is a drop-in
replacement — swap the JSR version for the Freak fork.

```json deno.json
{
  "imports": {
    "@fresh/core": "jsr:@fresh/core@^2.0.0-alpha",
    "@fresh/core/effect": "jsr:@fresh/core/effect@^0.1.0",
    "@fresh/plugin-tailwindcss": "jsr:@fresh/plugin-tailwindcss@^0.1.0",
    "effect": "npm:effect@^4.0.0-beta",
    "@effect/platform": "npm:@effect/platform@^0.80.0",
    "@effect/platform-browser": "npm:@effect/platform-browser@^0.60.0"
  }
}
```

---

## Step 2 — Create your service layer

Freak apps centre on an Effect `Layer` that provides your services. Create this
before touching `main.ts`.

```ts services/layers.ts
import { Layer } from "effect";
import { TodoLayer } from "./TodoService.ts";
// Add your database, config, etc. layers here

export const AppLayer = Layer.mergeAll(TodoLayer);
```

```ts services/TodoService.ts
import { Context, Effect, Layer } from "effect";

export interface TodoService {
  readonly list: () => Effect.Effect<Todo[]>;
  readonly create: (text: string) => Effect.Effect<Todo>;
}

export const TodoService = Context.GenericTag<TodoService>("TodoService");

export const TodoLayer = Layer.succeed(TodoService, {
  list: () => Effect.sync(() => /* ... */),
  create: (text) => Effect.sync(() => /* ... */),
});
```

---

## Step 3 — Rewrite `main.ts`

**Before (Fresh 2):**

```ts main.ts
import { App } from "@fresh/core";
import { staticFiles } from "@fresh/core";
import config from "./fresh.config.ts";

const app = new App(config)
  .use(staticFiles())
  .fsRoutes();

export default app;
```

**After (Freak):**

```ts main.ts
import { createEffectApp } from "@fresh/core/effect";
import { staticFiles } from "@fresh/core";
import { AppLayer } from "./services/layers.ts";

const effectApp = createEffectApp({ layer: AppLayer });

// Optional: mount HttpApi or RPC groups here (see Step 6)

export const app = effectApp
  .use(staticFiles())
  .fsRoutes();
```

`Builder.listen()` automatically unwraps `EffectApp` to its inner `App<State>` —
no `.app` suffix needed. The `.app` getter is still available for advanced use
(e.g. calling `@fresh/core/internal` functions directly).

---

## Step 4 — Update `utils.ts`

**Before:**

```ts utils.ts
import { createDefine } from "@fresh/core";

export const define = createDefine<State>();
```

**After:**

```ts utils.ts
import { createEffectDefine } from "@fresh/core/effect";
import type { TodoService } from "./services/TodoService.ts";

// R = union of all services your handlers may use
export const define = createEffectDefine<State, TodoService>();
```

Plain `createDefine` still works if you have routes that don't use Effect.
`createEffectDefine` is a superset — it accepts both plain and Effect-returning
handlers.

---

## Step 5 — Migrate route handlers (incremental)

Plain handlers continue to work with zero changes. Migrate to Effect where you
want typed services and structured errors.

**Before (plain handler):**

```ts routes/todos.ts
import { define } from "@/utils.ts";

export const handlers = define.handlers({
  GET: async (_ctx) => {
    const todos = await fetchTodos();
    return Response.json(todos);
  },
});
```

**After (Effect handler — optional):**

```ts routes/todos.ts
import { define } from "@/utils.ts";
import { Effect } from "effect";
import { TodoService } from "@/services/TodoService.ts";

export const handlers = define.handlers({
  GET: (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      return Response.json(todos);
    }),
});
```

Both forms can coexist in the same app — even in the same file (GET can be
plain, POST can be Effect).

### Returning pages from Effect handlers

Use `page()` inside Effect just as you would in a plain handler:

```ts routes/index.tsx
import { page } from "@fresh/core";
import { define } from "@/utils.ts";
import { Effect } from "effect";
import { TodoService } from "@/services/TodoService.ts";

export const handlers = define.handlers({
  GET: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      return page({ todos });
    }),
});

export default define.page<{ todos: Todo[] }>(({ data }) => (
  <ul>
    {data.todos.map((t) => <li key={t.id}>{t.text}</li>)}
  </ul>
));
```

---

## Step 6 — Replace `@preact/signals` with atoms

Freak does **not** use `@preact/signals`. Use Effect atoms
(`effect/unstable/reactivity/Atom`) with the `useAtom`, `useAtomValue`, and
`useAtomSet` hooks from `@fresh/core/effect/island`.

### Local island state

**Before:**

```tsx islands/Counter.tsx
import { useSignal } from "@preact/signals";

export default function Counter() {
  const count = useSignal(0);
  return <button onClick={() => count.value++}>{count}</button>;
}
```

**After:**

```tsx islands/Counter.tsx
import { useState } from "preact/hooks";

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

For purely local state with no cross-island sharing, `useState` is the right
tool. Use atoms when you need shared state or SSR hydration.

### Shared / cross-island state with atoms

**Before (signals, cross-island):**

```ts atoms.ts
import { signal } from "@preact/signals";
export const countSignal = signal(0);
```

```tsx islands/A.tsx
import { countSignal } from "@/atoms.ts";
export default function A() {
  return <span>{countSignal}</span>;
}
```

**After (Effect atoms):**

```ts atoms.ts
import { Atom } from "effect/unstable/reactivity";
import { Schema } from "effect";

// For cross-island sharing + optional SSR hydration, use serializable atoms.
// The key must be unique across your app.
export const countAtom = Atom.serializable({
  key: "count",
  schema: Schema.Number,
})(0);

// For islands-only shared state (no SSR hydration needed):
export const localAtom = Atom.make(0);
```

```tsx islands/A.tsx
import { useAtomValue } from "@fresh/core/effect/island";
import { countAtom } from "@/atoms.ts";

export default function A() {
  const count = useAtomValue(countAtom);
  return <span>{count}</span>;
}
```

```tsx islands/B.tsx
import { useAtomSet } from "@fresh/core/effect/island";
import { countAtom } from "@/atoms.ts";

export default function B() {
  const setCount = useAtomSet(countAtom);
  return <button onClick={() => setCount((n) => n + 1)}>+</button>;
}
```

### SSR → island hydration with atoms

**Before (manual serialization or signals):**

```tsx routes/index.tsx
// Common pattern: pass data as island props and let the island manage state
export const handlers = define.handlers({
  GET: async (ctx) => {
    const todos = await fetchTodos();
    return page({ todos }); // pass through page data
  },
});

export default define.page<{ todos: Todo[] }>(({ data }) => (
  <TodoApp initialTodos={data.todos} />
));
```

**After (atom hydration):**

```ts atoms.ts
import { Atom } from "effect/unstable/reactivity";
import { Schema } from "effect";
import { Todo } from "./services/TodoService.ts";

export const todoListAtom = Atom.serializable({
  key: "todoList",
  schema: Schema.Array(TodoSchema),
})([]); // initial value — overwritten by SSR hydration
```

```tsx routes/index.tsx
import { page } from "@fresh/core";
import { setAtom } from "@fresh/core/effect";
import { define } from "@/utils.ts";
import { Effect } from "effect";
import { TodoService } from "@/services/TodoService.ts";
import { todoListAtom } from "@/atoms.ts";
import { TodoApp } from "@/islands/TodoApp.tsx";

export const handlers = define.handlers({
  GET: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      setAtom(ctx, todoListAtom, todos); // serialized into <script> tag
      return page();
    }),
});

export default define.page(() => <TodoApp />);
```

```tsx islands/TodoApp.tsx
import { useAtom } from "@fresh/core/effect/island";
import { todoListAtom } from "@/atoms.ts";

export default function TodoApp() {
  const [todos, setTodos] = useAtom(todoListAtom);
  // todos is pre-populated from SSR — no loading state, no flash
  return <ul>{todos.map((t) => <li key={t.id}>{t.text}</li>)}</ul>;
}
```

`createEffectApp` registers the atom hydration hook automatically — no manual
setup required.

---

## Step 7 — (Optional) Mount an `HttpApi`

Replace ad-hoc API routes with a schema-first `HttpApi`:

```ts main.ts
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Layer } from "effect";
import { TodoApi } from "./api/TodoApi.ts";
import { TodoApiHandlers } from "./api/TodoApiHandlers.ts";

const ApiLayer = Layer.provide(TodoApiHandlers, AppLayer);

const effectApp = createEffectApp({ layer: AppLayer });
effectApp.httpApi("/api", TodoApi, ApiLayer);
```

See the [`@effect/platform` HttpApi docs](https://core/effect.website/) for defining
`HttpApiGroup` and `HttpApiEndpoint`.

---

## Step 8 — (Optional) Add RPC

Replace `fetch` calls in islands with typed RPC:

**Server:**

```ts services/rpc.ts
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

```ts main.ts
const RpcWithDeps = Layer.provide(TodoRpcHandlers, AppLayer);

effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos",
  protocol: "http",
  handlerLayer: RpcWithDeps,
});
// Add WebSocket, SSE, or HTTP-stream transports as needed:
effectApp.rpc({
  group: TodoRpc,
  path: "/rpc/todos/ws",
  protocol: "websocket",
  handlerLayer: RpcWithDeps,
});
```

**Client (island):**

```tsx islands/TodoApp.tsx
import { useRpcResult, useRpcStream } from "@fresh/core/effect/island";
import { TodoRpc } from "@/services/rpc.ts";

export default function TodoApp() {
  const [state, client] = useRpcResult(TodoRpc, { url: "/rpc/todos" });
  const stream = useRpcStream(TodoRpc, {
    url: "/rpc/todos/ws",
    procedure: "WatchTodos",
  });

  return (
    <div>
      <button onClick={() => client.ListTodos()}>Load</button>
      {state._tag === "ok" && (
        <ul>{state.value.map((t) => <li key={t.id}>{t.text}</li>)}</ul>
      )}
      {stream._tag === "connected" && stream.latest && (
        <p>Live: {stream.latest.length} todos</p>
      )}
    </div>
  );
}
```

---

## Common pitfalls

### Forgetting to export as `app`

`Builder.listen(() => import("./main.ts"))` looks for a named `app` export.
`export default` does NOT work — it produces a `{ default: ... }` module shape
that the builder can't unwrap.

```ts
// CORRECT
export const app = effectApp.use(staticFiles()).fsRoutes();

// WRONG — builder looks for named "app", not "default"
export default effectApp.use(staticFiles()).fsRoutes();

// WRONG — wrong key name
export const myApp = effectApp.use(staticFiles()).fsRoutes();
```

### Creating atoms inside components

```ts
// WRONG — new atom reference on every render → subscription torn down and rebuilt constantly
export default function MyIsland() {
  const countAtom = Atom.make(0); // ← inside component
  const count = useAtomValue(countAtom);
}

// CORRECT — module-level constant
const countAtom = Atom.make(0);

export default function MyIsland() {
  const count = useAtomValue(countAtom);
}
```

### Forgetting `Atom.serializable` for hydrated atoms

`Atom.make(initialValue)` creates a plain atom — fine for islands-only state.
For SSR hydration (used with `setAtom` on the server), the atom **must** be
created with `Atom.serializable({ key, schema })(initialValue)`. Without a key
and schema, `setAtom` cannot serialize the value into the HTML.

### Using `{}` as payload for no-arg RPC procedures

Procedures with no `payload` option default to `Schema.Void`. Call them with
`undefined` (or no argument), not `{}`:

```ts
// WRONG
client.ListTodos({});

// CORRECT
client.ListTodos();
// or
client.ListTodos(undefined);
```

---

## Migration checklist

- [ ] Update `deno.json` — add `@fresh/core/effect`, `effect`, `@effect/platform`
- [ ] Create service `Layer` in `services/layers.ts`
- [ ] Rewrite `main.ts` to use `createEffectApp({ layer })`
- [ ] Export as `app` (named export or default)
- [ ] Update `utils.ts` to use `createEffectDefine` (or keep `createDefine` if
      no Effect handlers yet)
- [ ] Remove `@preact/signals` imports — replace with `useState` or `useAtom`
- [ ] Convert hydrated data from props-drilling to `setAtom` / `useAtom`
      (optional, incremental)
- [ ] Migrate handlers to return `Effect` where you want typed services
      (optional, incremental)
- [ ] Mount `HttpApi` or `RpcGroup` if replacing ad-hoc API routes (optional)
