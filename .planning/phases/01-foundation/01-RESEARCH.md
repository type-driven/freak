# Phase 1: Foundation - Research

**Researched:** 2026-02-18
**Domain:** Effect v4 + Fresh 2 integration: handler dispatch, runtime wiring, error handling
**Confidence:** HIGH — all findings verified from primary sources (actual source files, npm dist)

---

## Summary

Phase 1 establishes the three-part foundation: (1) duck-typed `EffectLike` detection in Fresh
core that keeps Effect types out of `@fresh/core`'s public API, (2) the `effectPlugin()`
middleware that creates a `ManagedRuntime` singleton before the request loop and disposes it
on Deno `unload`, and (3) error dispatch using `runPromiseExit` so unhandled Effect failures
map to Fresh's existing error page rather than crashing the Deno process.

All eight key questions from the research brief are answered definitively from direct source
reads and verified dist files. The one previously-flagged blocker (exact `EffectTypeId` value)
is now resolved: in Effect v4 (`4.0.0-beta.0`) the TypeId is the string `"~effect/Effect"`,
not a Symbol. This changes the detection implementation.

**Primary recommendation:** Implement `setEffectResolver()` as a module-level function in
`segments.ts` that accepts a callback; `effectPlugin()` registers the callback. The resolver
pattern is the only approach that keeps Fresh core free of any `effect` package import while
allowing full runtime dispatch through the plugin.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `npm:effect` | `4.0.0-beta.0` | Effect runtime, ManagedRuntime, Exit | Only stable v4 target |
| `jsr:@fresh/core` | `^2.0.0` | Fresh framework (modified in 3 files) | Existing project dep |
| Deno 2 | latest | Runtime, JSR publishing, `unload` event | Project platform |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `npm:effect/ManagedRuntime` | bundled with effect | Runtime lifecycle management | Always — shared across requests |
| `npm:effect/Exit` | bundled with effect | Typed error dispatch | `runPromiseExit` in resolver |
| `npm:effect/Layer` | bundled with effect | Service layer construction | `effectPlugin({ layer })` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ManagedRuntime.make(layer)` singleton | Per-request `Effect.runPromise(Effect.provide(...))` | Per-request is expensive; singleton is correct approach for server |
| `setEffectResolver()` hook pattern | Importing Effect directly in `segments.ts` | Direct import leaks Effect into `@fresh/core` public API (JSR break) |
| `runPromiseExit` for dispatch | `runPromise().catch()` | `runPromiseExit` gives typed `Exit<A, E>`; `.catch()` loses type information |

**Installation (for `plugin-effect` package):**
```bash
# In packages/plugin-effect/deno.json imports:
"effect": "npm:effect@4.0.0-beta.0"
```

---

## Architecture Patterns

### Recommended Project Structure
```
packages/
  fresh/src/
    segments.ts          # Modified: add setEffectResolver() + resolver call in renderRoute()
    handlers.ts          # Modified: add EffectLike structural type (no Effect import)
  plugin-effect/src/
    mod.ts               # exports effectPlugin(), EffectPluginOptions
    runtime.ts           # ManagedRuntime lifecycle: make(), dispose()
    resolver.ts          # isEffect() detector + resolver callback implementation
    types.ts             # EffectHandlerFn type (imports from effect — stays in plugin)
```

### Pattern 1: setEffectResolver() Hook in segments.ts

**What:** A module-level resolver function registered by the plugin, called in `renderRoute`
after the handler returns. Keeps Fresh core with zero knowledge of Effect.

**When to use:** Always — this is the only JSR-safe integration point.

**Implementation in `packages/fresh/src/segments.ts`:**
```typescript
// Source: direct read of packages/fresh/src/segments.ts

// Module-level resolver — null unless effectPlugin is installed
let _effectResolver:
  | ((value: unknown, ctx: Context<unknown>) => Promise<unknown>)
  | null = null;

export function setEffectResolver(
  fn: (value: unknown, ctx: Context<unknown>) => Promise<unknown>,
): void {
  _effectResolver = fn;
}

