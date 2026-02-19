# Phase 2: Type-Safe API - Research

**Researched:** 2026-02-19
**Domain:** TypeScript generic threading, Effect v4 type system, Fresh define pattern extension
**Confidence:** HIGH — all findings verified from actual codebase files and Effect v4 dist types

---

## Summary

Phase 2 adds `createEffectDefine<State, R>()` to `@fresh/plugin-effect`. This is a
compile-time-only wrapper: it threads the `R` type parameter (Layer service requirements)
through to handler return types so that using a service not provided by the configured Layer
is a TypeScript error at the handler definition site. Runtime behavior is unchanged —
`effectPlugin()` still executes the Effect.

The core mechanism is simple: `createEffectDefine<State, R>()` returns a `handlers()` function
that accepts only handlers returning `Effect<Response | PageResponse<Data>, E, R>` (or subsets
thereof). TypeScript's type system enforces this — any handler that `yield*`s a service not in
`R` will fail to compile because the inferred `R` of that Effect will be wider than the declared
`R`.

The standalone path (with a Layer value) creates its own `ManagedRuntime` and calls
`setEffectResolver()` directly, making `effectPlugin()` optional. The type-parameter-only
path (no Layer value) skips runtime setup and relies on `effectPlugin()` having already
registered the resolver.

**Primary recommendation:** `createEffectDefine<State, R>()` returns an object with a
`handlers()` method that acts as an identity function with constrained types. Mirror
Fresh's existing `createDefine<State>()` API shape exactly — same method names, same
pass-through implementation, just narrower type constraints on the `handlers()` method.

---

## Standard Stack

### Core (all already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `npm:effect` | `4.0.0-beta.0` | `Effect<A, E, R>` type, `Layer`, `ManagedRuntime` | Already in `plugin-effect` |
| `jsr:@fresh/core` | `^2.0.0` | `EffectLike`, `HandlerFn`, `PageResponse` types | Already in `plugin-effect` |
| TypeScript (Deno built-in) | Deno 2 bundled | Generic constraint enforcement | Platform |

### Supporting (new additions)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `npm:expect-type` | `^1.1.0` | Compile-time type assertions in tests | Type-level tests only |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `npm:expect-type` | `@ts-expect-error` comments | `expect-type` is more expressive; `@ts-expect-error` is simpler but only checks "error exists", not what the type IS |
| `npm:expect-type` | Hand-rolled `AssertType<A, B>` helper | `expect-type` is battle-tested; hand-rolling has known pitfalls with unions and `any` |
| Object with `handlers()` method | Handler-wrapper function | Object mirrors Fresh's `createDefine()` shape exactly — less cognitive overhead for users |

**Installation (add to `packages/plugin-effect/deno.json` imports for dev/test only):**

The `expect-type` package is npm-only (not on JSR as of 2026-02-19). Use npm specifier in
the test file directly rather than adding to `deno.json` imports (cleaner for a dev-only dep):

```typescript
import { expectTypeOf } from "npm:expect-type@^1.1.0";
```

Alternatively add to `deno.json` imports:
```json
{
  "imports": {
    "expect-type": "npm:expect-type@^1.1.0"
  }
}
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/plugin-effect/
  src/
    mod.ts              # Add: export createEffectDefine
    define.ts           # New: createEffectDefine<State, R>() implementation
    runtime.ts          # Unchanged: makeRuntime, registerDisposal
    resolver.ts         # Unchanged: isEffect, createResolver
    types.ts            # Unchanged: re-exported Layer, ManagedRuntime types
  tests/
    define_test.ts      # New: runtime tests (standalone path works end-to-end)
    define_types_test.ts # New: type-level tests using expect-type
```

### Pattern 1: createEffectDefine API Shape

**What:** Mirrors `createDefine<State>()` from `@fresh/core`. Returns an object with a
`handlers()` method that accepts only handlers constrained to `Effect<..., R>` return types.

**When to use:** When the developer wants compile-time `R` constraint enforcement per-route.

**Core type:**

