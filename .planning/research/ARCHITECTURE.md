# Architecture: Effect v4 Integration in Fresh

**Dimension:** Architecture — Effect v4 in Fresh handler execution and island
hydration **Researched:** 2026-02-18 **Confidence:** HIGH (based on direct
source reading); LOW for Effect v4 atom API (beta, no Preact binding confirmed)

---

## Source Files Read

All findings below are derived from reading actual source files, not assumed
from prior knowledge.

| File                                                | Key insight extracted                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/fresh/src/handlers.ts`                    | `HandlerFn` interface, `RouteHandler` union type                      |
| `packages/fresh/src/app.ts`                         | `App.handler()`, `runMiddlewares()` call site                         |
| `packages/fresh/src/middlewares/mod.ts`             | `runMiddlewares` — the middleware chain executor                      |
| `packages/fresh/src/commands.ts`                    | `renderRoute` call site in `CommandType.Route` case                   |
| `packages/fresh/src/segments.ts`                    | `renderRoute()` — THE handler call site (`fn(ctx)` at line 183)       |
| `packages/fresh/src/context.ts`                     | `Context` class, `ctx.render()` pipeline                              |
| `packages/fresh/src/render.ts`                      | `renderRouteComponent`, `AsyncAnyComponent` pattern                   |
| `packages/fresh/src/runtime/server/preact_hooks.ts` | Island detection, `RenderState`, `FreshScripts`, `FreshRuntimeScript` |
| `packages/fresh/src/runtime/client/reviver.ts`      | `boot()`, `revive()`, `ISLAND_REGISTRY`, `CUSTOM_PARSER`              |
| `packages/fresh/src/jsonify/stringify.ts`           | `Stringifiers` type — extensible custom serialization                 |

---

## Current Fresh Request Pipeline

### ASCII Component Diagram

```
  HTTP Request
       |
       v
  Deno.serve
       |
       v
  App.handler()  [packages/fresh/src/app.ts:396]
  ┌─────────────────────────────────────┐
  │  URL.pathname normalize             │
  │  UrlPatternRouter.match()           │
  │  new Context(req, url, ...)         │
  │  runMiddlewares(handlers, ctx)      │
  └────────────┬────────────────────────┘
               |
               v
  runMiddlewares()  [middlewares/mod.ts:91]
  ┌─────────────────────────────────────┐
  │  Iterates handlers[] in reverse     │
  │  Each fn = async (ctx) => ...       │
  │  Last fn is DEFAULT_NOT_FOUND       │
  └────────────┬────────────────────────┘
               |
               v
  segmentMiddleware (per route segment)  [segments.ts:93]
  ┌─────────────────────────────────────┐
  │  Sets internals.app / .layouts      │
  │  calls ctx.next() (next middleware) │
  │  catches HttpError → error routes   │
  └────────────┬────────────────────────┘
               |
               v
  renderRoute(ctx, route)  [segments.ts:143]       <── CRITICAL PATH
  ┌─────────────────────────────────────┐
  │  selects fn from HandlerByMethod    │
  │  const res = await fn(ctx)  ←──────────── HANDLER CALL SITE (line 183)
  │                                     │
  │  if res instanceof Response:        │
  │    return res  ────────────────────►│
  │  else (PageResponse):               │
  │    renderRouteComponent(ctx, ...)   │
  │    ctx.render(vnode, {status})      │
  └────────────┬────────────────────────┘
               |
               v
  ctx.render()  [context.ts:199]
  ┌─────────────────────────────────────┐
  │  Composes layouts + app wrapper     │
  │  setRenderState(new RenderState())  │
  │  renderToString(appVNode)           │
  │    → Preact options hooks intercept │
  │      island vnodes during diff      │
  │  FreshScripts emits boot() script   │
  │  setRenderState(null)               │
  │  return new Response(html, init)    │
  └─────────────────────────────────────┘

  HTML Response
  ┌─────────────────────────────────────┐
  │  <!DOCTYPE html>...                 │
  │  <script type="module">             │
  │    import { boot } from "...";      │
  │    import Counter from "...";       │
  │    boot({Counter}, serializedProps) │
  │  </script>                          │
  └─────────────────────────────────────┘

  Client-side boot()  [runtime/client/reviver.ts:146]
  ┌─────────────────────────────────────┐
  │  Walk DOM for <!--frsh:island:...--> │
  │  parse(islandProps, CUSTOM_PARSER)  │
  │  revive(props, Component, container)│
  │    → preact render(h(component,...))│
  └─────────────────────────────────────┘
