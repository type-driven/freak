# Phase 5: Example - Research

**Researched:** 2026-02-24 **Domain:** Fresh 2 example app structure, Effect v4
service patterns, Deno KV integration **Confidence:** HIGH (code-based
findings); LOW (platform-deno package availability)

---

## Summary

Phase 5 builds a kitchen-sink Fresh 2 example app demonstrating all Effect
integration capabilities from Phases 1-4. The app lives in
`packages/examples/effect-integration/` as a workspace package.

All APIs from Phases 1-4 are fully documented in the source files and have been
read directly. The Fresh file-based routing conventions are confirmed from
`fs_routes.ts` and the `www/` real-world app. The Effect v4 service pattern uses
`ServiceMap.Service` (not the v3 `Context.Tag`). The `@effect/platform-deno`
import mapping from the CONTEXT.md is a critical open question — no official
Effect v4 package of that name is published. The recommended approach is
implementing `TodoService` directly with `Deno.openKv()` via
`Effect.tryPromise`.

Fresh's "RPC" in this context means POST/DELETE routes on the server (not
Effect's RPC subsystem). Optimistic client-side updates happen via atom state.
The `f-partial` attribute and `Partial` component provide server-driven UI
updates within island boundaries.

**Primary recommendation:** Implement a `TodoService` wrapping `Deno.openKv()`
directly using `Layer.effect`, serve CRUD via HTTP routes (GET list / POST
create / DELETE id / PATCH toggle), and use the `todoListAtom` with `useAtom`
for optimistic UI in the island.

---

## Standard Stack

### Core (verified from source)

| Library                  | Version                    | Purpose                                          | Why Standard                     |
| ------------------------ | -------------------------- | ------------------------------------------------ | -------------------------------- |
| `@fresh/core`            | `^2.0.0` (local workspace) | Fresh app framework, routing, islands            | Monorepo workspace package       |
| `@fresh/plugin-effect`   | `0.1.0` (local workspace)  | effectPlugin, createEffectDefine, setAtom, hooks | The plugin being demonstrated    |
| `effect`                 | `4.0.0-beta.0`             | Services, Layer, Effect, Cause, Schema, Atom     | Core Effect runtime for v4       |
| `preact`                 | `^10.28.3`                 | JSX runtime, component model                     | Required by Fresh                |
| `@fresh/plugin-tailwind` | `1.0.0` (local workspace)  | Tailwind CSS 4 via postcss transform             | Standard Fresh Tailwind approach |
| `tailwindcss`            | `^4.1.10`                  | Utility CSS                                      | Confirmed in root deno.json      |
| `@tailwindcss/postcss`   | `^4.1.10`                  | PostCSS plugin for Tailwind 4                    | Used by @fresh/plugin-tailwind   |

### The @effect/platform-deno Problem (LOW confidence — CRITICAL)

The CONTEXT.md decision says: "Persistence: Deno KV via `@effect/platform-deno`
(published package name in import map)."

Research findings:

- No official `@effect/platform-deno` npm package exists for Effect v4.
- `@effect/platform-node`, `@effect/platform-browser`, and
  `@effect/platform-bun` exist, but Deno has no official Effect v4 platform
  package.
- `@lishaduck/effect-platform-deno` on JSR exists but doesn't mention KV
  support.
- The third-party `type-driven/platform-deno` on GitHub explicitly targets
  Effect v3.
- `effect@4.0.0-beta.0` bundles `KeyValueStore` as
  `effect/unstable/persistence/KeyValueStore` with `layerMemory` and
  `layerFileSystem` — but NO Deno KV layer.

**Resolution needed before planning:** Either:

1. Implement a custom KV layer using `Deno.openKv()` directly with
   `Layer.effect` (no import map entry needed — use `Deno.openKv` directly in
   the layer)
2. Use `effect/unstable/persistence/KeyValueStore.layerMemory` for dev/demo
   purposes
3. Discover an actual published `@effect/platform-deno` package

