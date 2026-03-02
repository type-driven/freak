# Phase 6: Fresh Core Plumbing - Research

**Researched:** 2026-02-25 **Domain:** Fresh `@fresh/core` internals —
`_effectResolver` globalization, per-app runner hook, handler/middleware Effect
dispatch **Confidence:** HIGH (all findings from direct codebase inspection — no
speculation)

---

## Summary

Phase 6 replaces a single module-level global (`_effectResolver` in
`segments.ts`) with a per-`App` instance hook. This enables multiple `App`
instances in the same process to each own their Effect runner without
interfering.

The change surface is deliberately narrow: three files in `@fresh/core` need
modification (`segments.ts`, `app.ts`, `internals.ts`), and the existing
`plugin-effect` must be updated to call the new per-app API instead of the
global setter.

Two critical gaps exist that the current architecture does NOT address, and
Phase 6 must fill:

- `app.get()` / `app.post()` (CORE-02): These use `newHandlerCmd` which pushes
  raw `Middleware<State>` functions onto the route. They never call
  `renderRoute()`, so `_effectResolver` is never invoked. Effect returns from
  these paths are silently ignored.
- `app.use()` middlewares (CORE-03): `runMiddlewares()` in `middlewares/mod.ts`
  awaits the middleware return value and expects a `Response`. An Effect return
  is not unwrapped.

**Primary recommendation:** Add `#effectRunner` as a private instance field on
`App<State>`, expose `setEffectRunner(app, fn)` via the same static-accessor
pattern used for `setBuildCache` and `setErrorInterceptor`, and thread the
runner into both the handler dispatch path and `runMiddlewares` via closure or
additional parameter.

---

## Current Architecture (what exists)

### The Global Singleton

**File:** `packages/fresh/src/segments.ts`, lines 17-60

```typescript
// Module-level global — shared across ALL App instances in the process
let _effectResolver:
  | ((value: unknown, ctx: Context<unknown>) => Promise<unknown>)
  | null = null;

export function setEffectResolver(
  fn: (value: unknown, ctx: Context<unknown>) => Promise<unknown>,
): void {
  _effectResolver = fn; // Last writer wins — multiple apps clobber each other
}
```

The global is read in exactly ONE place: `renderRoute()` in the same file, lines
230-233:

```typescript
let result: unknown = await fn(ctx);
if (_effectResolver !== null) {
  result = await _effectResolver(result, ctx as Context<unknown>);
}
return result;
```

### How `renderRoute()` Gets Called

`renderRoute()` is invoked from `commands.ts` when processing
`CommandType.Route` (the `app.route()` path). Specifically, the lazy and
non-lazy branches both push a middleware closure that calls
`renderRoute(ctx, route)`.

`app.get()` / `app.post()` / etc. use `CommandType.Handler`, which pushes the
user's raw middleware functions directly into the route — **`renderRoute` is
never called for these paths**.

### `App<State>` Instance Structure

**File:** `packages/fresh/src/app.ts`, lines 168-480

`App<State>` uses TypeScript's static-accessor pattern for "friend class" access
to private fields. Three existing examples show the established pattern:

```typescript
export let getBuildCache: <State>(app: App<State>) => BuildCache<State> | null;
export let setBuildCache: <State>(...) => void;
export let setErrorInterceptor: <State>(app: App<State>, fn: ...) => void;

export class App<State> {
  #getBuildCache: () => BuildCache<State> | null = () => null;
  #onError: (err: unknown) => void = NOOP;

  static {
    getBuildCache = (app) => app.#getBuildCache();
    setBuildCache = (app, cache, mode) => { app.#getBuildCache = () => cache; };
    setErrorInterceptor = (app, fn) => { app.#onError = fn; };
  }
  ...
}
```

The `handler()` method (line 370) builds the request handler. It calls
`runMiddlewares(handlers, ctx, this.#onError)`. The `#onError` callback is
threaded through the closure — this is the model to follow for `#effectRunner`.

### `runMiddlewares()` — No Effect Awareness

**File:** `packages/fresh/src/middlewares/mod.ts`, lines 91-143

```typescript
export async function runMiddlewares<State>(
  middlewares: MaybeLazyMiddleware<State>[],
  ctx: Context<State>,
  onError?: (err: unknown) => void,
): Promise<Response> {
  ...
  const result = await next(ctx);
  // result is returned as-is — if it's an Effect, it's NOT unwrapped
  if (typeof result === "function") {
    // lazy middleware resolution
  }
  return result;  // Bug: if result is an Effect, this returns a non-Response object
}
```