```

### Data Flow: Request In, Response Out

```
Request → App.handler()
        → runMiddlewares([...segmentMiddlewares, routeMiddleware], ctx)
        → renderRoute(ctx, route)
        → await fn(ctx)          ← HandlerFn invoked here
        → [Response | PageResponse]
        → if PageResponse: ctx.render(vnode) → renderToString → HTML string
        → Response (always exits as Response)
```

---

## The Single Integration Point

**File:** `packages/fresh/src/segments.ts`, line 183

```typescript
// Current code:
return await fn(ctx);

// What needs to change:
const rawResult = await fn(ctx);
const res = isEffect(rawResult)
  ? await ctx.effectRuntime.runPromise(rawResult)
  : rawResult;
// ... rest of renderRoute uses res
```

`renderRoute` is the only place `HandlerFn` return values are consumed and
type-checked. Everything upstream (middleware chain, router) passes values
opaquely. Everything downstream (`ctx.render`, `renderRouteComponent`) expects
`Response | PageResponse<Data>`. The Effect detection and resolution belongs
here and only here.

---

## Recommended Effect Integration Architecture

### Guiding principle: Effect is detected and resolved at one site, invisibly to everything above and below.

### Component Diagram with Effect

```
  App setup (main.ts / app entry)
  ┌─────────────────────────────────────┐
  │  const layer = MyServices.Default   │
  │  app.use(effectPlugin({ layer }))   │ ← new plugin
  └────────────┬────────────────────────┘
               | mounts a middleware that:
               | 1. creates ManagedRuntime.make(layer) once (singleton)
               | 2. attaches it to ctx.state.effectRuntime
               v

  Request → runMiddlewares
          → effectPlugin middleware [EARLY in chain]
          ┌─────────────────────────────────────┐
          │  ctx.state.effectRuntime = runtime  │
          │  return ctx.next()                  │
          └─────────────────────────────────────┘
          → renderRoute → fn(ctx)
          ┌─────────────────────────────────────┐
          │  const result = await fn(ctx)       │
          │  if isEffect(result):               │
          │    result = await runtime.runPromise│
          │             (result, {signal: ...}) │
          └─────────────────────────────────────┘
          → [Response | PageResponse]
          → ctx.render(...) as before
```

### Where the Effect Runtime Lives

The `ManagedRuntime` is created once at application startup, not per-request. It
holds constructed Layer services. Correct placement:

| Option                    | Where runtime lives                  | Verdict                                 |
| ------------------------- | ------------------------------------ | --------------------------------------- |
| Per-request in middleware | Created/disposed each request        | Wrong — Layer construction is expensive |
| As App-level singleton    | Created once, stored outside request | Correct approach                        |
| On `ctx.state`            | Runtime reference on state           | Right place for per-request access      |

**Implementation:** The plugin creates `ManagedRuntime.make(layer)` during
`App.handler()` initialization (before the request loop starts), stores it as a
closure variable, and attaches the reference to `ctx.state` via middleware. This
is consistent with how Fresh's `#getBuildCache` works — created once, accessed
per request.

### Integration Point: Plugin vs Middleware vs Core Dispatch

**Recommended: Plugin (wraps a middleware)**

Rationale from the codebase:

- `App.use()` accepts `MaybeLazyMiddleware<State>` — the entire middleware chain
  is the extension point
- Fresh has no plugin API distinct from middleware (`app.use()` is the
  registration mechanism)
- The `effectPlugin` function returns a `Middleware<State>` that sets
  `ctx.state.effectRuntime`
- Core dispatch modification (`renderRoute` in `segments.ts`) remains minimal:
  one `isEffect()` check

This keeps the change surface to:

1. `packages/fresh/src/segments.ts` — `renderRoute` gets Effect detection (5
   lines)
2. `packages/fresh/src/handlers.ts` — `HandlerFn` type union extended
3. New `packages/plugin-effect/` — plugin package providing runtime wiring and
   `createDefine` extension

---

## HandlerFn Type Change