The planner must choose one approach. Recommendation: Option 1 (custom layer
using `Deno.openKv()`). The import map should NOT map `@effect/platform-deno` to
anything since no published package exists.

### Supporting

| Library                                     | Purpose                       | When to Use                                 |
| ------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `effect/unstable/persistence/KeyValueStore` | Abstract KV service interface | If using makeStringOnly to wrap Deno.openKv |
| `@std/assert` or `@std/expect`              | Testing                       | If adding tests to example                  |

### Installation

The example `deno.json` should use workspace imports:

```bash
# In packages/examples/effect-integration/deno.json imports:
# "@fresh/plugin-effect": "./../../plugin-effect"   (or workspace alias)
# These are workspace packages — resolved via deno.json workspace in root
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/examples/effect-integration/
├── deno.json              # Package config, imports, tasks
├── dev.ts                 # Builder.listen() + tailwind plugin
├── main.ts                # App definition: effectPlugin + staticFiles + fsRoutes
├── atoms.ts               # Shared Atom definitions (serializable for hydration)
├── services/
│   ├── TodoService.ts     # ServiceMap.Service + Layer.effect wrapping Deno.openKv
│   └── layers.ts          # AppLayer = Layer.merge(...)
├── routes/
│   ├── _app.tsx           # HTML shell, Head, Tailwind CSS link
│   ├── _layout.tsx        # Optional: nested layout for todo section
│   ├── _middleware.ts     # effectPlugin middleware (or done in main.ts)
│   ├── _error.tsx         # Custom error page: HttpError 404/500 variants
│   ├── index.tsx          # Handler: list todos, setAtom, render TodoApp island
│   ├── api/
│   │   └── todos.ts       # POST (create), PATCH (toggle), DELETE (id) — RPC routes
│   └── errors/
│       └── demo.tsx       # Dedicated route showing typed error dispatch explicitly
├── islands/
│   └── TodoApp.tsx        # useAtom(todoListAtom) + optimistic mutations
└── static/
    └── styles.css         # @import "tailwindcss";
```

### Pattern 1: effectPlugin in main.ts (Recommended)

Register effectPlugin once in main.ts at app-level, not in a middleware file.
This matches the phase 1 integration approach.

```typescript
// Source: packages/plugin-effect/src/mod.ts + integration_test.ts
import { App, staticFiles } from "@fresh/core";
import { effectPlugin } from "@fresh/plugin-effect";
import { AppLayer } from "./services/layers.ts";

export const app = new App()
  .use(staticFiles())
  .use(effectPlugin({ layer: AppLayer }))
  .fsRoutes();
```

### Pattern 2: Service Definition (Effect v4 — ServiceMap.Service)

Effect v4 uses `ServiceMap.Service`, NOT `Context.Tag` (v3 API).

```typescript
// Source: packages/plugin-effect/tests/plugin_test.ts,
//         packages/plugin-effect/tests/define_test.ts
import { Effect, Layer, ServiceMap } from "effect";

// Define service tag
export const TodoService = ServiceMap.Service<{
  list: () => Effect.Effect<Todo[], TodoError>;
  create: (text: string) => Effect.Effect<Todo, TodoError>;
  toggle: (id: string) => Effect.Effect<Todo, TodoError | NotFoundError>;
  remove: (id: string) => Effect.Effect<void, TodoError | NotFoundError>;
}>("TodoService");

// R type for createEffectDefine
type TodoServiceR = ServiceMap.Service.Identifier<typeof TodoService>;

// Layer implementation wrapping Deno.openKv
export const TodoLayer = Layer.effect(
  TodoService,
  Effect.tryPromise(() => Deno.openKv()).pipe(
    Effect.map((kv) => ({
      list: () =>
        Effect.tryPromise(async () => {
          const entries: Todo[] = [];
          for await (const entry of kv.list({ prefix: ["todos"] })) {
            entries.push(entry.value as Todo);
          }
          return entries;
        }),
      create: (text: string) =>
        Effect.tryPromise(async () => {
          const id = crypto.randomUUID();
          const todo: Todo = { id, text, done: false };
          await kv.set(["todos", id], todo);
          return todo;
        }),
      // ... toggle, remove
    })),
  ),
);
```