`MaybeLazyMiddleware<State>` returns
`Response | Promise<Response | Middleware<State>>`. An Effect return is not in
this union. The caller (`App.handler()`) checks `result instanceof Response` and
throws if not — meaning an Effect-returning middleware currently causes a
runtime error, not silent pass-through.

### `internals.ts` — Current Internal Export

**File:** `packages/fresh/src/internals.ts`

```typescript
export { setAtomHydrationHook, setEffectResolver } from "./segments.ts";
```

This is the only place `setEffectResolver` is exported publicly. The
`plugin-effect` package imports from `@fresh/core/internal`:

```typescript
import { setAtomHydrationHook, setEffectResolver } from "@fresh/core/internal";
```

After Phase 6, `setEffectResolver` must be replaced with
`setEffectRunner(app, fn)` — the new API accepts an `App` instance.

### `plugin-effect` — How It Uses the Current API

**File:** `packages/plugin-effect/src/mod.ts`, lines 77-109

`effectPlugin()` is called as `app.use(effectPlugin({ layer }))`. Internally:

1. Creates a `ManagedRuntime` singleton.
2. Calls `setEffectResolver(resolver)` — sets the global.
3. Returns a middleware that sets `ctx.state.effectRuntime`.

The returned middleware is registered via `app.use()`, which means the runtime
IS associated with a specific `App` call chain — but the resolver is registered
globally, not on that app.

### What `app.get()` / `app.post()` Actually Do

**File:** `packages/fresh/src/app.ts`, lines 265-311

```typescript
get(path: string, ...middlewares: MaybeLazy<Middleware<State>>[]): this {
  this.#commands.push(newHandlerCmd("GET", path, middlewares, false));
  return this;
}
```

**File:** `packages/fresh/src/commands.ts`, `CommandType.Handler` branch, lines
332-355

The handler middlewares are pushed directly into the route — they are invoked as
standard `Middleware<State>` functions by `runMiddlewares`. The `renderRoute()`
function is NOT called. An Effect returned from one of these middlewares will
bubble out of `runMiddlewares` and cause the `!(result instanceof Response)`
check in `App.handler()` to throw.

---

## Change Surface (what needs to change)

### 1. `packages/fresh/src/app.ts`

**Add** a private `#effectRunner` field and expose `setEffectRunner` via the
static pattern:

```typescript
// Add to module-level (outside class, alongside existing exports)
export let setEffectRunner: <State>(
  app: App<State>,
  fn: (value: unknown, ctx: Context<unknown>) => Promise<unknown>,
) => void;

// Add to App<State> class
#effectRunner: ((value: unknown, ctx: Context<unknown>) => Promise<unknown>) | null = null;

static {
  // ... existing static assignments ...
  setEffectRunner = (app, fn) => { app.#effectRunner = fn; };
}
```

**Modify** `handler()` to pass `this.#effectRunner` into `runMiddlewares` and
into the Effect dispatch for `app.get()` / `app.post()` paths.

### 2. `packages/fresh/src/segments.ts`

**Remove** the global `_effectResolver` and `setEffectResolver`.

**Add** an `effectRunner` parameter to `renderRoute()`:

```typescript
export async function renderRoute<State>(
  ctx: Context<State>,
  route: Route<State>,
  status = 200,
  effectRunner: ((value: unknown, ctx: Context<unknown>) => Promise<unknown>) | null = null,
): Promise<Response> {
  ...
  let result: unknown = await fn(ctx);
  if (effectRunner !== null) {
    result = await effectRunner(result, ctx as Context<unknown>);
  }
  return result;
}
```

All callers of `renderRoute` in `commands.ts` must be updated to pass the runner
through. The cleanest way is to thread it through the closure at route
registration time in `applyCommands` / `applyCommandsInner`.

### 3. `packages/fresh/src/middlewares/mod.ts`

**Add** an `effectRunner` parameter to `runMiddlewares()`:

```typescript
export async function runMiddlewares<State>(
  middlewares: MaybeLazyMiddleware<State>[],
  ctx: Context<State>,
  onError?: (err: unknown) => void,
  effectRunner?: ((value: unknown, ctx: Context<unknown>) => Promise<unknown>) | null,
): Promise<Response> {
  ...
  let result = await next(ctx);
  if (effectRunner != null && typeof result === 'object' && result !== null && '~effect/Effect' in result) {
    result = await effectRunner(result, ctx as Context<unknown>);
  }
  return result as Response;
}
```

Alternatively, the Effect check can use the same `isEffect()` duck-type from
`resolver.ts`. Since `middlewares/mod.ts` must not import from `plugin-effect`,
the check should be re-implemented inline or extracted to a shared utility in
`@fresh/core`.