// In renderRoute(), replace:
//   return await fn(ctx);
// With:
let res = await fn(ctx);
if (_effectResolver !== null) {
  res = await _effectResolver(res, ctx);
}
// (res is then used in the existing instanceof Response / PageResponse branches)
```

### Pattern 2: EffectLike Structural Type in handlers.ts

**What:** A structural type that matches Effect's shape without importing from `npm:effect`.
Used in `HandlerFn` to extend the return type union.

**When to use:** When extending `HandlerFn` union in `@fresh/core`.

**Implementation:**
```typescript
// Source: Effect v4 dist inspection — EffectTypeId = "~effect/Effect"

// In packages/fresh/src/handlers.ts (no npm:effect import):
export interface EffectLike<A> {
  readonly ["~effect/Effect"]: unknown;
  // structural match — any object with this key passes
}

// Extend HandlerFn return type:
export interface HandlerFn<Data, State> {
  (ctx: Context<State>):
    | Response
    | PageResponse<Data>
    | Promise<Response | PageResponse<Data>>
    | EffectLike<Response | PageResponse<Data>>;  // added
}
```

**JSR safety:** `EffectLike` uses a string literal key, no `import from "npm:effect"`. Safe to
publish on JSR.

### Pattern 3: effectPlugin() Middleware

**What:** Creates `ManagedRuntime` singleton once at `effectPlugin()` call time, registers
the resolver in `segments.ts`, attaches runtime to `ctx.state` per-request.

**When to use:** App entry point — `app.use(effectPlugin({ layer }))`.

**Implementation:**
```typescript
// Source: ManagedRuntime v4 dist + segments.ts source

import { ManagedRuntime, Layer } from "effect";
import { setEffectResolver } from "@fresh/core/internal"; // internal export

export interface EffectPluginOptions<R, E> {
  layer?: Layer.Layer<R, E, never>;
  mapError?: (err: unknown) => Response;
}

export function effectPlugin<R, E>(
  options: EffectPluginOptions<R, E> = {},
): Middleware<{ effectRuntime: ManagedRuntime.ManagedRuntime<R, E> }> {
  const layer = options.layer ?? Layer.empty;
  const runtime = ManagedRuntime.make(layer);  // called once here

  // Register resolver in Fresh core
  setEffectResolver(async (value, ctx) => {
    if (!isEffect(value)) return value;  // not an Effect, pass through
    const result = await runtime.runPromiseExit(value as Effect<unknown, E, R>);
    if (Exit.isSuccess(result)) return result.value;
    // failure: map to response
    if (options.mapError) return options.mapError(result.cause);
    throw result.cause;  // propagates to Fresh error page
  });

  // Dispose on process exit
  globalThis.addEventListener("unload", () => {
    runtime.dispose();
  });

  // Middleware: attach runtime to ctx.state
  return (ctx) => {
    (ctx.state as Record<string, unknown>).effectRuntime = runtime;
    return ctx.next();
  };
}
```

### Pattern 4: isEffect() Duck-Type Detector

**What:** Runtime detection using the string key `"~effect/Effect"` (Effect v4's TypeId).

**Critical finding:** In Effect v4 (`4.0.0-beta.0`), `EffectTypeId` is a **string literal**
`"~effect/Effect"`, not a `Symbol.for()`. The v3 approach (`Symbol.for("effect/Effect")`)
is wrong for v4.

**Verified from:** `cdn.jsdelivr.net/npm/effect@4.0.0-beta.0/dist/internal/core.js` line 1:
```javascript
export const EffectTypeId = `~effect/Effect`;
```

And from `Effect.js`:
```javascript
export const isEffect = u => typeof u === "object" && u !== null && TypeId in u;
```

**Implementation (in plugin-effect, not in @fresh/core):**
```typescript
// Source: Effect v4 dist/internal/core.js
const EFFECT_TYPE_ID = "~effect/Effect";

