# Feature Landscape: Effect v4 Integration in Fresh

**Domain:** Framework capability — native Effect v4 support in Fresh (Deno web
framework) **Researched:** 2026-02-18 **Confidence:** MEDIUM-HIGH (Fresh
internals: HIGH via source; Effect-atom DX: MEDIUM via GitHub; Preact compat for
atom-react: LOW, unverified)

---

## Framing: What "Framework-Level" Means Here

A DIY Effect-in-Fresh integration is already possible today. A developer can
call `Effect.runPromise(myEffect)` inside an `async` handler and `await` the
result. The question this integration answers is: **what does Fresh need to own
so users never write that boilerplate themselves?**

The precedent is `@fastify/funky` (fp-ts + Fastify): a `preSerialization` hook
that detects `Either`/`Task` return values and runs them through the functional
machinery before Fastify serializes the response. The integration hooks into the
framework lifecycle so user routes stay purely declarative.

For Fresh + Effect, the equivalent insertion points are:

1. **`HandlerFn` return type** — extend the union so TypeScript accepts Effect
   returns.
2. **`runMiddlewares` dispatch loop** — detect Effect returns and run them via a
   configured runtime before Fresh processes the response.
3. **`RenderState` / island hydration** — extend the serialization layer to
   carry atom initial values from server to client.

---

## Table Stakes

Features that any Effect-in-Fresh integration must have. Missing any of these
and users will reach for DIY wiring instead.

### 1. Effect-Returning Route Handlers

**What:** `HandlerFn` return type union extended to include
`Effect<Response | PageResponse<Data>, E>` alongside the existing
`Response | PageResponse<Data> | Promise<...>`.

**DX goal:**

```typescript
// routes/items/[id].ts
export const handler = define.handlers({
  GET(ctx) {
    return Effect.gen(function* () {
      const item = yield* ItemService.findById(ctx.params.id);
      return page({ item });
    });
  },
});
```

No `await`, no `.runPromise()`, no `Effect.provide()` at the call site.

**What Fresh must do:** In the request dispatch path (currently `runMiddlewares`
in `app.ts`, then the handler call inside `segments.ts`), detect whether the
handler return value satisfies the Effect interface (structural check on
`._tag === "Effect"` or similar Effect v4 brand), and if so, call the configured
runtime's `runtime.runPromiseExit(effect)` before proceeding.

**Error handling contract:**

- `Exit.Success` → pass the value through normal Fresh response handling.
- `Exit.Failure` with `Cause.fail(E)` → call the Fresh error boundary (same as
  throwing `HttpError`). The E type should be mapped to an HTTP error; the
  framework should provide a user-configurable mapper, with a sensible default.
- `Exit.Failure` with `Cause.die(defect)` → treat as an unexpected 500 (same as
  an unhandled thrown exception in an async handler today).

**Complexity:** HIGH

- Requires modifying `HandlerFn` type in `handlers.ts`
- Requires extending `define.handlers()` inference chain to thread Effect types
- Requires detection + dispatch in `segments.ts` or `app.ts`
- Requires `Exit`/`Cause` discrimination for error handling
- Must not regress performance for non-Effect handlers

**Dependencies:** Requires Feature 2 (configured runtime) to be meaningful.

---

### 2. App-Level Effect Runtime Configuration

**What:** A mechanism for the application developer to provide an Effect `Layer`
(and thus a `ManagedRuntime`) that is used for all Effect-returning handlers
across the app. Fresh builds the runtime once at startup and uses it
per-request.

**DX goal:**

```typescript
// main.ts
import { App } from "fresh";
import { effectPlugin } from "@fresh/plugin-effect";

const app = new App()
  .use(effectPlugin({ layer: AppLayer }))
  .fsRoutes();
```

or equivalently via `fresh.config.ts`.

**What Fresh must do:** Expose a plugin hook (or middleware) that stores a
`ManagedRuntime` on the `App` instance. The dispatch path (Feature 1) reads this
runtime when running Effect-returning handlers.

**Pattern precedent:** Effect's own documentation recommends creating a
`ManagedRuntime.make(appLayer)` once per server startup and calling
`runtime.runPromise(effect)` per request. This is exactly the pattern
`effectbyexample.com/nextjs-api-handler` demonstrates for Next.js — and it maps
cleanly to Fresh's `App` class initialization.