**Current** (`packages/fresh/src/handlers.ts` line 193–198):

```typescript
export interface HandlerFn<Data, State> {
  (ctx: Context<State>):
    | Response
    | PageResponse<Data>
    | Promise<Response | PageResponse<Data>>;
}
```

**Proposed extension:**

```typescript
// In packages/plugin-effect/src/handlers.ts
// (Does NOT modify core Fresh — adds a new exported type)

import type { Effect } from "effect";
import type { HandlerFn, PageResponse } from "@fresh/core";
import type { Context } from "@fresh/core";

export interface EffectHandlerFn<Data, State, E = never> {
  (ctx: Context<State>):
    | Response
    | PageResponse<Data>
    | Promise<Response | PageResponse<Data>>
    | Effect<Response | PageResponse<Data>, E, never>; // ← added
}
```

**Alternative: extend core HandlerFn directly.**

The PROJECT.md decision log favors "extend HandlerFn union rather than new
handler type." That means modifying `HandlerFn` in
`packages/fresh/src/handlers.ts`. The type parameter `E` for the error channel
needs careful handling — it either must be `never` (all errors handled before
returning), or the error channel needs to map to `HttpError`. The safest
approach is to keep the Effect return type as
`Effect<Response | PageResponse<Data>, never, never>` in the core type, forcing
handlers to handle errors inside their Effect before returning.

**Build order implication:** Types must be stable before `segments.ts` can add
runtime detection. Types first, then runtime wiring.

---

## Effect Runtime Detection (renderRoute)

The only reliable way to detect an Effect return value without importing Effect
at the type level in core Fresh is duck-typing on a symbol or well-known
property.

Effect objects expose `[Effect.EffectTypeId]` (a unique Symbol). Detection:

```typescript
// In packages/fresh/src/segments.ts (or a util imported from plugin-effect)

// Option A: duck-type on Effect TypeId (requires knowing the symbol)
const EFFECT_TYPE_ID = Symbol.for("effect/Effect"); // actual symbol TBD by Effect source
function isEffect(value: unknown): value is Effect<unknown, unknown, never> {
  return value !== null &&
    typeof value === "object" &&
    EFFECT_TYPE_ID in value;
}
```

**Confidence: MEDIUM** — The exact `EffectTypeId` symbol string must be verified
from Effect source before implementation. An alternative is to check for
`._tag === "Effect"` or
`typeof value[Symbol.for("effect/Effect")] !== "undefined"`. This should be a
research task for Phase 1 implementation.

**How runtime is accessed inside renderRoute:**

Option 1 — from `ctx.state` (requires State to have `effectRuntime` typed):

```typescript
const runtime = (ctx.state as EffectState).effectRuntime;
if (runtime && isEffect(res)) {
  res = await runtime.runPromise(res);
}
```

Option 2 — from a module-level singleton stored by the plugin:

```typescript
// plugin-effect sets this when app is built:
let _runtime: ManagedRuntime<never, never> | null = null;
export function setRuntime(r: typeof _runtime) {
  _runtime = r;
}

// renderRoute reads it:
if (_runtime && isEffect(res)) {
  res = await _runtime.runPromise(res);
}
```

Option 2 is simpler and avoids contaminating the `State` generic. Option 1 is
more explicit and testable. **Recommendation: Option 1** — store on `ctx.state`
so the dependency is explicit and testable per-request, consistent with how
Fresh state already works for auth/session.

---

## Island Atom Hydration Architecture

### How Fresh Island Props Currently Work (from source)

**Server-side** (`runtime/server/preact_hooks.ts`):

1. During `renderToString`, Preact's `options[OptionsType.DIFF]` hook intercepts
   island vnodes
2. For each island encountered, props are stored in `RENDER_STATE.islandProps[]`
3. `FreshRuntimeScript` calls `stringify(islandProps, stringifiers)` using
   Fresh's custom JSON serializer
4. Currently handles: `Signal`, `Computed`, `Slot` types via custom
   `Stringifiers`
5. Output: `<script>boot({IslandName, ...}, serializedPropsJSON)</script>`

**Client-side** (`runtime/client/reviver.ts`):

1. `boot()` walks DOM for `<!--frsh:island:Name:propsIdx:key-->` comment markers
2. `parse(islandProps, CUSTOM_PARSER)` deserializes — currently revives
   `Signal`, `Computed`, `Slot`