export function isEffect(value: unknown): value is EffectLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    EFFECT_TYPE_ID in (value as object)
  );
}
```

### Anti-Patterns to Avoid

- **Importing `Effect` in `segments.ts`:** Puts `npm:effect` in `@fresh/core`'s dependency
  graph and violates JSR's "no slow types" constraint on public API types.
- **Using `Symbol.for("effect/Effect")`:** This is the v3 symbol. Effect v4 uses a string key
  `"~effect/Effect"`. Using the old symbol causes `isEffect()` to always return false.
- **Creating `ManagedRuntime` inside the request handler:** Layer initialization runs Effects
  to build services. This leaks connection pools and fiber resources on every request.
- **Adding `E` type parameter to `HandlerFn`:** Cascades into `RouteHandler`, `HandlerByMethod`,
  `Route`, `Define`, and breaks all existing typed routes. Use `EffectLike<A>` without `E`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Effect detection | Custom reflection/tag check | `"~effect/Effect" in value` (string key) | Effect v4 uses string keys, not Symbols |
| Runtime disposal | Manual cleanup code | `ManagedRuntime.dispose()` + `globalThis.addEventListener("unload", ...)` | Effect manages fiber cancellation and scope closing |
| Typed error dispatch | `try/catch` around `runPromise` | `runPromiseExit` → `Exit.isSuccess/isFailure` | `runPromise` re-throws; `runPromiseExit` gives typed `Exit<A, E>` |
| Service provision | Manual Effect.provide() per-request | `ManagedRuntime` (caches built services) | ManagedRuntime uses memo-map to avoid rebuilding Layer on every call |

**Key insight:** The Effect v4 `ManagedRuntime` is the right abstraction for per-application
runtime management. It caches the built `ServiceMap` (was `Context<R>` in v3) from the Layer
so each `runPromise` call doesn't rebuild services from scratch.

---

## Common Pitfalls

### Pitfall 1: Wrong TypeId String (v3 vs v4)

**What goes wrong:** Using `Symbol.for("effect/Effect")` (v3 TypeId) instead of the string
`"~effect/Effect"` (v4 TypeId). `isEffect()` always returns false. Effect handlers silently
fall through to the `instanceof Response` path and crash with a "PageResponse required" error.

**Why it happens:** The v3 TypeId was a Symbol created with `Symbol.for()`. In v4 (effect-smol),
the Effect team switched to plain string literals as TypeIds to avoid cross-realm Symbol issues.

**How to avoid:** Use the string literal `"~effect/Effect"`. The string is verified from the
published npm dist at `cdn.jsdelivr.net/npm/effect@4.0.0-beta.0/dist/internal/core.js`.

**Warning signs:** Effect-returning handler receives a 500 "Expected Response instance" error.

### Pitfall 2: EffectTypeId Might Change Before v4 Stable

**What goes wrong:** Effect v4 is in active beta. The `~effect/Effect` string could change
before stable release. If it does, `isEffect()` silently breaks.

**Why it happens:** The `unstable/` marker and beta status signal ongoing API evolution.

**How to avoid:** Put `isEffect()` in a single file (`resolver.ts`) with a comment pointing
to the verification source. When upgrading the effect version, re-verify the string.

**Warning signs:** Handler detection stops working after an `effect` version bump.

### Pitfall 3: ManagedRuntime Created Per-Request

**What goes wrong:** `ManagedRuntime.make(layer)` inside the middleware per-request. Database
connections, HTTP clients, and other Layer resources are created and leaked for each request.

**Why it happens:** The runtime creation looks lightweight; the cost is in Layer initialization.

**How to avoid:** Call `ManagedRuntime.make(layer)` exactly once in `effectPlugin()` body
(not inside the returned `Middleware` function). The returned middleware function only sets
`ctx.state.effectRuntime = runtime` (the reference, not a new instance).

### Pitfall 4: Unhandled Effect Failures Crash Deno

**What goes wrong:** `runtime.runPromise(effect)` throws on Effect failure. If not caught,
it propagates up through Fresh's middleware chain to `App.handler()`'s try/catch, which calls
`DEFAULT_ERROR_HANDLER`. But if it leaks past that, Deno exits on unhandled promise rejection.

**Why it happens:** Unlike Node.js, Deno has no `unhandledRejection` safety net.

**How to avoid:** In the resolver, always use `runPromiseExit` to get a typed `Exit<A, E>`:
```typescript
const exit = await runtime.runPromiseExit(effect);
if (Exit.isFailure(exit)) {
  // convert to Response or re-throw as HttpError — never let it be unhandled
  throw new HttpError(500, "Internal Effect failure");
}
return exit.value;
```

### Pitfall 5: ctx.state Requires Type Cast in Plugin

**What goes wrong:** `ctx.state` is typed as `State` (the App generic). A plugin using
`app.use()` cannot change `App<State>` at the call site — the user's App type is fixed.

**Why it happens:** Fresh's `App<State>` generic is invariant; middlewares receive
`Context<State>` where `State` is the user's type.

**How to avoid:** The plugin casts to `Record<string, unknown>` when setting:
```typescript
(ctx.state as Record<string, unknown>).effectRuntime = runtime;
```
In the resolver, access via the same cast:
```typescript
const runtime = (ctx.state as Record<string, unknown>).effectRuntime;
```
For typed access in user route handlers, provide a typed accessor helper in `plugin-effect`.

---

## Code Examples

### Full renderRoute Modification (segments.ts)

```typescript
// Source: packages/fresh/src/segments.ts (direct read)
// Modified section at ~line 166-190