**No-layer fallback:** If no layer is configured, use
`ManagedRuntime.make(Layer.empty)` (Effect's default runtime). This allows
zero-config use for handlers with no service requirements.

**Complexity:** MEDIUM

- Plugin/middleware API already exists in Fresh
- `ManagedRuntime.make()` is straightforward; the challenge is wiring it into
  the handler dispatch path in a way that's accessible without threading it
  through every function call
- `App` class would need an Effect-runtime slot; this should be opt-in and
  invisible to non-Effect users

**Dependencies:** Requires Feature 1 (Effect handler detection).

---

### 3. Middleware That Returns Effects

**What:** The same runtime that handles Effect-returning route handlers also
supports Effect-returning middleware. A Fresh `Middleware` currently returns
`Promise<Response>`; the union should extend to `Effect<Response, E>`.

**DX goal:**

```typescript
export const middleware = define.middleware(
  Effect.gen(function* (ctx) {
    const user = yield* AuthService.requireUser(ctx.req);
    ctx.state.user = user;
    return yield* ctx.next();
  }),
);
```

**What Fresh must do:** Extend `runMiddlewares` to handle Effect-returning
middleware functions using the same runtime as route handlers.

**Complexity:** HIGH

- `ctx.next()` currently returns `Promise<Response>`; inside an Effect
  middleware, the developer needs to either
  `yield* Effect.promise(() => ctx.next())` or Fresh needs to provide
  `ctx.nextEffect()` returning `Effect<Response, never>`
- The latter (providing `ctx.nextEffect()`) is the cleaner DX but requires
  Context changes
- The former is a valid MVP with no Fresh changes to `Context`

**Dependencies:** Feature 1 (Effect detection), Feature 2 (configured runtime).

**MVP scope note:** This can be deferred to post-v1 if it requires
`ctx.nextEffect()`. The `yield* Effect.promise(() => ctx.next())` workaround is
usable for v1.

---

### 4. Typed Error-to-Response Mapping

**What:** A default strategy for converting an Effect failure (`E` channel) into
an HTTP response, with a user-configurable override.

**Default behavior:**

- `E extends HttpError` → use `error.status` as the HTTP status
- `E` tagged with `._tag === "NotFound"` or similar → map to 404
- Any other `E` → 500 with the error logged server-side (not exposed to client)
- `Cause.die(defect)` → always 500, log the defect

**DX goal (configurable):**

```typescript
effectPlugin({
  layer: AppLayer,
  mapError: (cause) => {
    if (Cause.isFailType(cause) && cause.error instanceof MyAppError) {
      return new Response(cause.error.message, {
        status: cause.error.statusCode,
      });
    }
    return new Response("Internal Server Error", { status: 500 });
  },
});
```

**What Fresh must do:** The `mapError` function is called when the handler's
`Exit.Failure` is processed. The return value must be a `Response`.

**Complexity:** LOW-MEDIUM

- The mapper itself is simple
- The complexity is documenting the `Cause` structure well enough for users to
  use it correctly
- Effect v4's `Cause` API is stable and well-documented

**Dependencies:** Feature 1 (Effect detection), Feature 2 (configured runtime).

---

## Differentiators

Features that distinguish a truly native Effect-in-Fresh integration from a
bolted-on adapter. These are what justify "framework capability" rather than
"user-land library."

### 5. `useAtom` / `useAtomValue` / `useAtomSet` in Preact Islands

**What:** Preact hooks that let island components subscribe to Effect atoms.
Atoms update the component when their value changes; Effect-backed atoms (async
or stream-based) show loading/error/success states via `Result` type.

**DX goal:**

```typescript
// islands/Counter.tsx
import { useAtomSet, useAtomValue } from "@fresh/plugin-effect/hooks";

export function Counter() {
  const count = useAtomValue(countAtom);
  const setCount = useAtomSet(countAtom);
  return <button onClick={() => setCount((n) => n + 1)}>{count}</button>;
}
```

**Implementation path:**

- `@effect-atom/atom-react` uses only standard React hooks:
  `useSyncExternalStore`, `useContext`, `useMemo`, `useEffect`, `useCallback`,
  `useState`. Preact's compat layer (`preact/compat`) supports all of these.
- The package imports from `"react"` directly. For Deno, this can be aliased to
  `preact/compat` in `deno.json` import maps.
- **Risk:** `useSyncExternalStore` behavior parity between React 18 and Preact
  compat is NOT verified. Preact does implement it, but subtle differences in
  tearing behavior or scheduling could cause issues.
- **Fallback:** If `atom-react` + Preact compat does not work cleanly, a
  `@fresh/plugin-effect/hooks` package implementing the same hook API using
  `@preact/signals` internally (which Fresh already uses) would be more
  reliable.

**Complexity:** MEDIUM (if atom-react + compat works) to HIGH (if native Preact
hooks must be built)

**Dependencies:** Feature 2 (configured runtime / `AtomRuntime`).

---

### 6. Server-to-Client Atom Hydration

**What:** Atoms whose initial value is computed on the server (e.g., from a
database query in the route handler) are serialized and sent to the client as
part of the island hydration payload. The client-side atom starts with the
server value instead of a loading state.

**DX goal (server, in handler):**

```typescript
export const handler = define.handlers({
  async GET(ctx) {
    const user = await db.getUser(ctx.params.id);
    ctx.atomStore.set(userAtom, user);
    return page({ userId: user.id });
  },
});
```

**DX goal (client, in island):**

```typescript
// islands/UserCard.tsx
export function UserCard() {
  const user = useAtomValue(userAtom); // starts as user, not loading
  return <div>{user.name}</div>;
}
```

**What Fresh must do:**

- Extend `RenderState` (or add a parallel `AtomStore`) to accumulate atom
  initial values set during server-side handler/render execution.
- Extend the island serialization pass (currently in `preact_hooks.ts`) to
  include atom initial values in the JSON payload alongside island props.
- On the client, the `boot()` function (in `reviver.ts`) would hydrate the atom
  store before islands render.

**Complexity:** HIGH

- Fresh's current `RenderState` tracks island props, assets, and slots — it has
  no concept of external state stores
- Atom identity must survive server-to-client serialization (atoms are objects;
  they need stable string identifiers, similar to how React Query uses query
  keys)
- The atom store hydration must happen before island revival; the boot sequence
  in `reviver.ts` has a specific order
- Effect atom values may be Effect or Stream types — only their _resolved_
  initial values should be serialized, not the Effect/Stream itself

**Dependencies:** Feature 5 (atom hooks in islands), Feature 2 (runtime for
server).

---

### 7. Type-Safe Service Access in Handlers via `define.handlers()`

**What:** The `define` object that users call in routes is parameterized by
`State` today. For Effect-aware handlers, it should also carry the `Layer` type
(or a subset of it) so that handlers can reference service types that are
guaranteed to be in the runtime.

**DX goal:**

```typescript
// utils.ts — project-level define with typed services
import { createEffectDefine } from "@fresh/plugin-effect";
export const define = createEffectDefine<MyState, MyServices>();

// routes/items.ts
export const handler = define.handlers({
  GET(ctx) {
    // TypeScript knows DbService is available
    return DbService.getAll().pipe(Effect.map((items) => page({ items })));
  },
});
```

**What this requires:** A variant of `createDefine()` that threads an `R` type
parameter through `HandlerFn`, so the Effect return type is constrained to
`Effect<Response | PageResponse<Data>, E, R>` where `R` is the configured
services.

**Complexity:** MEDIUM

- TypeScript type plumbing in `define.ts` and `handlers.ts`
- No runtime changes — this is type-level only
- The pattern is analogous to how `createDefine<State>()` threads `State` today

**Dependencies:** Feature 1 (Effect handler types), Feature 2 (runtime
configuration).

---

### 8. Effect-Native Error Pages

**What:** Fresh's error route mechanism (`onError` in `App`) supports returning
`Route<State>`. An Effect-aware error route can `yield*` services to generate
rich error responses (e.g., log to observability service, look up localized
error messages).

**DX goal:**

```typescript
app.onError(
  "/",
  define.handlers({
    GET(ctx) {
      return Effect.gen(function* () {
        yield* LogService.error("Unhandled error", ctx.error);
        return page({ error: ctx.error.message });
      });
    },
  }),
);
```

**Complexity:** LOW (once Feature 1 exists — the same Effect detection runs in
error handlers too)

**Dependencies:** Feature 1, Feature 2.

---

## Anti-Features

Features that look useful but are complexity traps — explicitly do not build
these, at least not in v1.

### Anti-Feature A: Effect-Returning `ctx.next()` in Middleware

**What it is:** Providing `ctx.nextEffect(): Effect<Response, never>` so
middleware can compose the next handler using Effect's operators.

**Why avoid in v1:**

- Requires threading the runtime into `Context`, which touches core Fresh
  internals
- Makes the `Context` type depend on Effect, which creates a hard dependency for
  all Fresh users, not just Effect users
- The workaround (`yield* Effect.promise(() => ctx.next())`) is one line; it's
  not onerous
- Can be added in v2 once the simpler features are stable

---

### Anti-Feature B: Auto-Providing Layers Per-Request

**What it is:** Automatically injecting a per-request layer (e.g., containing
the current `Context<State>` as an Effect service) so handlers can `yield*`
Fresh's `Context` directly.

**Why avoid:**

- Per-request layer creation has overhead; Effect layers are meant for static
  wiring
- The handler already receives `ctx` as a function argument — Effect composition
  doesn't require it to be in the service context
- This blurs the boundary between "Fresh context" and "Effect context" in a way
  that's confusing to maintain

---

### Anti-Feature C: Streaming Response from Effect `Stream<Uint8Array>`

**What it is:** If a handler returns `Effect<Stream<Uint8Array>, E>`, Fresh runs
the inner stream and pipes it to a `ReadableStream` response.

**Why avoid in v1:**

- Fresh already has `ctx.stream()` for streaming; mixing Effect streams with
  HTTP streaming adds two layers of complexity simultaneously
- Effect v4 Stream semantics have changed (v4 is ~20x faster, with different
  scheduling); behavior in Deno's HTTP layer is unvalidated
- Good candidate for v2 once the simpler Effect integration is proven

---

### Anti-Feature D: Global Signal Integration (replacing `@preact/signals`)

**What it is:** Replacing Fresh's existing `@preact/signals` usage (for
cross-island reactivity) with Effect atoms.