```typescript
// Source: packages/fresh/src/define.ts (createDefine pattern)
// Source: node_modules/.deno/effect@4.0.0-beta.0/.../ManagedRuntime.d.ts

import type { Effect } from "effect";
import type { PageResponse } from "@fresh/core";
import type { Context } from "@fresh/core";

// The handler function type that createEffectDefine constrains to
export interface EffectHandlerFn<Data, State, R> {
  (ctx: Context<State>): Effect.Effect<Response | PageResponse<Data>, unknown, R>;
}

// The define object returned by createEffectDefine
export interface EffectDefine<State, R> {
  handlers<
    Data,
    Handlers extends EffectHandlerFnOrMap<Data, State, R> = EffectHandlerFnOrMap<Data, State, R>,
  >(handlers: Handlers): typeof handlers;
}
```

**Implementation:**

```typescript
// Source: createDefine pattern from packages/fresh/src/define.ts
// Implementation is identity function — runtime value is just the handler itself

export function createEffectDefine<State = unknown, R = never>(
  options?: { layer?: Layer.Layer<R, unknown, never> }
): EffectDefine<State, R> {
  // Standalone path: create runtime and register resolver if Layer provided
  if (options?.layer) {
    const runtime = makeRuntime(options.layer);
    const resolver = createResolver(runtime);
    setEffectResolver(resolver);
    registerDisposal(runtime);
  }

  return {
    handlers(handlers) {
      return handlers;
    },
  };
}
```

### Pattern 2: R Constraint Enforcement Mechanism

**What:** TypeScript's type inference does the work. When a handler `yield*`s a service
not in `R`, the inferred return type becomes `Effect<..., ServicesNotInR>` which doesn't
extend `Effect<..., R>` — compile error.

**How TypeScript enforces it:**

```typescript
// Example: R = { db: Database }
const define = createEffectDefine<State, { db: Database }>({ layer: DbLayer });

// This compiles: effect only needs { db: Database }
const h1 = define.handlers({
  GET: () => Effect.gen(function* () {
    const db = yield* DatabaseService;
    return new Response(await db.query("SELECT 1"));
  })
});

// This fails to compile: handler needs { db: Database, email: EmailService }
// but R is only { db: Database }
const h2 = define.handlers({
  POST: () => Effect.gen(function* () {
    const email = yield* EmailService;  // <-- TypeScript error here
    return new Response("ok");
  })
});
```

**The key:** `EffectHandlerFn<Data, State, R>` constrains the return to
`Effect.Effect<Response | PageResponse<Data>, unknown, R>`. TypeScript checks this at
the `handlers()` call site.

### Pattern 3: Type-Parameter-Only Path

**What:** `createEffectDefine<State, R>()` called without a Layer value. This path only
adds compile-time constraints; runtime execution relies on `effectPlugin()` having already
registered the resolver.

```typescript
// Type-parameter-only path — no runtime setup
const define = createEffectDefine<AppState, AppServices>();

// effectPlugin() must be set up separately:
app.use(effectPlugin({ layer: AppLayer }));
```

**When to use:** Large apps where `effectPlugin()` is already configured globally and
per-route type safety is desired.

### Pattern 4: Effect Handler Method Constraint Type

**The critical type constraint** — handler methods must be constrained to Effect returns
with R narrowed to the declared R:

```typescript
// Source: Effect.d.ts in effect@4.0.0-beta.0 — Effect<out A, out E = never, out R = never>
// Source: ManagedRuntime.d.ts — runPromise<A, E>(effect: Effect<A, E, R>): Promise<A>

// EffectHandlerFn<Data, State, R> is the per-method function type:
type EffectHandlerFn<Data, State, R> = (
  ctx: Context<State>
) => Effect.Effect<Response | PageResponse<Data>, unknown, R>;

// Method map version:
type EffectHandlerByMethod<Data, State, R> = {
  [M in Method]?: EffectHandlerFn<Data, State, R>;
};

// Union (same pattern as Fresh's RouteHandler):
type EffectRouteHandler<Data, State, R> =
  | EffectHandlerFn<Data, State, R>
  | EffectHandlerByMethod<Data, State, R>;
```

### Anti-Patterns to Avoid

- **Mixing Effect and plain-async in the same `EffectDefine.handlers()` call:** The return
  type union becomes complex. `createEffectDefine` is specifically for Effect-only routes.
  Plain routes use `createDefine` from `@fresh/core`.

- **Adding `R` to `HandlerFn` in `@fresh/core`:** This would cascade into ALL route types.
  `R` stays contained in `@fresh/plugin-effect` types only.

- **Calling `setEffectResolver()` twice (both `effectPlugin()` and standalone `createEffectDefine`):**
  The second call overwrites the first. If both are used, only the last registered resolver is
  active. The standalone path should check if a resolver is already registered OR always create
  its own isolated runtime.