// At module level (new):
let _effectResolver:
  | ((value: unknown, ctx: Context<unknown>) => Promise<unknown>)
  | null = null;

export function setEffectResolver(
  fn: (value: unknown, ctx: Context<unknown>) => Promise<unknown>,
): void {
  _effectResolver = fn;
}

// In renderRoute(), replace the tracer span body:
const res = await tracer.startActiveSpan("handler", {
  attributes: { "fresh.span_type": "fs_routes/handler" },
}, async (span) => {
  try {
    let fn: HandlerFn<unknown, State> | null = null;
    if (isHandlerByMethod(handlers)) {
      if (handlers[method] !== undefined) {
        fn = handlers[method];
      } else if (method === "HEAD" && handlers.GET !== undefined) {
        fn = handlers.GET;
      }
    } else {
      fn = handlers;
    }

    if (fn === null) return await ctx.next();

    // CHANGED: was `return await fn(ctx)`
    let result: unknown = await fn(ctx);
    if (_effectResolver !== null) {
      result = await _effectResolver(result, ctx);  // resolver handles isEffect check
    }
    return result;
  } catch (err) {
    recordSpanError(span, err);
    throw err;
  } finally {
    span.end();
  }
});
```

### EffectLike Structural Type (handlers.ts)

```typescript
// Source: Effect v4 dist/internal/core.js — EffectTypeId = "~effect/Effect"
// This type lives in @fresh/core — zero npm:effect import required

/** Structural type matching Effect v4 objects. Uses string key, not Symbol. */
export interface EffectLike<A> {
  // deno-lint-ignore no-explicit-any
  readonly ["~effect/Effect"]: any;
}

// Extended HandlerFn (added EffectLike<...> to the return union):
export interface HandlerFn<Data, State> {
  (ctx: Context<State>):
    | Response
    | PageResponse<Data>
    | Promise<Response | PageResponse<Data>>
    | EffectLike<Response | PageResponse<Data>>;
}
```

### ManagedRuntime Lifecycle (runtime.ts in plugin-effect)

```typescript
// Source: effect@4.0.0-beta.0/dist/ManagedRuntime.js

import { ManagedRuntime, Layer, Exit } from "effect";
import type { Layer as LayerType } from "effect";

// Create once, share across all requests
export function makeRuntime<R, E>(
  layer: LayerType.Layer<R, E, never>,
): ManagedRuntime.ManagedRuntime<R, E> {
  return ManagedRuntime.make(layer);
}

// Dispose on process exit
export function registerDisposal(
  runtime: ManagedRuntime.ManagedRuntime<unknown, unknown>,
): void {
  globalThis.addEventListener("unload", () => {
    // dispose() returns Promise<void> — fire-and-forget on unload
    runtime.dispose().catch(() => {});
  });
}
```

### Error Dispatch with runPromiseExit

```typescript
// Source: effect@4.0.0-beta.0/dist/Exit.js — isSuccess, isFailure exports

import { Exit } from "effect";