### 4. `packages/fresh/src/commands.ts`

The `applyCommandsInner` function builds middleware closures. It needs access to
the `effectRunner` to thread through `renderRoute()` calls. Options:

**Option A:** Pass `effectRunner` as a parameter to `applyCommands` /
`applyCommandsInner`. Called from `App.handler()`, where `this.#effectRunner` is
available.

**Option B:** Capture via closure in the middleware functions, reading from
`ctx` if a per-request runner slot is added to `Context`.

Option A is simpler and keeps the call graph explicit. The planner should use
Option A.

### 5. `packages/fresh/src/internals.ts`

Replace the `setEffectResolver` export with `setEffectRunner`:

```typescript
export { setEffectRunner } from "./app.ts"; // new
// Remove: export { setEffectResolver } from "./segments.ts";
export { setAtomHydrationHook } from "./segments.ts"; // stays
```

`setAtomHydrationHook` remains on the global because atom hydration is not
per-app (it's a rendering concern, not a runtime concern).

### 6. `packages/plugin-effect/src/mod.ts`

Update `effectPlugin()` to call `setEffectRunner(app, resolver)` instead of the
global `setEffectResolver(resolver)`. This requires `effectPlugin()` to receive
the `app` instance.

Two API design options exist (see API Design section below).

---

## API Design Recommendations

### For `setEffectRunner` (CORE-01)

Use the existing `setBuildCache` / `setErrorInterceptor` pattern exactly. The
new export:

```typescript
// packages/fresh/src/app.ts
export let setEffectRunner: <State>(
  app: App<State>,
  fn: (value: unknown, ctx: Context<unknown>) => Promise<unknown>,
) => void;
```

This is already the named convention in the codebase. HIGH confidence this is
right.

### For `effectPlugin()` API Change

The current `effectPlugin()` signature returns a middleware and registers
globally. After Phase 6 it must receive the `App` instance to call
`setEffectRunner(app, ...)`.

**Option A: Pass app explicitly**

```typescript
effectPlugin({ layer, app });
// Usage: effectPlugin({ layer: AppLayer, app })
```

This is a breaking change to the existing signature but is explicit and
type-safe.

**Option B: Two-phase factory**

```typescript
effectPlugin({ layer })(app);
// Usage: app.use(effectPlugin({ layer })(app))
```

Awkward ergonomics.

**Option C: Middleware wraps registration**

```typescript
// effectPlugin() returns a middleware that, on first call, registers the runner
// on the app via ctx — but App isn't accessible from ctx currently.
```

Not feasible without adding app reference to `Context`.

**Option D: Return an installer + middleware pair**

```typescript
const { install, middleware } = effectPlugin({ layer });
install(app);
app.use(middleware);
```

Explicit but verbose.

**Recommended: Option A** — explicit `app` parameter. Since `effectPlugin` is
called at startup alongside `app.use(...)`, having `app` in scope is natural.
The Phase 10 migration shim can preserve the old zero-app signature as a legacy
path if needed.

### For CORE-02 (`app.get()` / `app.post()` Effect dispatch)

The `CommandType.Handler` path pushes raw middleware functions. These functions
need to have their return values inspected for Effects. The runner must be
available at dispatch time.

Since `applyCommandsInner` builds closures at `handler()` time, the runner can
be captured in those closures via the parameter threading (Option A above):

```typescript
// In applyCommandsInner for CommandType.Handler:
result.push(async (ctx) => {
  const rawResult = await originalMiddleware(ctx);
  if (effectRunner !== null) {
    return await effectRunner(rawResult, ctx as Context<unknown>);
  }
  return rawResult;
});
```

This wraps each handler middleware in an Effect-aware adapter at route
compilation time.

### For CORE-03 (`app.use()` Effect middleware dispatch)

`runMiddlewares` needs the runner. The cleanest approach is adding an optional
4th parameter:

```typescript
runMiddlewares(handlers, ctx, this.#onError, this.#effectRunner);
```

This matches the existing pattern of passing `this.#onError` as the 3rd
parameter.

---

## Risk Areas

### Risk 1: `renderRoute()` is called from multiple sites in `commands.ts`

`renderRoute` is called in three closures inside `applyCommandsInner`:

1. The lazy route branch (line 290): `return renderRoute(ctx, def);`
2. The non-lazy route branch (line 308):
   `fns.push((ctx) => renderRoute(ctx, route));`
3. The `notFound` closure in `newNotFoundCmd` (commands.ts line 128):
   `fn: (ctx) => renderRoute(ctx, route)`

The `notFound` closure is created in `newNotFoundCmd()` which is called from
`app.notFound()`. At that call time, the `effectRunner` is not yet known (it's
set later). This requires either lazy capture or accepting that `notFound`
handlers don't get Effect dispatch (which may be acceptable — notFound is an
error path).