3. `revive(props, Component, container)` calls
   `preact.render(h(Component, props), container)`

### Atom Hydration Extension

Atom state (from `@effect-atom/atom`) is a reactive container — it is not a
plain serializable value. To hydrate atoms in islands, atom values must be
serialized server-side and reconstructed client-side.

**Server-side atom serialization pattern:**

```typescript
// New Stringifier added to server preact_hooks.ts or injected by plugin
const atomStringifiers: Stringifiers = {
  ...existingStringifiers,
  EffectAtom: (value: unknown) => {
    if (isAtomValue(value)) {
      return { value: { _tag: "EffectAtom", current: value.current } };
    }
    return undefined;
  },
};
```

**Client-side atom reconstruction pattern:**

```typescript
// Extended CUSTOM_PARSER in reviver.ts or injected by plugin
const atomParser: CustomParser = {
  ...existingParser,
  EffectAtom: (value: { current: unknown }) => {
    return Atom.make(value.current); // creates pre-seeded atom
  },
};
```

**Key constraint from the source:** `FreshRuntimeScript` in `preact_hooks.ts`
calls `stringify(islandProps, stringifiers)` — the `stringifiers` object is
currently hardcoded. The plugin will need a way to register additional
stringifiers. This is a second modification point in `preact_hooks.ts`.

### Island Hydration Data Flow with Atoms

```
Server-side render:
  Island component uses <AtomProvider atom={myAtom}>
  → myAtom has a current value (fetched by handler Effect)
  → preact diff hook: islandProps.push({ props: { atom: myAtom } })
  → stringify(islandProps, {Signal, Computed, Slot, EffectAtom})
  → "EffectAtom" tag + current value emitted in JSON

Client-side boot():
  → parse(islandProps, {Signal, Computed, Slot, EffectAtom})
  → EffectAtom parser: Atom.make(serializedCurrentValue)
  → revive({atom: preSeededAtom}, IslandComponent, container)
  → Island renders with correct initial state, no flash
```

**Unknown:** Whether `@effect-atom/atom` has a way to create an atom pre-seeded
with a value (i.e., bypass initial async load). This needs investigation before
implementing the hydration path.

---

## What Component Boundaries Change

### packages/fresh/src/handlers.ts

**Change:** Extend `HandlerFn` interface to include `Effect` return type.

```typescript
// Before:
export interface HandlerFn<Data, State> {
  (ctx: Context<State>):
    | Response
    | PageResponse<Data>
    | Promise<Response | PageResponse<Data>>;
}

// After (if extending core):
export interface HandlerFn<Data, State, E = never> {
  (ctx: Context<State>):
    | Response
    | PageResponse<Data>
    | Promise<Response | PageResponse<Data>>
    | EffectLike<Response | PageResponse<Data>, E>; // EffectLike = structural type, no hard Effect dep
}
```

**Risk:** Adding `E` type param to `HandlerFn` is a breaking change to
`RouteHandler`, `HandlerByMethod`, and `RouteData`. Prefer a structural
`EffectLike` type with duck-typed detection to avoid the type parameter cascade.

### packages/fresh/src/segments.ts

**Change:** `renderRoute` — add Effect detection after `await fn(ctx)`.

Lines modified: ~5 lines around the `fn(ctx)` call (line 183).

```typescript
// Before:
return await fn(ctx);

// After:
const handlerResult = await fn(ctx);
const res = isEffect(handlerResult)
  ? await getEffectRuntime(ctx).runPromise(handlerResult)
  : handlerResult;
// res replaces all uses of the former direct `fn(ctx)` return below
```

### packages/fresh/src/runtime/server/preact_hooks.ts

**Change:** `stringifiers` object passed to `stringify()` must be extensible.

Current code (line 591 area):

```typescript
const serializedProps = stringify(islandProps, stringifiers);
```

The `stringifiers` object is hardcoded. Need either:

- A module-level registry: `let extraStringifiers: Stringifiers = {}`
- Or pass through `RenderState` which already holds `buildCache`

**Recommendation:** Add `extraStringifiers: Stringifiers = {}` to `RenderState`
and merge at call site. `plugin-effect` registers its atom stringifier by
setting this on RenderState construction (or via a registration function
imported from `preact_hooks.ts`).