- **Using `Effect.Services<T>` as a constraint instead of just `R`:** Over-engineering.
  TypeScript's structural type system handles it automatically via the `EffectHandlerFn` type.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type equality assertions in tests | Custom `AssertType<A, B>` generic | `npm:expect-type` | Known pitfalls: `any` leaks, union distribution; `expect-type` handles these correctly |
| Compile-time error testing | Try to `expectType` to cause error | `@ts-expect-error` comment above offending line | Standard TypeScript pattern; `deno check` validates that `@ts-expect-error` lines DO produce errors |
| Service constraint extraction | `infer R` manually from handlers | Let TypeScript infer — just declare `R` parameter | Inference is automatic; manual extraction adds complexity without value |
| Runtime R validation | Check services at runtime | Trust TypeScript — if it compiles, R is satisfied | ManagedRuntime ensures R; runtime check is redundant |

**Key insight:** The R constraint is entirely a compile-time concern. `createEffectDefine()` is
an identity function at runtime — its value is in the type signatures, not any runtime logic.

---

## Common Pitfalls

### Pitfall 1: `E` Type in EffectHandlerFn

**What goes wrong:** Using `Effect.Effect<Response | PageResponse<Data>, E, R>` with `E`
as a separate generic on `EffectHandlerFn` means the `handlers()` method must also be
generic over `E`. This makes the type signature much more complex and fails to infer well.

**Why it happens:** It seems right to thread `E` (error type) just like `R`.

**How to avoid:** Per the CONTEXT.md decision, use `unknown` or `never` for `E` in
`EffectHandlerFn`. The error type is handled by `mapError` in the runtime resolver, not
by the type system. Lean toward `unknown` for maximum flexibility (any `Effect.fail(...)` type accepted).

```typescript
// Good — E is unknown, only R is constrained
type EffectHandlerFn<Data, State, R> = (
  ctx: Context<State>
) => Effect.Effect<Response | PageResponse<Data>, unknown, R>;

// Avoid — E threading adds friction without developer value
type EffectHandlerFn<Data, State, R, E> = (
  ctx: Context<State>
) => Effect.Effect<Response | PageResponse<Data>, E, R>;
```

**Warning signs:** `handlers()` call sites require manual type annotations for `E`.

### Pitfall 2: Standalone Path Overwrites effectPlugin Resolver

**What goes wrong:** If a user calls both `effectPlugin()` and `createEffectDefine({ layer })`,
the second `setEffectResolver()` call replaces the first. If they have different runtimes,
one of them will be ignored.

**Why it happens:** `setEffectResolver()` is a module-level global overwrite (by design from Phase 1).

**How to avoid:** Document clearly that `createEffectDefine({ layer })` is for standalone
use. If the user has `effectPlugin()` already, use `createEffectDefine<State, R>()` without
a Layer value. The planner should decide: either accept the overwrite (last-write-wins) or
add a guard that skips `setEffectResolver()` if one is already registered.

**Warning signs:** Effect handlers work for some routes but not others after combining both.

### Pitfall 3: `Layer<ROut, E, RIn>` vs `ManagedRuntime<R, E>` Confusion