**Mitigation:** For the `notFound` path, add the runner as a lazy lookup (e.g.,
pass it through `ctx` via a symbol property set in `App.handler()` before
`runMiddlewares`). Or simply exclude `notFound` from Effect dispatch in Phase 6
and document it.

### Risk 2: `segmentToMiddlewares()` closure captures at compile time

`segmentToMiddlewares()` in `segments.ts` creates middleware closures that call
`renderRoute`. These closures are built during `applyCommands` at
`app.handler()` call time. The `effectRunner` must be threaded into
`applyCommands` so it can be captured in the closures.

**Mitigation:** Pass `effectRunner` as a parameter to `applyCommands()` and
`applyCommandsInner()`. Every closure that calls `renderRoute` captures it from
the parameter.

### Risk 3: `isEffect` check in `runMiddlewares` must not import Effect

`middlewares/mod.ts` must stay free of `npm:effect` dependency. The duck-type
check (`"~effect/Effect" in value`) must be inlined or extracted to a shared
utility in `@fresh/core`.

**Mitigation:** Extract a `isEffectLike(value: unknown): boolean` utility
function into `packages/fresh/src/handlers.ts` (alongside `EffectLike<A>` type
definition, which already exists there). Export it and import in
`middlewares/mod.ts`.

### Risk 4: Existing tests comment that `app.get()` does NOT work for Effect handlers

The test files contain explicit warnings:

```
// IMPORTANT: Effect handlers must be registered via app.route() (not app.get()).
// app.route() goes through renderRoute() which calls _effectResolver.
// app.get() registers raw middlewares that bypass renderRoute entirely.
```

This appears in both `integration_test.ts` and `define_test.ts`. After Phase 6,
these comments must be removed and new tests added proving `app.get()` now
works. The existing tests must continue to pass — they only use `app.route()`,
so no behavior change for them.

### Risk 5: Global `setEffectResolver` removal is a breaking change for `internals.ts`

Any external user importing `setEffectResolver` from `@fresh/core/internal` will
break. In this codebase, only `plugin-effect` uses it. If Phase 6 updates
`plugin-effect` in the same changeset, this is not an issue. The planner should
treat them as a single atomic change.

---

## Key Findings

1. **The global lives in `segments.ts` (lines 17-60)** — a module-level `let`
   variable. It is read in exactly one place: `renderRoute()` at line 231.
   Removing it requires threading the runner as a parameter through
   `renderRoute()`, `applyCommands()`, and `applyCommandsInner()`.

2. **`App<State>` already has the exact pattern needed** — `#onError` is a
   private instance field exposed via static accessor. `#effectRunner` follows
   the same pattern. `setEffectRunner` is exported alongside `setBuildCache` /
   `setErrorInterceptor`.

3. **`app.get()` / `app.post()` bypass `renderRoute()` entirely** — they use
   `CommandType.Handler` which pushes raw `Middleware<State>` functions. To make
   CORE-02 work, the handler middleware must be wrapped in an Effect-aware
   adapter during `applyCommandsInner`.

4. **`runMiddlewares()` needs a 4th parameter** — `effectRunner` optional.
   Without it, Effect- returning middlewares registered via `app.use()`
   currently cause the `!(result instanceof Response)` error in `App.handler()`.

5. **`isEffect` check can be inlined** — the duck-type check
   `"~effect/Effect" in value` is 9 characters. It is safe to inline in
   `middlewares/mod.ts` or extract to `handlers.ts` where `EffectLike<A>`
   already lives. No Effect import needed.

6. **Existing integration tests use only `app.route()`** — they will continue to
   pass without modification. New tests are needed for `app.get()` + Effect and
   `app.use()` + Effect.

7. **`plugin-effect` is the sole caller of `setEffectResolver`** — updating it
   is part of the same Phase 6 changeset. No external consumers to worry about.

---

## Code Examples

### Verified: Existing static-accessor pattern in `App<State>` (HIGH confidence)

```typescript
// From packages/fresh/src/app.ts — lines 151-183
export let getBuildCache: <State>(app: App<State>) => BuildCache<State> | null;
export let setBuildCache: <State>(
  app: App<State>,
  cache: BuildCache<State>,
  mode: "development" | "production",
) => void;
export let setErrorInterceptor: <State>(
  app: App<State>,
  fn: (err: unknown) => void,
) => void;

const NOOP = () => {};

export class App<State> {
  #getBuildCache: () => BuildCache<State> | null = () => null;
  #onError: (err: unknown) => void = NOOP;

  static {
    getBuildCache = (app) => app.#getBuildCache();
    setBuildCache = (app, cache, mode) => {
      app.config.root = cache.root;
      app.config.mode = mode;
      app.#getBuildCache = () => cache;
    };
    setErrorInterceptor = (app, fn) => { app.#onError = fn; };
  }
  ...
  handler(): (...) => Promise<Response> {
    ...
    const result = await runMiddlewares(handlers, ctx, this.#onError);
    ...
  }
}
```