**Note:** `Layer.effect` is for layers that require an Effect to produce the
service. `Layer.succeed` is for pure/synchronous implementations.

### Pattern 3: Route Handler with Effect Services

```typescript
// Source: packages/plugin-effect/tests/define_test.ts (define.handlers pattern)
import { Effect } from "effect";
import { createEffectDefine } from "@fresh/plugin-effect";
import { setAtom } from "@fresh/plugin-effect";
import { TodoService } from "../services/TodoService.ts";
import { todoListAtom } from "../atoms.ts";

const define = createEffectDefine<AppState, TodoServiceR>();

export const handler = define.handlers({
  GET: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      setAtom(ctx, todoListAtom, todos); // server-side hydration
      return page({ todos });
    }),
});
```

**Critical pattern:** Use `app.route()`, NOT `app.get()` for Effect handlers.
`app.get()` bypasses `renderRoute()` and the `_effectResolver` — Effect handlers
won't be resolved. (Source: integration_test.ts comment lines 14-16)

### Pattern 4: Serializable Atom for Hydration

```typescript
// Source: packages/plugin-effect/tests/hydration_test.ts
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

// Must be module-level constant
export const todoListAtom = Atom.serializable(
  Atom.make<Todo[]>([]),
  {
    key: "todo-list",
    schema: Schema.Array(TodoSchema),
  },
);
```

Constraints:

- Atom must be wrapped with `Atom.serializable({ key, schema })`
- The `key` must be unique across all atoms used in a single request
- Call `setAtom(ctx, todoListAtom, todos)` in GET handler BEFORE returning
  `page()`
- `effectPlugin()` must be active — it initializes the hydration map per request

### Pattern 5: Island with useAtom + Optimistic Updates

```typescript
// Source: packages/plugin-effect/src/island.ts
// Import ONLY from @fresh/plugin-effect/island — not from mod.ts
import { useAtom, useAtomSet, useAtomValue } from "@fresh/plugin-effect/island";
import { todoListAtom } from "../atoms.ts";

export default function TodoApp() {
  const [todos, setTodos] = useAtom(todoListAtom); // read+write

  async function handleCreate(text: string) {
    // Optimistic update — update atom immediately
    const optimistic: Todo = { id: "temp-" + Date.now(), text, done: false };
    setTodos([...todos, optimistic]);

    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        body: JSON.stringify({ text }),
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) throw new Error("failed");
      const actual: Todo[] = await res.json();
      setTodos(actual); // server is source of truth
    } catch {
      setTodos(todos); // rollback on failure
    }
  }

  return <div class="...">{/* ... */}</div>;
}
```

Hook summary:

- `useAtom(atom)` — `[value, setter]` tuple, subscribes to updates
- `useAtomValue(atom)` — read-only subscription, re-renders on change
- `useAtomSet(atom)` — write-only setter, does NOT subscribe (no re-render)

### Pattern 6: Fresh File Conventions

Special file names detected by `fs_routes.ts`:

| File                    | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `routes/_app.tsx`       | App-level HTML shell (always first in sort)  |
| `routes/_layout.tsx`    | Nested layout for a route group              |
| `routes/_middleware.ts` | Middleware for a route segment               |
| `routes/_error.tsx`     | Error page (handles HttpError + generic 500) |
| `islands/TodoApp.tsx`   | Island component (auto-detected by Builder)  |
| `static/styles.css`     | Served as static file                        |

Error page pattern (from www/_error.tsx):

```typescript
import { HttpError, type PageProps } from "@fresh/core";

export default function ErrorPage(props: PageProps) {
  const error = props.error;
  if (error instanceof HttpError) {
    if (error.status === 404) { /* ... */ }
  }
  // Log internally, show user-safe message
  console.error(error);
  return <div>500 - Something went wrong</div>;
}
```

### Pattern 7: dev.ts Structure