async function runEffectToResponse(
  runtime: ManagedRuntime.ManagedRuntime<R, E>,
  effect: EffectLike<Response | PageResponse<unknown>>,
  mapError?: (cause: unknown) => Response,
): Promise<Response | PageResponse<unknown>> {
  const exit = await runtime.runPromiseExit(
    effect as Effect<Response | PageResponse<unknown>, E, R>,
  );

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  // Failure: convert to Response or re-throw as HttpError
  if (mapError) {
    return mapError(exit.cause);
  }

  // Default: throw to Fresh's error page mechanism
  throw exit.cause;
}
```

---

## State of the Art

| Old Approach (v3) | Current Approach (v4) | Impact |
|---|---|---|
| `Symbol.for("effect/Effect")` as TypeId | String `"~effect/Effect"` as TypeId | Detection uses `in` operator on string key |
| `Effect.EffectTypeId` as `unique symbol` | `Effect.EffectTypeId` as `string` | `typeof EffectTypeId === "string"` in v4 |
| `Runtime<R>` | `ManagedRuntime<R, E>` | ManagedRuntime unchanged in v4 |
| `Context.Tag<T>` | `ServiceMap.Service<T, I>` | Service definition syntax changed |

**Deprecated/outdated:**
- `Symbol.for("effect/Effect")`: v3 only. Effect v4 uses string `"~effect/Effect"`.
- `@effect-atom/atom@0.5.x`: v3-only package, incompatible with Effect v4. Phase 1 does not use atoms.

---

## Open Questions

1. **`setEffectResolver` export path from `@fresh/core`**
   - What we know: The function needs to be callable from `plugin-effect` without going through the public `mod.ts` API
   - What's unclear: Should it be exported from `@fresh/core/internal` (the existing `internals.ts` export) or from a new internal export?
   - Recommendation: Add to `packages/fresh/src/internals.ts` (already exported as `./internal` in `deno.json`) or create a new dedicated `./effect` export path. Verify existing `internals.ts` pattern before planning tasks.

2. **Exit.cause type in Effect v4**
   - What we know: `Exit.isFailure(exit)` narrows to `Exit.Failure<E>` with a `.cause` property of type `Cause<E>`
   - What's unclear: Whether `Cause<E>` can be directly thrown as a JavaScript error or requires `Cause.pretty()` / `Cause.squash()` first
   - Recommendation: Plan a task to verify the `Cause` API and decide the error-to-`HttpError` mapping in the resolver.

3. **`HandlerFn` return type narrowing with `EffectLike`**
   - What we know: The `EffectLike<A>` structural type extension is JSR-safe
   - What's unclear: Whether adding `EffectLike<Response | PageResponse<Data>>` to `HandlerFn`'s return union breaks existing TypeScript inference for non-Effect handlers via `define.handlers()`
   - Recommendation: Write `expect-type` assertions in a test file before merging. If `data` prop on page components infers as `never`, the `RouteData<H>` conditional type needs an additional `EffectLike` branch.

---

## Sources

### Primary (HIGH confidence)

- `packages/fresh/src/segments.ts` — direct source read: `renderRoute()` at line 143, handler call at line 183, error routing via `errorRoute`
- `packages/fresh/src/handlers.ts` — direct source read: `HandlerFn` interface, `RouteHandler` union
- `packages/fresh/src/context.ts` — direct source read: `ctx.state: State` typing, `ctx.error` for error page
- `packages/fresh/src/app.ts` — direct source read: `App<State>.use()`, middleware chain, `DEFAULT_ERROR_HANDLER`
- `packages/fresh/src/middlewares/mod.ts` — direct source read: `runMiddlewares`, error propagation
- `packages/fresh/src/mod.ts` — direct source read: public API exports (no Effect types currently)
- `cdn.jsdelivr.net/npm/effect@4.0.0-beta.0/dist/internal/core.js` — EffectTypeId = `"~effect/Effect"` (string literal, not Symbol)
- `cdn.jsdelivr.net/npm/effect@4.0.0-beta.0/dist/Effect.js` — `isEffect` export verified
- `cdn.jsdelivr.net/npm/effect@4.0.0-beta.0/dist/ManagedRuntime.js` — `make()`, `runPromiseExit()`, `dispose()` verified
- `cdn.jsdelivr.net/npm/effect@4.0.0-beta.0/dist/Exit.js` — `isSuccess`, `isFailure` exports verified
- `cdn.jsdelivr.net/npm/effect@4.0.0-beta.0/dist/index.js` — `ManagedRuntime` exported as namespace

### Secondary (MEDIUM confidence)

- `.planning/research/ARCHITECTURE.md` — prior research from 2026-02-18: pipeline diagram, integration patterns
- `.planning/research/PITFALLS.md` — prior research from 2026-02-18: JSR constraint, HandlerFn cascade risk
- `.planning/research/STACK.md` — prior research from 2026-02-18: Effect v4 package versions, ManagedRuntime API

### Tertiary (LOW confidence)

- None for Phase 1 findings — all critical facts verified from primary sources.

---

## Metadata

**Confidence breakdown:**
- Effect TypeId value: HIGH — verified from published npm dist (not training data)
- `segments.ts` handler dispatch: HIGH — direct local source read
- `setEffectResolver` pattern: HIGH — no existing hook; must be new code
- `HandlerFn` extension with `EffectLike`: HIGH — structural type, JSR constraint understood
- ManagedRuntime v4 API: HIGH — verified from published npm dist
- Fresh error page mechanism: HIGH — direct source read of `segments.ts` + `app.ts`
- `ctx.state` typing: HIGH — direct source read; cast pattern required for plugins
- HandlerFn type inference safety: MEDIUM — structural change, needs `expect-type` validation

**Research date:** 2026-02-18
**Valid until:** 30 days for stable parts; re-verify `EffectTypeId` string on each `effect` beta bump

---

## Answer Index (by Key Question)

### 1. Effect v4 TypeId

**Confirmed:** In `effect@4.0.0-beta.0`, `EffectTypeId` is the string literal `"~effect/Effect"`.

- It is NOT `Symbol.for("effect/Effect")` (that was v3).
- It is a plain string constant: `export const EffectTypeId = \`~effect/Effect\` as const`
- Source: `dist/internal/core.js` line 1 in the published npm package.
- The `isEffect` guard in `dist/Effect.js`: `u => typeof u === "object" && u !== null && TypeId in u`
- `EffectTypeId` is NOT re-exported from the main `effect` index or from `Effect.js` as a public name; it's only accessible as `Effect.EffectTypeId` via the namespace import — but for duck-typing, only the string value matters.