**Why avoid:**

- Fresh's signal integration is load-bearing for existing features (island
  serialization, `signal()` / `computed()` in `CUSTOM_PARSER`)
- Effect atoms are a different abstraction (async-aware, Effect-ecosystem) vs
  signals (sync, DOM-optimized)
- These can coexist; making them compete creates confusion about which to use
- The integration should add Effect atoms as an additional primitive, not
  replace signals

---

### Anti-Feature E: Schema Validation at the Framework Layer

**What it is:** Using Effect Schema to validate route handler inputs (path
params, query params, request body) automatically at the framework level.

**Why avoid in v1:**

- `@effect/platform`'s `HttpApiBuilder` approach bundles routing, validation,
  and handlers into one API — a very different model from Fresh's file-system
  routing
- Grafting schema validation onto Fresh's request model would require
  significant middleware API changes
- This is better addressed as a user-land library (e.g., a `define.handlers`
  wrapper that adds Schema validation) than a framework feature
- Complexity far exceeds the v1 scope

---

## Feature Dependencies

```
Feature 1 (Effect handler detection)
  └── Feature 2 (App-level runtime config)
        ├── Feature 3 (Effect middleware) [can defer ctx.nextEffect()]
        ├── Feature 4 (Error mapping)
        ├── Feature 5 (useAtom hooks)
        │     └── Feature 6 (Server-to-client hydration)
        └── Feature 7 (Type-safe service access)

Feature 8 (Effect error pages) ← Feature 1 + Feature 2 (free once those exist)
```