```typescript
// Source: www/dev.ts + packages/fresh/tests/fixture_precompile/invalid/dev.ts
import { Builder } from "@fresh/core/dev";
import { tailwind } from "@fresh/plugin-tailwind";

const builder = new Builder({ target: "safari12" });
tailwind(builder);

if (Deno.args.includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}
```

### Pattern 8: RPC via JSON API Routes

Fresh has no built-in RPC framework (the Effect RPC subsystem is a separate
concern). "RPC" in this context means: JSON API routes that the island calls via
`fetch()`.

```typescript
// routes/api/todos.ts
export const handler = define.handlers({
  POST: async (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const body = yield* Effect.tryPromise(() => ctx.req.json());
      const todo = yield* svc.create(body.text);
      const all = yield* svc.list();
      return new Response(JSON.stringify(all), {
        headers: { "content-type": "application/json" },
      });
    }),
  DELETE: (ctx) =>
    Effect.gen(function* () {
      const id = ctx.params.id; // from route pattern /api/todos/:id
      const svc = yield* TodoService;
      yield* svc.remove(id);
      return new Response(null, { status: 204 });
    }),
});
```

### Pattern 9: Error Segregation with TaggedErrors

```typescript
// Define tagged errors for internal tracking
class KvError extends Data.TaggedError("KvError")<{ message: string }> {}
class NotFoundError extends Data.TaggedError("NotFoundError")<{ id: string }> {}

// In effectPlugin mapError handler:
app.use(effectPlugin({
  layer: AppLayer,
  mapError: (cause) => {
    // Log full Cause.pretty() server-side
    console.error(Cause.pretty(cause));
    // Return user-safe response
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  },
}));
```

**Cause.pretty()** is confirmed in Effect v4:
`Cause.pretty: <E>(cause: Cause<E>) => string` (from Cause.d.ts line 1113)

### Pattern 10: Partial + f-partial for Server-Driven Updates

For partials (demonstrating that Fresh feature):

```tsx
// In route component
import { Partial } from "@fresh/core/runtime";

export default function Page() {
  return (
    <div f-client-nav>
      <Partial name="todo-list">
        {/* server-rendered todo list that can be swapped */}
        <ul>{todos.map((t) => <li>{t.text}</li>)}</ul>
      </Partial>
      {/* Link/button with f-partial fetches just the partial */}
      <a href="/todos" f-partial="/todos?fresh-partial=todo-list">Refresh</a>
    </div>
  );
}
```

### Anti-Patterns to Avoid

- **Using `app.get()` for Effect handlers:** Bypasses `renderRoute()` entirely.
  Effect handlers MUST use `app.route()` or file-based routes via `fsRoutes()`.
- **Importing from `@fresh/plugin-effect` in island files:** The island module
  (`@fresh/plugin-effect/island`) is separate from `mod.ts`. Islands are
  client-only.
- **Creating atoms inside components:** Atom references must be module-level
  constants. Per-render atom creation causes subscription churn and infinite
  loops.
- **Calling setAtom() without effectPlugin():** The hydration map is initialized
  by effectPlugin() middleware. Without it, `setAtom()` throws.
- **Using createEffectDefine({ layer }) AND effectPlugin({ layer }):** Creates
  two runtimes. Use `effectPlugin({ layer })` globally and
  `createEffectDefine()` (no layer arg) for type-only define objects.

---

## Don't Hand-Roll

| Problem                           | Don't Build                    | Use Instead                                                                | Why                      |
| --------------------------------- | ------------------------------ | -------------------------------------------------------------------------- | ------------------------ |
| Atom state subscription in Preact | Manual signal/event system     | `useAtom`, `useAtomValue`, `useAtomSet` from `@fresh/plugin-effect/island` | Already built in Phase 3 |
| Atom hydration serialization      | Custom JSON script             | `setAtom()` from `@fresh/plugin-effect` + `Atom.serializable()`            | Built in Phase 4         |
| Effect runtime per request        | New ManagedRuntime per request | `effectPlugin()` creates singleton at setup time                           | Built in Phase 1         |
| HTML escape for JSON              | Custom escaping                | Fresh handles via `__FRSH_ATOM_STATE` script tag                           | Internal Fresh mechanism |
| Static file serving               | Custom handler                 | `staticFiles()` middleware from `@fresh/core`                              | Built-in Fresh feature   |