### Verified: Current `_effectResolver` usage in `renderRoute()` (HIGH confidence)

```typescript
// From packages/fresh/src/segments.ts — lines 230-234
let result: unknown = await fn(ctx);
if (_effectResolver !== null) {
  result = await _effectResolver(result, ctx as Context<unknown>);
}
return result;
```

### Verified: `EffectLike<A>` duck-type check already in `handlers.ts` (HIGH confidence)

```typescript
// From packages/fresh/src/handlers.ts — lines 200-203
export interface EffectLike<A> {
  // deno-lint-ignore no-explicit-any
  readonly ["~effect/Effect"]: any;
}
```

The same check in `isEffect()` from `resolver.ts`:

```typescript
const EFFECT_TYPE_ID = "~effect/Effect";
export function isEffect(value: unknown): boolean {
  return value !== null && typeof value === "object" &&
    EFFECT_TYPE_ID in (value as object);
}
```

---

## Open Questions

1. **`notFound` handler Effect dispatch**
   - What we know: `newNotFoundCmd()` creates its `renderRoute` closure at
     command registration time, before `#effectRunner` is set.
   - What's unclear: Whether notFound handlers need Effect support in Phase 6.
   - Recommendation: Defer notFound Effect dispatch to a follow-up. Document it
     as known limitation. Success criteria don't mention notFound.

2. **`app.mountApp()` interaction**
   - What we know: `mountApp()` copies commands from the inner app into the
     outer app. The inner app's `#effectRunner` would be lost.
   - What's unclear: Whether mounted apps should inherit or override the
     parent's runner.
   - Recommendation: Out of scope for Phase 6. `mountApp` is not in success
     criteria.

3. **`MaybeLazyMiddleware` type union for Effect returns**
   - What we know: `Middleware<State>` returns `Response | Promise<Response>`.
     Effect is not in this union.
   - What's unclear: Whether the type union should be extended to include
     `EffectLike<Response>` or whether Effect dispatch happens at runtime only
     (type-erasure approach).
   - Recommendation: Runtime-only check (type-erasure) for Phase 6. Extending
     the type union has downstream effects on all middleware definitions. The
     `HandlerFn` type already includes `EffectLike<A>` — follow the same pattern
     and extend `Middleware<State>` if needed.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)

- `packages/fresh/src/segments.ts` — `_effectResolver` global,
  `setEffectResolver`, `renderRoute`
- `packages/fresh/src/app.ts` — `App<State>`, `#onError`, `setBuildCache`,
  `setErrorInterceptor`, `handler()`
- `packages/fresh/src/internals.ts` — current public internal exports
- `packages/fresh/src/middlewares/mod.ts` — `runMiddlewares`,
  `MaybeLazyMiddleware`
- `packages/fresh/src/handlers.ts` — `EffectLike<A>`, `HandlerFn`,
  `isHandlerByMethod`
- `packages/fresh/src/commands.ts` — `CommandType`, `applyCommands`,
  `applyCommandsInner`, `newHandlerCmd`
- `packages/fresh/src/context.ts` — `Context<State>`, static accessor pattern
- `packages/plugin-effect/src/mod.ts` — `effectPlugin()`, `setEffectResolver`
  call site
- `packages/plugin-effect/src/resolver.ts` — `createResolver`, `isEffect`
- `packages/plugin-effect/src/runtime.ts` — `makeRuntime`, `registerDisposal`
- `packages/plugin-effect/tests/integration_test.ts` — existing tests that must
  stay green
- `packages/plugin-effect/tests/plugin_test.ts` — existing plugin unit tests
- `packages/plugin-effect/tests/define_test.ts` — existing define tests
- `packages/plugin-effect/tests/resolver_test.ts` — existing resolver tests

---

## Metadata

**Confidence breakdown:**

- Current architecture: HIGH — read directly from source files
- Change surface identification: HIGH — derived from direct source analysis
- API design recommendations: HIGH — follows established codebase patterns
- Risk areas: HIGH — derived from code structure, not speculation

**Research date:** 2026-02-25 **Valid until:** No external dependencies —
entirely internal codebase research. Valid until files change.