### packages/fresh/src/runtime/client/reviver.ts

**Change:** `CUSTOM_PARSER` must be extensible for atom deserialization.

Current code (line 129):

```typescript
export const CUSTOM_PARSER: CustomParser = {
  Signal: (value: unknown) => signal(value),
  Computed: (value: unknown) => computed(() => value),
  Slot: (value: ...) => ...,
};
```

**Recommendation:** Export a
`registerParser(tag: string, fn: (v: unknown) => unknown): void` function, or
make `CUSTOM_PARSER` a plain mutable object. The atom client runtime (a separate
JS module loaded with the island bundle) calls
`registerParser("EffectAtom", ...)` before `boot()` runs.

### New: packages/plugin-effect/

New package. Does not modify Fresh core beyond the targeted changes above.

```
packages/plugin-effect/
  src/
    mod.ts           ← exports effectPlugin(), createEffectDefine()
    runtime.ts       ← ManagedRuntime lifecycle: make, get, dispose
    handlers.ts      ← EffectHandlerFn type (optional extension)
    stringifiers.ts  ← Atom serialization for server-side
    parser.ts        ← Atom deserialization for client-side
    island.ts        ← useAtom, useAtomValue hooks (Preact-compatible)
```

**Note on Preact atom hooks:** `@effect-atom/atom-react` only documents React
support. No Preact package confirmed. `useAtom` from `@effect-atom/atom-react`
may work via Preact compat (`preact/compat`), but this requires validation. If
it does not work, `island.ts` must implement Preact-native `useAtom` using
`useSignal` / Preact signals and the atom subscription API. This is the
highest-risk unknown.

---

## Effect Runtime Configuration API

The app author configures the Effect Layer and runtime through the plugin.
Proposed API:

```typescript
// main.ts (app entry point)
import { App } from "@fresh/core";
import { effectPlugin } from "@fresh/plugin-effect";
import { MyAuthService, MyDatabaseService } from "./services.ts";

const app = new App<MyState>();

const layer = Layer.mergeAll(
  MyDatabaseService.Default,
  MyAuthService.Default,
);

app.use(effectPlugin({ layer })); // registers runtime + middleware
app.fsRoutes();
app.listen();
```

**Inside effectPlugin:**

```typescript
// packages/plugin-effect/src/mod.ts
export function effectPlugin<R, E>(options: {
  layer: Layer<R, E, never>;
}): Middleware<{ effectRuntime: ManagedRuntime<R, E> }> {
  const runtime = ManagedRuntime.make(options.layer);

  return (ctx) => {
    (ctx.state as Record<string, unknown>).effectRuntime = runtime;
    return ctx.next();
  };
}
```

`ManagedRuntime.make(layer)` is called once when `effectPlugin()` is called (at
module init time, before any requests). The runtime is shared across all
requests as a closure variable. Disposal happens on process shutdown (handled by
Deno signal listeners, out of scope for phase 1).

---

## Build Order

What must be done before what, based on dependency graph:

```
Phase 1 — Types (no runtime changes)
  ├─ Research Effect TypeId symbol (exact symbol for duck-typing)
  ├─ Define EffectLike structural type (no hard dep on Effect package)
  ├─ Extend HandlerFn interface (or define EffectHandlerFn separately)
  └─ Update RouteData / HandlerByMethod if HandlerFn gains type param

Phase 2 — Runtime detection (depends on Phase 1 types)
  ├─ Add isEffect() to packages/fresh/src/segments.ts
  ├─ Wire runtime access: effectRuntime on ctx.state
  ├─ Modify renderRoute: await fn(ctx) → detect → runPromise if Effect
  └─ Unit tests: Effect handler returns Response, PageResponse, throws mapped error

Phase 3 — Plugin package (depends on Phase 2 detection working)
  ├─ Create packages/plugin-effect/ package
  ├─ ManagedRuntime.make() lifecycle in runtime.ts
  ├─ effectPlugin middleware that sets ctx.state.effectRuntime
  └─ effectPlugin registers with App (app.use(effectPlugin({layer})))

Phase 4 — Atom serialization (depends on Phase 3 runtime working)
  ├─ Server: make stringifiers extensible in preact_hooks.ts
  ├─ Client: make CUSTOM_PARSER extensible in reviver.ts
  ├─ Add EffectAtom stringifier (server) and parser (client) to plugin-effect
  └─ BLOCKED ON: verify Atom.make() pre-seeding API exists in @effect-atom/atom

Phase 5 — Island hooks (depends on Phase 4 hydration)
  ├─ Validate @effect-atom/atom-react works via preact/compat (test first)
  ├─ If yes: re-export useAtom, useAtomValue, useAtomSet from plugin-effect
  ├─ If no: implement Preact-native useAtom using Preact signals + atom subscribe
  └─ Example in packages/examples/ using Effect handler + atom island
```