**Key insight:** The entire plugin-effect stack (Phases 1-4) exists precisely so
the example doesn't need to hand-roll any of this. The example's job is
demonstration, not implementation.

---

## Common Pitfalls

### Pitfall 1: Effect handlers registered via app.get() don't resolve

**What goes wrong:** Handler returns an Effect object, it never runs, client
gets empty or stringified object. **Why it happens:** `app.get()` registers raw
middleware bypassing `renderRoute()` where `_effectResolver` is called. **How to
avoid:** Use `app.route("/path", { handler: fn })` or file-based routing via
`fsRoutes()`. **Warning signs:** Effect object serialized to string in response,
or handler appears to not execute.

### Pitfall 2: @effect/platform-deno package doesn't exist for Effect v4

**What goes wrong:** `deno add npm:@effect/platform-deno` fails or installs v3
package. **Why it happens:** No official v4 Deno platform package published yet.
Only `@effect/platform-node`, `@effect/platform-browser`, `@effect/platform-bun`
exist. **How to avoid:** Implement TodoService with direct `Deno.openKv()` calls
via `Effect.tryPromise()`. No platform package needed. **Warning signs:** Import
not found at startup, or Effect type mismatches if v3 package is used.

### Pitfall 3: Layer.succeed vs Layer.effect confusion

**What goes wrong:** `Layer.succeed(Service, effectComputation)` — wraps an
Effect in a Layer.succeed where an Effect is expected but not awaited. **Why it
happens:** `Layer.succeed` is for synchronous values; `Layer.effect` is for
Effects. **How to avoid:** Use
`Layer.effect(ServiceTag, effectThatReturnsImplementation)` when the service
implementation requires async setup (like `Deno.openKv()`).

### Pitfall 4: setAtom called from the wrong entry point

**What goes wrong:** `setAtom` is imported from `@fresh/plugin-effect/island`
(wrong) or called inside island component (wrong). **Why it happens:** Confusion
between server-side and client-side APIs. **How to avoid:**
`setAtom(ctx, atom, value)` is server-only, imported from `@fresh/plugin-effect`
(not `/island`). Call it inside GET route handlers before returning `page()`.

### Pitfall 5: Tailwind styles not loading

**What goes wrong:** Page renders without any styling. **Why it happens:**
`tailwind(builder)` must be called on the Builder before `builder.listen()`. The
static CSS file must be linked in `_app.tsx`. **How to avoid:** Call
`tailwind(builder)` in `dev.ts`. Add
`<link rel="stylesheet" href={asset("/styles.css")} />` in `_app.tsx`. Put
`@import "tailwindcss";` at top of `static/styles.css`.

### Pitfall 6: Island atom not hydrated on first paint

**What goes wrong:** Island renders with default atom value (empty list) then
flickers to server value after JS loads. **Why it happens:** The
`__FRSH_ATOM_STATE` script tag must be emitted BEFORE the runtime module script.
The auto-init in `island.ts` reads from the DOM at module load time. **How to
avoid:** This is handled automatically by `effectPlugin()` via
`setAtomHydrationHook()`. Ensure `effectPlugin()` is registered before
`fsRoutes()` in the middleware chain.

### Pitfall 7: Duplicate atom key in same request

**What goes wrong:** `setAtom()` throws "Duplicate atom key" error. **Why it
happens:** Two atoms defined with the same `key` string, both set in the same
request. **How to avoid:** Each atom's `key` must be globally unique across the
app. Use namespaced keys like `"todo-list"`, `"todo-stats"`, etc.

---

## Code Examples

### Verified: Service Definition (Effect v4 pattern)