**isEffect implementation for plugin-effect:**
```typescript
const EFFECT_TYPE_ID = "~effect/Effect";
export function isEffect(value: unknown): boolean {
  return value !== null &&
    typeof value === "object" &&
    EFFECT_TYPE_ID in (value as object);
}
```

### 2. Fresh 2 Handler Dispatch

**File:** `packages/fresh/src/segments.ts`

`renderRoute()` at line 143 is the only place `HandlerFn` return values are consumed. The handler
call is at line 183: `return await fn(ctx)`. This is the sole integration point for Effect detection.

The flow is:
1. `App.handler()` → `runMiddlewares()` → `segmentMiddleware` → `renderRoute()`
2. `renderRoute()` selects the correct `fn` from `HandlerByMethod` or uses the catch-all
3. `const res = await fn(ctx)` — handler is called here
4. `if (res instanceof Response)` returns directly
5. Otherwise treats `res` as `PageResponse<Data>` and renders with `ctx.render()`

**Where to intercept:** Between step 3 and step 4. The `_effectResolver` is called with the raw
result. If it's an Effect, the resolver runs it and returns the unwrapped value; otherwise passes
through.

### 3. Fresh 2 Plugin API

Fresh 2 has **no formal plugin interface** separate from `App`. The extension mechanism is:
- `app.use(middleware)` — registers a `Middleware<State>` at the root path
- `app.mountApp(path, otherApp)` — merges another App instance

The plugin pattern is: export a function that accepts options and returns a `Middleware<State>`.
The caller does `app.use(effectPlugin({ layer }))`.