**Critical path blockers:**

1. **Phase 1 → Phase 2:** The `EffectLike` structural type must not import from
   `effect` package in Fresh core (JSR constraint: no npm: in public types). The
   duck-type approach avoids this.

2. **Phase 3 → Phase 4:** `@effect-atom/atom` must support pre-seeded atoms for
   hydration to work. If `Atom.make(value)` creates an atom that starts
   already-resolved, hydration is trivial. If atoms always start by running
   their Effect, hydration requires a different strategy (injecting initial
   value into Context before the atom effect runs).

3. **Phase 4 → Phase 5:** Preact compat compatibility with
   `@effect-atom/atom-react` is unverified. This must be tested before Phase 5
   starts. If Preact compat works, Phase 5 is a re-export. If not, Phase 5 is a
   full Preact hook implementation.

---

## Architecture Patterns to Follow

### Pattern 1: Duck-typing for Effect detection

Do not add `import type { Effect } from "effect"` to Fresh core files. Instead,
detect Effects structurally. This keeps Fresh core free of Effect as a
dependency. The `isEffect()` function lives in `packages/plugin-effect` or a new
`packages/fresh/src/effect_utils.ts` that is conditionally imported.

**Preferred:** Keep the isEffect check inside `packages/plugin-effect` and have
`renderRoute` call a registered hook:

```typescript
// segments.ts
let _effectResolver:
  | ((v: unknown, ctx: Context<unknown>) => Promise<unknown>)
  | null = null;
export function setEffectResolver(fn: typeof _effectResolver) {
  _effectResolver = fn;
}

// In renderRoute:
let res = await fn(ctx);
if (_effectResolver !== null) {
  res = await _effectResolver(res, ctx);
}
```

This way Fresh core has zero knowledge of Effect — the resolver is null unless
`plugin-effect` is installed. Fully opt-in.

### Pattern 2: Runtime as singleton, not per-request

Never call `ManagedRuntime.make(layer)` inside the request handler. Layer
construction involves running Effects that initialize services. This is done
once at startup.

### Pattern 3: AbortSignal integration

Pass the request's `AbortSignal` when running handler Effects, so client
disconnects cancel in-flight Effects:

```typescript
const res = await runtime.runPromise(handlerEffect, {
  signal: AbortSignal.any([ctx.req.signal].filter(Boolean)),
});
```

Fresh's `Context` has `ctx.req` (the `Request`). `Request.signal` exists in the
Fetch API spec. This wires cancellation without any Fresh-internal changes.

---

## Architecture Anti-Patterns to Avoid

### Anti-Pattern 1: Putting Effect runtime in App config

**Trap:** Adding `effectLayer` to `FreshConfig` and constructing the runtime in
`App.handler()`.

**Why bad:** `App.handler()` is called to create the request handler function.
Calling `ManagedRuntime.make(layer)` there constructs the runtime once but
couples it to Fresh's config type, requiring Fresh core to know about Effect.

**Instead:** Use `app.use(effectPlugin({layer}))` — same lifecycle (once per
app), no core coupling.

### Anti-Pattern 2: Running Effect inside Preact render

**Trap:** Having island components call `runtime.runEffect(...)` during render.

**Why bad:** `ctx.render()` calls `renderToString()` synchronously. Fresh
already supports async components via `AsyncAnyComponent`, but it calls them
outside the synchronous `renderToString` pass. Running Effect during island
render on the server would require making the entire render path async (it
already is) but also require the Effect runtime to be available in Preact's
rendering context — which it isn't without significant restructuring.

**Instead:** Run Effects in the handler before render, store results in atom
state, hydrate atoms via the island props serialization path.