```typescript
// Source: packages/plugin-effect/tests/plugin_test.ts lines 29-35
import { Layer, ServiceMap } from "effect";

const GreetingService = ServiceMap.Service<
  { readonly greet: (name: string) => string }
>("GreetingService");

const TestLayer = Layer.succeed(GreetingService, {
  greet: (name: string) => `Hello, ${name}!`,
});
```

### Verified: R type extraction

```typescript
// Source: packages/plugin-effect/tests/define_test.ts lines 24-28
import { ServiceMap } from "effect";

const MsgService = ServiceMap.Service<{ msg: () => string }>("MsgService");
const MsgLayer = Layer.succeed(MsgService, { msg: () => "hello from define" });

// R is the Identifier type (shape type when one type param is provided)
type MsgR = ServiceMap.Service.Identifier<typeof MsgService>;
```

### Verified: Full route handler pattern

```typescript
// Source: packages/plugin-effect/tests/define_test.ts lines 32-48
const define = createEffectDefine<unknown, MsgR>({ layer: MsgLayer });
const app = new App()
  .route("/", {
    handler: define.handlers({
      GET: () =>
        Effect.gen(function* () {
          const svc = yield* MsgService;
          return new Response(svc.msg());
        }),
    }).GET!, // <-- Extract .GET! when passing single handler to app.route()
  });
```

**Note:** When using file-based routes (`fsRoutes()`), export the handlers
object directly — no `.GET!` extraction needed.

### Verified: Atom creation and serialization

```typescript
// Source: packages/plugin-effect/tests/hydration_test.ts lines 11-19
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

const countAtom = Atom.serializable(Atom.make(0), {
  key: "count",
  schema: Schema.Number,
});

// Server-side:
setAtom(ctx, countAtom, 42);

// Client-side (island):
const [count, setCount] = useAtom(countAtom);
```

### Verified: Error page pattern

```typescript
// Source: www/routes/_error.tsx lines 31-49
import { HttpError, type PageProps } from "@fresh/core";

export default function ErrorPage(props: PageProps) {
  const error = props.error;
  if (error instanceof HttpError) {
    if (error.status === 404) {
      return <NotFoundPage />;
    }
  }
  console.error(error); // Internal logging
  return <InternalErrorPage />;
}
```

### Verified: Middleware pattern

```typescript
// Source: www/routes/_middleware.ts (handler export pattern)
import type { Context } from "@fresh/core";

export async function handler<T>(ctx: Context<T>): Promise<Response> {
  const resp = await ctx.next();
  // post-processing...
  return resp;
}
```

### Verified: app.ts pattern

```typescript
// Source: www/main.ts
import { App, staticFiles, trailingSlashes } from "@fresh/core";

export const app = new App()
  .use(staticFiles())
  .use(trailingSlashes("never"))
  .fsRoutes();
```

### Verified: Fresh dev.ts pattern

```typescript
// Source: www/dev.ts
import { Builder } from "@fresh/core/dev";
import { tailwind } from "@fresh/plugin-tailwind";

const builder = new Builder({ target: "safari12" });
tailwind(builder);

if (Deno.args.includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}
```

### Verified: Partial component usage

```typescript
// Source: packages/fresh/src/runtime/shared.ts lines 37-54
// Import from @fresh/core/runtime
import { asset, IS_BROWSER, Partial } from "@fresh/core/runtime";

// Props: { name: string, mode?: "replace" | "prepend" | "append", children }
<Partial name="unique-partial-name">
  {children}
</Partial>;
```

---

## Workspace deno.json Setup

The example is a workspace package under
`packages/examples/effect-integration/`. The root `deno.json` already includes
`"./packages/*"` in `workspace`, so the new package is auto-discovered. No
changes to root `deno.json` needed.

The example's `deno.json` must:

1. Declare workspace-local imports pointing to sibling packages
2. Include `effect`, `preact`, etc. (inherited from root workspace, but may need
   local overrides)
3. Declare tasks: `dev`, `build`, `start`