**What goes wrong:** Confusing which `R` is which. `Layer<ROut, E, RIn>` has:
- `ROut` = what services the layer provides (this becomes ManagedRuntime's `R`)
- `RIn` = what services the layer itself requires (must be `never` for top-level layers)

**Verified from `Layer.d.ts`:** `interface Layer<in ROut, out E = never, out RIn = never>`

**How to avoid:** In `createEffectDefine<State, R>()`, the `R` type parameter matches
`Layer<R, E, never>` → `ManagedRuntime<R, E>`. Always require `layer: Layer.Layer<R, unknown, never>`.

### Pitfall 4: expect-type Not in JSR

**What goes wrong:** Searching JSR for `expect-type` finds nothing. Importing as
`jsr:expect-type` fails.

**Why it happens:** `expect-type` is npm-only.

**How to avoid:** Use `npm:expect-type@^1.1.0` import specifier. Deno handles npm imports
natively in Deno 2 without any configuration change.

### Pitfall 5: TypeScript Cannot Narrow `EffectLike` to `Effect<A, E, R>`

**What goes wrong:** In `define.ts`, the `handlers()` method receives an `EffectHandlerFn`
which returns `Effect.Effect<..., R>`. But `HandlerFn` (from Fresh core) only knows about
`EffectLike<A>` (duck type). If you try to assign `EffectHandlerFn` to `HandlerFn`, TypeScript
may not see `Effect<A, E, R>` as assignable to `EffectLike<A>`.

**Verified:** `Effect<A, E, R>` extends `EffectLike<A>` because `Effect` has the
`readonly ["~effect/Effect"]: any` property (it's a structural duck type). This assignment
IS valid — `Effect<A, E, R>` satisfies `EffectLike<A>`.

**How to avoid:** `EffectHandlerFn` doesn't need to extend `HandlerFn` directly. The route
is registered via `app.route()` which accepts `{ handler: HandlerFn<D, S> }`. The cast
from `Effect.Effect<..., R>` to `EffectLike<Response | PageResponse<D>>` is structurally
valid. No explicit cast needed.

---

## Code Examples

### createEffectDefine Full Implementation

```typescript
// Source: define.ts pattern — mirrors packages/fresh/src/define.ts
// Source: packages/fresh/src/internals.ts (setEffectResolver import path)
// Source: packages/plugin-effect/src/runtime.ts (makeRuntime, registerDisposal)

import type { Context } from "@fresh/core";
import type { Method } from "@fresh/core";
import type { PageResponse } from "@fresh/core";
import type { Effect } from "effect";
import type { Layer as LayerType } from "effect";
import { setEffectResolver } from "@fresh/core/internal";
import { makeRuntime, registerDisposal } from "./runtime.ts";
import { createResolver } from "./resolver.ts";

export interface EffectHandlerFn<Data, State, R> {
  (ctx: Context<State>): Effect.Effect<Response | PageResponse<Data>, unknown, R>;
}

export type EffectHandlerByMethod<Data, State, R> = {
  [M in Method]?: EffectHandlerFn<Data, State, R>;
};

export type EffectRouteHandler<Data, State, R> =
  | EffectHandlerFn<Data, State, R>
  | EffectHandlerByMethod<Data, State, R>;

export interface EffectDefine<State, R> {
  handlers<
    Data,
    Handlers extends EffectRouteHandler<Data, State, R> = EffectRouteHandler<Data, State, R>,
  >(handlers: Handlers): typeof handlers;
}

export interface CreateEffectDefineOptions<R> {
  layer?: LayerType.Layer<R, unknown, never>;
}

export function createEffectDefine<State = unknown, R = never>(
  options: CreateEffectDefineOptions<R> = {},
): EffectDefine<State, R> {
  // Standalone path: create own ManagedRuntime and register resolver
  if (options.layer !== undefined) {
    // deno-lint-ignore no-explicit-any
    const runtime = makeRuntime(options.layer as LayerType.Layer<any, any, never>);
    const resolver = createResolver(runtime);
    setEffectResolver(resolver);
    registerDisposal(runtime);
  }
  // Type-parameter-only path: no runtime setup — effectPlugin() handles it

  return {
    handlers(handlers) {
      return handlers;
    },
  };
}
```

### Type-Level Tests with expect-type

```typescript
// Source: expect-type README — expectTypeOf API
// File: packages/plugin-effect/tests/define_types_test.ts

import { expectTypeOf } from "npm:expect-type@^1.1.0";
import { Effect, Layer, ServiceMap } from "effect";
import { createEffectDefine } from "../src/define.ts";
import type { PageResponse } from "@fresh/core";

// Define a test service
const DbService = ServiceMap.Service<{ query: (sql: string) => string }>("DbService");
const DbLayer = Layer.succeed(DbService, { query: (sql) => `result: ${sql}` });

// SC-1: createEffectDefine<State, R>() compiles without error
Deno.test("type: createEffectDefine compiles with R type parameter", () => {
  type DbServiceType = ServiceMap.Service.Shape<typeof DbService>;
  const define = createEffectDefine<unknown, typeof DbService>({ layer: DbLayer });

  // The handlers() return type should be the handlers object itself (identity)
  const h = define.handlers({
    GET: () => Effect.gen(function* () {
      const db = yield* DbService;
      return new Response(db.query("test"));
    }),
  });

  // Type assertion: handler return preserves Effect type
  expectTypeOf(h.GET).toBeFunction();
});

// SC-2: Effect<A, E, R> where R > declared R is a compile error
// This test verifies via @ts-expect-error that extra services cause errors
Deno.test("type: handler with undeclared service causes compile error", () => {
  const EmailService = ServiceMap.Service<{ send: (to: string) => void }>("EmailService");

  const define = createEffectDefine<unknown, typeof DbService>({ layer: DbLayer });

  // @ts-expect-error — EmailService is not in R (only DbService is)
  define.handlers({
    POST: () => Effect.gen(function* () {
      yield* EmailService;  // not in R
      return new Response("ok");
    }),
  });
});
```

### Using @ts-expect-error for Negative Type Tests

Deno's `deno check` validates `@ts-expect-error` comments: if the line does NOT produce
a TypeScript error, `deno check` fails with "Unused '@ts-expect-error' directive". This
makes `@ts-expect-error` a reliable negative test:

```typescript
// @ts-expect-error confirms this is a compile error (deno check will fail if it's NOT an error)
const bad = define.handlers({
  GET: () => someEffectWithExtraService,
});
```

### Runtime Test Pattern (Standalone Path)

```typescript
// Source: packages/plugin-effect/tests/integration_test.ts (existing pattern)

import { assertEquals } from "jsr:@std/assert@1";
import { Effect, Layer, ServiceMap } from "effect";
import { App } from "@fresh/core";
import { FakeServer } from "../../fresh/src/test_utils.ts";
import { createEffectDefine } from "../src/define.ts";

const MsgService = ServiceMap.Service<{ msg: () => string }>("MsgService");
const MsgLayer = Layer.succeed(MsgService, { msg: () => "hello from service" });

Deno.test("createEffectDefine standalone: handler runs with Layer services", async () => {
  type MsgServiceType = typeof MsgService;
  const define = createEffectDefine<unknown, MsgServiceType>({ layer: MsgLayer });

  const app = new App()
    .route("/", {
      handler: define.handlers({
        GET: () => Effect.gen(function* () {
          const svc = yield* MsgService;
          return new Response(svc.msg());
        }),
      }).GET!,
    });

  const server = new FakeServer(app.handler());
  const res = await server.get("/");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "hello from service");
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Context.Tag<T>` for services | `ServiceMap.Service<Shape>(key)` | Effect v4 (beta) | Service definition syntax changed |
| `Effect.Context<T>` utility type | `Effect.Services<T>` utility type | Effect v4 | Renamed: use `Effect.Services<T>` to extract R |
| `Layer<R, E, never>` | `Layer<in ROut, out E, out RIn>` — `ROut` is what it provides | Effect v4 | `ROut` = provided services, `RIn` = own requirements |

**Effect v4 utility types for type assertions:**
- `Effect.Success<T>` — extracts `A` from `Effect<A, E, R>`
- `Effect.Error<T>` — extracts `E` from `Effect<A, E, R>`
- `Effect.Services<T>` — extracts `R` from `Effect<A, E, R>` (NOT `Effect.Context<T>` — renamed in v4)
- `ManagedRuntime.Services<T>` — extracts `R` from `ManagedRuntime<R, E>`
- `Layer.Success<T>` — extracts `ROut` from `Layer<ROut, E, RIn>`

---

## Key Architecture Decision: setEffectResolver Overwrite Problem

The module-level `_effectResolver` in `segments.ts` is overwritten on each call to
`setEffectResolver()`. If both `effectPlugin()` and `createEffectDefine({ layer })` are
used, only the last-registered resolver is active.

**Recommended approach for planning:**

Option A (simpler): `createEffectDefine({ layer })` always registers its own resolver.
  - Consequence: `effectPlugin()` and standalone `createEffectDefine()` can't coexist.
  - Documentation: state clearly these are mutually exclusive runtime paths.

Option B (safer): Check if resolver already registered before calling `setEffectResolver()`.
  - Requires exporting a `hasEffectResolver()` function from `@fresh/core/internal`.
  - Extra file change in `@fresh/core`.

**Recommendation for planner:** Start with Option A (simpler). Document mutual exclusivity.
The primary user story (standalone define with own Layer) doesn't require `effectPlugin()`.

---

## Open Questions

1. **`EffectHandlerFn` vs plain `HandlerFn` in app.route()**
   - What we know: `app.route()` accepts `{ handler: HandlerFn<D, S> }`. `EffectHandlerFn`
     returns `Effect<Response | PageResponse<D>, unknown, R>` which extends `EffectLike<Response | PageResponse<D>>` structurally.
   - What's unclear: Whether TypeScript will accept `EffectHandlerFn` where `HandlerFn` is expected at the `app.route()` call site without an explicit cast.
   - Recommendation: Test this in the implementation. If a cast is needed, wrap in a cast helper inside `define.handlers()`.

2. **`Data` inference from method map**
   - What we know: Fresh's `createDefine.handlers<Data, Handlers>()` infers `Data` from `Handlers`. The same generic trick should work.
   - What's unclear: Whether `Data` inference works when the handler returns `Effect<Response | PageResponse<Data>, unknown, R>` vs the plain `Response | PageResponse<Data>`.
   - Recommendation: Test via `expectTypeOf(h.GET).returns.resolves.toEqualTypeOf<Response | PageResponse<...>>()`.

3. **Disposal in standalone path**
   - What we know: `registerDisposal()` adds an `unload` event listener each time it's called. Multiple `createEffectDefine({ layer })` calls add multiple listeners.
   - What's unclear: Whether multiple listeners cause double-dispose problems.
   - Recommendation: `ManagedRuntime.dispose()` should be idempotent (Effect closes scope once). Test or document limitation.

---

## Sources

### Primary (HIGH confidence)

- `packages/fresh/src/define.ts` — direct read: `createDefine<State>()` pattern, `Define<State>` interface shape
- `packages/fresh/src/handlers.ts` — direct read: `HandlerFn<Data, State>`, `EffectLike<A>`, `RouteHandler`, `HandlerByMethod` as they exist after Phase 1
- `packages/fresh/src/mod.ts` — direct read: public exports from `@fresh/core`
- `packages/fresh/src/internals.ts` — direct read: `setEffectResolver` export path via `@fresh/core/internal`
- `packages/plugin-effect/src/mod.ts` — direct read: `effectPlugin`, existing exports
- `packages/plugin-effect/src/runtime.ts` — direct read: `makeRuntime`, `registerDisposal`
- `packages/plugin-effect/src/resolver.ts` — direct read: `createResolver`, `isEffect`
- `packages/plugin-effect/deno.json` — direct read: `effect` version `4.0.0-beta.0` confirmed
- `packages/plugin-effect/tests/integration_test.ts` — direct read: `app.route()` + `FakeServer` test pattern
- `node_modules/.deno/effect@4.0.0-beta.0/.../Effect.d.ts` — direct read: `interface Effect<out A, out E = never, out R = never>`, `Effect.Services<T>` utility type
- `node_modules/.deno/effect@4.0.0-beta.0/.../ManagedRuntime.d.ts` — direct read: `runPromise<A, E>(effect: Effect<A, E, R>)`, `ManagedRuntime.Services<T>`
- `node_modules/.deno/effect@4.0.0-beta.0/.../Layer.d.ts` — direct read: `interface Layer<in ROut, out E = never, out RIn = never>`
- `.planning/phases/01-foundation/01-RESEARCH.md` — prior research: all Phase 1 decisions
- `.planning/phases/01-foundation/01-01-PLAN.md` — plan structure template

### Secondary (MEDIUM confidence)

- `https://effect.website/docs/getting-started/the-effect-type/` — Effect type documentation confirms `Effect<A, E, R>` semantics
- WebSearch: Effect v4 type parameter names and `Effect.Services<T>` confirmed from multiple sources

### Tertiary (LOW confidence)

- `npm:expect-type@^1.1.0` — confirmed npm-only (not on JSR); import as `npm:expect-type`; basic API verified from GitHub README

---

## Metadata

**Confidence breakdown:**
- createEffectDefine API shape: HIGH — directly modeled on `createDefine` source + Effect v4 types
- Effect<A, E, R> type signature: HIGH — verified from actual dist .d.ts file
- Layer<ROut, E, RIn> type signature: HIGH — verified from actual dist .d.ts file
- R constraint mechanism: HIGH — follows from ManagedRuntime.runPromise signature
- expect-type package: MEDIUM — npm-only confirmed; API verified from README (not installed/tested)
- Standalone setEffectResolver overwrite issue: HIGH — direct code read of segments.ts

**Research date:** 2026-02-19
**Valid until:** 30 days for stable parts; re-verify `Effect.Services<T>` name on effect version bump (was `Effect.Context<T>` in docs; v4 uses `Services`)