---

## MVP Recommendation

### Ship in v1 (core correctness)

| Feature                                            | Rationale                                               |
| -------------------------------------------------- | ------------------------------------------------------- |
| 1. Effect-returning route handlers                 | The whole point — without this nothing else matters     |
| 2. App-level runtime configuration                 | Required for Feature 1 to be useful beyond toy examples |
| 4. Error-to-response mapping                       | Required for Feature 1 to be production-safe            |
| 7. Type-safe service access (`createEffectDefine`) | Low effort (type-level only), high DX value             |
| 8. Effect error pages                              | Free once Feature 1 + 2 exist                           |

### Ship in v1 if Preact compat works

| Feature                            | Rationale                                                         |
| ---------------------------------- | ----------------------------------------------------------------- |
| 5. `useAtom` hooks in islands      | If `atom-react` + Preact compat works, cost is low; if not, defer |
| 6. Server-to-client atom hydration | Only if Feature 5 is in v1                                        |

### Defer to v2

| Feature                                  | Why defer                                                   |
| ---------------------------------------- | ----------------------------------------------------------- |
| 3. Effect-returning middleware           | Workaround exists; `ctx.nextEffect()` requires core changes |
| 5. `useAtom` hooks (native Preact build) | Only needed if Preact compat path fails                     |
| 6. Server-to-client hydration            | High complexity; validate Feature 5 first                   |

---

## Sources

- Fresh source: `/packages/fresh/src/handlers.ts`, `context.ts`, `app.ts`,
  `segments.ts`, `commands.ts`, `runtime/client/reviver.ts`,
  `runtime/server/preact_hooks.ts` (HIGH confidence — read directly)
- [@fastify/funky](https://github.com/fastify/fastify-funky) — fp-ts + Fastify
  integration pattern (MEDIUM confidence — GitHub README)
- [Effect Runtime docs](https://effect.website/docs/runtime/) —
  `ManagedRuntime.make()` pattern (HIGH confidence — official docs)
- [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/)
  — same programming model, smaller bundles (HIGH confidence — official blog)
- [effectbyexample.com/nextjs-api-handler](https://effectbyexample.com/nextjs-api-handler)
  — Next.js + Effect integration pattern (MEDIUM confidence — community
  resource)
- [tim-smart/effect-atom](https://github.com/tim-smart/effect-atom) — atom API,
  `useAtomValue`, `AtomRuntime` (MEDIUM confidence — GitHub source)
- [effect-atom Hooks.ts](https://tim-smart.github.io/effect-atom/atom-react/Hooks.ts.html)
  — React hook internals used (MEDIUM confidence — generated docs)
- Preact compat + `useSyncExternalStore` compatibility: LOW confidence — not
  verified against effect-atom
- Effect v4 type signature changes: MEDIUM confidence — v4 blog confirms "same
  programming model"; specific API diffs vs v3 not verified