```json
{
  "name": "@fresh/example-effect-integration",
  "version": "0.1.0",
  "license": "MIT",
  "imports": {
    "@fresh/core": "jsr:@fresh/core@^2.0.0",
    "@fresh/core/dev": "jsr:@fresh/core@^2.0.0/dev",
    "@fresh/core/runtime": "jsr:@fresh/core@^2.0.0/runtime",
    "@fresh/plugin-effect": "../plugin-effect/",
    "@fresh/plugin-effect/island": "../plugin-effect/",
    "@fresh/plugin-tailwind": "../plugin-tailwindcss/",
    "effect": "npm:effect@4.0.0-beta.0",
    "preact": "npm:preact@^10.28.3",
    "preact/hooks": "npm:preact@^10.28.3/hooks",
    "tailwindcss": "npm:tailwindcss@^4.1.10",
    "@tailwindcss/postcss": "npm:@tailwindcss/postcss@^4.1.10",
    "postcss": "npm:postcss@8.5.6"
  },
  "compilerOptions": {
    "lib": ["dom", "dom.asynciterable", "deno.ns", "deno.unstable"],
    "jsx": "precompile",
    "jsxImportSource": "preact"
  },
  "tasks": {
    "dev": "deno run -A --watch=static/,routes/ dev.ts",
    "build": "deno run -A dev.ts build",
    "start": "deno serve -A _fresh/server.js"
  }
}
```

**Note on workspace imports:** Workspace packages in this monorepo reference
each other with relative paths (e.g., `"../plugin-effect/"`). The
`@fresh/plugin-effect/island` export entry maps to `./src/island.ts` per
plugin-effect's `deno.json` exports.

**Critical:** The `@fresh/plugin-effect/island` import key needs special
handling. Plugin-effect `deno.json` exports:

```json
{ ".": "./src/mod.ts", "./island": "./src/island.ts" }
```

The example's import map entry should be:

```json
"@fresh/plugin-effect": "../plugin-effect/"
```

Deno resolves `@fresh/plugin-effect/island` via the package's own exports map.

---

## State of the Art

| Old Approach                   | Current Approach                   | When Changed   | Impact                           |
| ------------------------------ | ---------------------------------- | -------------- | -------------------------------- |
| `Context.Tag` for services     | `ServiceMap.Service<Shape>("key")` | Effect v4      | Different constructor signature  |
| `Layer.fromEffect`             | `Layer.effect`                     | Effect v4      | Function renamed                 |
| `@effect/platform-deno`        | No official v4 package             | Effect v4 beta | Must implement KV layer directly |
| v3 `Atom` from `@effect-rx/rx` | `effect/unstable/reactivity/Atom`  | Effect v4      | Atom is now in core              |
| Custom signal libraries        | Effect v4 atoms with registry      | Effect v4      | Unified reactive system          |

**Deprecated/outdated:**

- `Context.Tag`: Replaced by `ServiceMap.Service` in v4
- `Layer.fromEffect`: Renamed to `Layer.effect`
- `@effect-rx/rx` package: Atom system merged into core `effect` package

---

## Open Questions

1. **@effect/platform-deno import map resolution**
   - What we know: No official v4 package published. The CONTEXT.md says to use
     it as "published package name in import map."
   - What's unclear: Was the CONTEXT.md written with a specific plan for where
     to source this? Is there a JSR or npm package the author had in mind?
   - Recommendation: Plan for implementing `TodoService` directly with
     `Deno.openKv()`. Do NOT map `@effect/platform-deno` to an invalid package.
     Either skip the import map entry entirely or map it to a local stub. The
     planner should flag this for user confirmation.

2. **Plugin-effect island import resolution with workspace paths**
   - What we know: `@fresh/plugin-effect/island` uses Deno package exports.
   - What's unclear: Does `"@fresh/plugin-effect": "../plugin-effect/"`
     correctly resolve the `/island` sub-path export from the local package?
   - Recommendation: Test the import resolution early. An alternative is
     explicit mapping:
     `"@fresh/plugin-effect/island": "../plugin-effect/src/island.ts"`.