Additionally, `effectPlugin` must call `setEffectResolver()` from `segments.ts` at setup time.
This requires `setEffectResolver` to be exported from `@fresh/core/internal` (the existing
`./internal` export path in Fresh's `deno.json`).

**No lifecycle hooks exist** in Fresh 2 (`App`, `FreshConfig`, `ResolvedFreshConfig` all verified —
no `onStart`/`onStop`). Disposal uses `globalThis.addEventListener("unload", ...)`.

### 4. ManagedRuntime v4 API

All confirmed from `effect@4.0.0-beta.0` dist:

```typescript
// Constructor
ManagedRuntime.make<R, E>(layer: Layer.Layer<R, E, never>): ManagedRuntime.ManagedRuntime<R, E>

// Execution
runtime.runPromise<A, E>(effect: Effect<A, E, R>, options?: { signal?: AbortSignal }): Promise<A>
runtime.runPromiseExit<A, E>(effect: Effect<A, E, R>): Promise<Exit.Exit<A, E | ER>>
runtime.runSync<A, E>(effect: Effect<A, E, R>): A
runtime.runFork<A, E>(effect: Effect<A, E, R>): Fiber.Fiber<A, E | ER>

// Lifecycle
runtime.dispose(): Promise<void>
```

**`ManagedRuntime.ManagedRuntime`** is a TypeId-tagged object (TypeId: `"~effect/ManagedRuntime"`).

`make()` creates a memo map and lazy `servicesEffect`. Services are built on first `runPromise`
call and cached. Subsequent calls use cached services — no layer reconstruction per-request.

### 5. HandlerFn Extension Pattern

**Current HandlerFn** (`handlers.ts` line 193):
```typescript
export interface HandlerFn<Data, State> {
  (ctx: Context<State>):
    | Response
    | PageResponse<Data>
    | Promise<Response | PageResponse<Data>>;
}
```

**Recommended extension:**
1. Add `EffectLike<A>` structural type to `handlers.ts` (no `npm:effect` import):
   ```typescript
   export interface EffectLike<A> {
     readonly ["~effect/Effect"]: unknown;
   }
   ```
2. Extend `HandlerFn` return union with `EffectLike<Response | PageResponse<Data>>`
3. Do NOT add an `E` type parameter to `HandlerFn` (cascades into RouteHandler, HandlerByMethod,
   Route, Define — breaking change for all existing routes)
4. The error type is handled at the resolver level, not the type level

**Risk:** Adding `EffectLike` to the union may affect TypeScript inference in `define.handlers()`.
Plan a verification task with `expect-type` assertions before merging.

### 6. setEffectResolver Pattern

**No existing hook** in Fresh 2. This is new code.

**Implementation location:** `packages/fresh/src/segments.ts` — module-level nullable function.

**Registration flow:**
1. `effectPlugin()` is called at app setup time
2. Inside `effectPlugin()`, `setEffectResolver(fn)` is called with the detection + dispatch callback
3. `renderRoute()` in `segments.ts` calls `_effectResolver(result, ctx)` if non-null

**Export path:** `setEffectResolver` must be exported from `@fresh/core` in a way that `plugin-effect`
can import it without it appearing in the standard public API. The existing `./internal` export
path (`packages/fresh/src/internals.ts` → `./internal` in deno.json) is the correct mechanism.

Add to `internals.ts`:
```typescript
export { setEffectResolver } from "./segments.ts";
```

### 7. Fresh Error Page Mechanism

Fresh's error handling has two layers:

**Layer 1 — `segmentMiddleware` in `segments.ts` (line 93-133):**
```typescript
try {
  return await ctx.next();
} catch (err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (root.notFound !== null && status === 404) {
    return await root.notFound(ctx);
  }
  if (errorRoute !== null) {
    return await renderRoute(ctx, errorRoute, status);
  }
  throw err;  // propagates to Layer 2
}
```

**Layer 2 — `DEFAULT_ERROR_HANDLER` in `app.ts` (line 50-64):**
```typescript
const DEFAULT_ERROR_HANDLER = async (ctx) => {
  const { error } = ctx;
  if (error instanceof HttpError) {
    return new Response(error.message, { status: error.status });
  }
  return new Response("Internal server error", { status: 500 });
};
```

**Integration for Effect failures:** If the resolver re-throws `exit.cause` (the Effect Cause),
it propagates through the middleware chain. If the route has an `_error.tsx`, Layer 1 catches it
and renders the error route. Otherwise Layer 2 returns a plain 500 response.

**Recommendation:** To use the `_error.tsx` error page, throw an `HttpError` from the resolver:
```typescript
if (Exit.isFailure(exit)) {
  throw new HttpError(500, "Effect handler failure");
}
```
This lets the existing `segmentMiddleware` error routing work correctly.

### 8. ctx.state Extension

**Current typing:** `readonly state: State = {} as State` in `Context<State>`.

`State` is the generic on `App<State>`. A plugin added via `app.use()` receives `Context<State>`
but cannot change the `State` generic.

**Plugin approach (cast pattern):**
```typescript
// Setting in middleware:
(ctx.state as Record<string, unknown>).effectRuntime = runtime;

// Reading in resolver:
const runtime = (ctx.state as Record<string, unknown>).effectRuntime;
```

**Typed user-facing access:** Provide a helper in `plugin-effect`:
```typescript
export function getEffectRuntime<R, E>(
  ctx: Context<unknown>,
): ManagedRuntime.ManagedRuntime<R, E> | undefined {
  return (ctx.state as Record<string, unknown>).effectRuntime as
    ManagedRuntime.ManagedRuntime<R, E> | undefined;
}
```

Users who want type-safe state extend their `State` type to include `effectRuntime`:
```typescript
type AppState = {
  effectRuntime: ManagedRuntime.ManagedRuntime<AppServices, never>;
};
const app = new App<AppState>();
app.use(effectPlugin({ layer: AppLayer }));
```

---

## Key Decisions for Planning

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Effect TypeId value | `"~effect/Effect"` (string) | Verified from v4 npm dist; v3 Symbol approach is wrong |
| Integration point | `setEffectResolver()` hook in `segments.ts` | Keeps `@fresh/core` Effect-free; resolver is plugin concern |
| `EffectLike` type | Structural type with string key in `handlers.ts` | JSR-safe; no `npm:effect` import in core |
| `E` type param on `HandlerFn` | Do NOT add | Cascades into all existing route types |
| Runtime creation timing | At `effectPlugin()` call time, before requests | ManagedRuntime is expensive to create; must be singleton |
| Runtime disposal | `globalThis.addEventListener("unload", ...)` | No Fresh app lifecycle hooks exist |
| Error dispatch method | `runPromiseExit` → `Exit.isSuccess/isFailure` | Typed; safe; never unhandled |
| Effect failures to error page | `throw new HttpError(500, ...)` | Reuses existing `segmentMiddleware` error routing |
| ctx.state access pattern | Cast to `Record<string, unknown>` in plugin | State generic is fixed by user; plugin cannot extend it |
| setEffectResolver export path | Via `@fresh/core/internal` (`internals.ts`) | Existing mechanism for internal-only exports |

---

## Risk Areas

1. **Effect beta TypeId churn:** The string `"~effect/Effect"` is from `4.0.0-beta.0`. If a beta
   bump changes it, `isEffect()` silently fails. Mitigate: verify string on every effect version bump.

2. **HandlerFn inference cascade:** Adding `EffectLike` to `HandlerFn` return union may break
   `define.handlers()` type inference. Verify with `expect-type` tests before merging. If broken,
   fall back to detecting Effect purely at runtime (no type change in core).

3. **`internals.ts` as export path:** The `./internal` export from `@fresh/core` is marked internal
   but is part of the published package (`deno.json` exports include `"./internal"`). Using it for
   `setEffectResolver` is the correct approach, but any public `./internal` consumer could call
   it directly. This is acceptable — the export is already internal-by-convention, not access-controlled.

4. **`ctx.req.signal` availability:** The resolver should pass `ctx.req.signal` to `runPromiseExit`
   for AbortSignal cancellation. `Request.signal` is part of the Fetch API spec and available in
   Deno 2 — but verify it's non-null in all Fresh request paths before using it.