### Anti-Pattern 3: Serializing Effect instances as island props

**Trap:** Returning an `Effect<Data>` from a handler and trying to pass it as an
island prop.

**Why bad:** Effects are descriptions of computation, not values. They are not
serializable. Only the _result_ of running an Effect (the `Data` value) can be
serialized.

**Instead:** Run the Effect in the handler, put the result value in an atom or
return it as `PageResponse.data`.

### Anti-Pattern 4: Modifying HandlerFn to carry the error type E in the type parameter

**Trap:** `HandlerFn<Data, State, E>` — adding E cascades into
`RouteHandler<Data, State, E>`, `HandlerByMethod<Data, State, E>`,
`Route<State>`, `Define<State>`, and every place these types are used.

**Why bad:** The entire type-level change surface becomes enormous and breaks
all existing typed routes.

**Instead:** Accept that Effect handlers must have error channel `never` at the
boundary (all errors handled before returning the Effect). The Effect's error
type can be anything internally; it must be handled before being returned from
the handler. Or use a structural EffectLike<A, never> type that does not carry E
in the HandlerFn signature.

---

## Confidence Assessment

| Area                                         | Confidence | Basis                                                              |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| Current Fresh pipeline (exact call sites)    | HIGH       | Direct source reading                                              |
| Handler execution location (segments.ts:183) | HIGH       | Direct source reading                                              |
| Island serialization mechanism               | HIGH       | Direct source reading of preact_hooks.ts + reviver.ts              |
| ManagedRuntime.make() / runPromise API       | HIGH       | Official Effect docs + type signatures                             |
| Effect TypeId symbol exact value             | MEDIUM     | Structural, but exact symbol string needs verification             |
| @effect-atom/atom pre-seeding API            | LOW        | Not confirmed in docs; must verify from source                     |
| Preact compat compatibility with atom-react  | LOW        | No evidence either way; must test                                  |
| Effect v4 beta vs current v3.x               | MEDIUM     | v4 not released; design based on v3 ManagedRuntime which is stable |

---

## Open Questions Requiring Phase-Specific Research

1. **What is the exact Effect TypeId symbol?** (`Symbol.for("effect/Effect")` or
   similar?) — Verify from `effect` package source before implementing
   `isEffect()`.

2. **Does `@effect-atom/atom` support pre-seeded initial values?** — If
   `Atom.make(initialValue)` creates a synchronously-available atom, hydration
   is straightforward. If not, a Context-injection strategy is needed.

3. **Does `@effect-atom/atom-react`'s `useAtom` work with Preact via
   `preact/compat`?** — Test with a minimal reproduction before building the
   island hook layer.

4. **What is the effect@4.0.0-beta API surface for atoms?** — The
   `@effect-atom/atom` package is currently separate from the main `effect`
   package. PROJECT.md suggests atoms are in Effect v4 core — verify whether
   `@effect-atom/atom` is the right dependency or if Effect v4 ships atoms
   natively.

5. **Does Fresh's `Request` expose `.signal`?** — Verify `Deno.ServeHandlerInfo`
   passes through abort signals so cancellation integration is possible.

---

## Sources

- Fresh source: `packages/fresh/src/segments.ts` (direct read) — renderRoute()
  handler call site
- Fresh source: `packages/fresh/src/app.ts` (direct read) — middleware chain
- Fresh source: `packages/fresh/src/runtime/server/preact_hooks.ts` (direct
  read) — island serialization
- Fresh source: `packages/fresh/src/runtime/client/reviver.ts` (direct read) —
  client hydration
- Fresh source: `packages/fresh/src/handlers.ts` (direct read) — HandlerFn
  interface
- [Effect ManagedRuntime docs](https://effect.website/docs/runtime/) —
  ManagedRuntime.make(), runPromise API (HIGH confidence)
- [ManagedRuntime type signatures](https://effect-ts.github.io/effect/effect/ManagedRuntime.ts.html)
  — exact TypeScript types (HIGH confidence)
- [effect-atom GitHub](https://github.com/tim-smart/effect-atom) — Atom.make(),
  Atom.runtime() API (MEDIUM confidence, docs sparse)
- Effect latest version: 3.19.18 (Feb 2026) — v4 not released as stable