3. **compilerOptions jsxPrecompileSkipElements**
   - What we know: Root deno.json has a jsxPrecompileSkipElements list for
     performance.
   - What's unclear: Should the example package include the same list?
   - Recommendation: Include it for correctness since the example uses
     `precompile` jsx mode.

---

## Sources

### Primary (HIGH confidence — read directly from source)

- `packages/plugin-effect/src/mod.ts` — effectPlugin API, exports, setAtom
- `packages/plugin-effect/src/island.ts` — useAtom, useAtomValue, useAtomSet
  implementations
- `packages/plugin-effect/src/define.ts` — createEffectDefine API
- `packages/plugin-effect/src/hydration.ts` — setAtom, initAtomHydrationMap,
  serializeAtomHydration
- `packages/plugin-effect/src/resolver.ts` — isEffect, createResolver,
  EFFECT_TYPE_ID
- `packages/plugin-effect/src/runtime.ts` — makeRuntime, registerDisposal
- `packages/plugin-effect/tests/integration_test.ts` — app.route() vs app.get()
  critical note
- `packages/plugin-effect/tests/define_test.ts` — ServiceMap.Service.Identifier
  pattern
- `packages/plugin-effect/tests/hydration_test.ts` — setAtom usage,
  Atom.serializable pattern
- `packages/fresh/src/mod.ts` — App, staticFiles, trailingSlashes, page,
  HttpError exports
- `packages/fresh/deno.json` — @fresh/core exports (., /runtime, /dev,
  /internal, /compat)
- `packages/fresh/src/fs_routes.ts` — _app, _layout, _middleware, _error file
  conventions
- `packages/fresh/src/commands.ts` — CommandType enum, special route types
- `packages/fresh/src/runtime/shared.ts` — Partial, PartialProps, IS_BROWSER,
  asset
- `packages/fresh/src/runtime/client/partials.ts` — f-partial, PARTIAL_ATTR,
  f-client-nav
- `packages/fresh/src/define.ts` — createDefine, Define interface
- `packages/fresh/src/dev/builder.ts` — Builder class, BuildOptions (root,
  islandDir, routeDir)
- `packages/plugin-tailwindcss/src/mod.ts` — tailwind(builder) function
- `www/main.ts` — real-world App assembly pattern
- `www/dev.ts` — real-world dev.ts pattern
- `www/routes/_app.tsx` — _app layout pattern
- `www/routes/_error.tsx` — error page pattern
- `www/routes/_middleware.ts` — middleware pattern
- `node_modules/.deno/effect@4.0.0-beta.0/.../Atom.d.ts` — Atom.make,
  Atom.serializable, Writable
- `node_modules/.deno/effect@4.0.0-beta.0/.../ServiceMap.d.ts` —
  ServiceMap.Service API
- `node_modules/.deno/effect@4.0.0-beta.0/.../Cause.d.ts` — Cause.pretty
  signature
- `node_modules/.deno/effect@4.0.0-beta.0/.../KeyValueStore.d.ts` — KVS
  interface, layerMemory

### Secondary (MEDIUM confidence)

- Effect v4 beta blog post (WebFetch) — confirmed consolidation of platform
  packages into core
- npm search (WebSearch) — confirmed @effect/platform-deno not published for v4

### Tertiary (LOW confidence — flags open question)

- github.com/type-driven/platform-deno — v3-only, not v4 compatible
- jsr.io/@lishaduck/effect-platform-deno — community package, no KV support
  confirmed

---

## Metadata

**Confidence breakdown:**

- Standard stack (plugin-effect APIs): HIGH — read from source
- Architecture patterns: HIGH — verified from tests and www/ real-world app
- Fresh file conventions: HIGH — read from fs_routes.ts
- @effect/platform-deno availability: LOW — no v4 package found anywhere
- Deno KV layer pattern: MEDIUM — Deno.openKv() is standard Deno API,
  Layer.effect pattern confirmed

**Research date:** 2026-02-24 **Valid until:** 2026-03-24 (30 days; stable APIs,
but @effect/platform-deno status may change)
