# Phase 7: @fresh/effect Package - Research

**Researched:** 2026-02-25 **Domain:** Effect v4 ManagedRuntime lifecycle, App
proxy pattern, Deno signal handling, TypeScript type narrowing for Effect
handlers **Confidence:** HIGH (all findings verified from source code)

---

## Summary

Phase 7 creates `packages/effect/` — a new `@fresh/effect` package that provides
`createEffectApp<State, AppR>({ layer })`. The result is an
`EffectApp<State, AppR>` that proxies every builder method on `App<State>`,
calls `setEffectRunner` once at construction time, and manages `ManagedRuntime`
lifecycle via `Deno.addSignalListener` (SIGTERM/SIGINT) using an
`AbortController` pattern. It also exports a scoped `createEffectDefine` that is
equivalent to the one in `plugin-effect` but lives in the new package.

All routing, middleware, and rendering concerns remain untouched in Fresh core.
The `EffectApp` is purely an ergonomic wrapper: it holds the `App<State>`
internally, forwards builder calls to it, and returns `this` (typed as
`EffectApp`) to keep chaining working. The inner `App` is exposed for use with
`setEffectRunner` and `app.handler()`.

**Primary recommendation:** Implement `EffectApp` as a class that holds
`#app: App<State>` internally. Each builder method delegates to `#app` and
returns `this`. Signal cleanup uses a `#controller: AbortController` combined
with `Deno.addSignalListener` for SIGTERM/SIGINT, calling `runtime.dispose()`
then `Deno.exit(0)`. Package structure mirrors `plugin-effect/`.

---

## Standard Stack

### Core

| Library                | Version                   | Purpose                                              | Why Standard                                       |
| ---------------------- | ------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `effect`               | `npm:effect@4.0.0-beta.0` | `ManagedRuntime.make()`, `Layer`, `Exit`             | Same version as plugin-effect; locked in workspace |
| `@fresh/core`          | `jsr:@fresh/core@^2.0.0`  | `App<State>`, `setEffectRunner`, `getEffectRunner`   | Phase 6 plumbed the per-app API                    |
| `@fresh/core/internal` | same                      | `setEffectRunner`, `getEffectRunner`, `EffectRunner` | Exported from internals.ts — confirmed in source   |

### Supporting

| Library                  | Version | Purpose                               | When to Use                  |
| ------------------------ | ------- | ------------------------------------- | ---------------------------- |
| `npm:expect-type@^1.1.0` | ^1.1.0  | Compile-time type assertions in tests | Type-level SC-2 verification |
| `jsr:@std/assert@1`      | ^1      | Runtime test assertions               | All runtime tests            |

### Alternatives Considered

| Instead of                       | Could Use                                    | Tradeoff                                                                                         |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Deno.addSignalListener`         | `globalThis.addEventListener("unload", ...)` | Decision locked: AbortController + signals. `unload` is unreliable in Deno deploys               |
| Class wrapper                    | Plain function returning object              | Class enables `instanceof`, `this` return for chaining, private fields for `#app` and `#runtime` |
| `Deno.exit(0)` in signal handler | Process natural exit                         | Must call `Deno.exit` after `dispose()` to prevent Deno from treating the signal as unhandled    |

**Installation:**

```bash
# In packages/effect/deno.json imports section (matches plugin-effect pattern)
"effect": "npm:effect@4.0.0-beta.0"
"@fresh/core": "jsr:@fresh/core@^2.0.0"
"@fresh/core/internal": "jsr:@fresh/core@^2.0.0/internal"
```

---

## Architecture Patterns

### Recommended Package Structure

```
packages/effect/
├── deno.json            # name: "@fresh/effect", exports: {".": "./src/mod.ts"}
├── src/
│   ├── mod.ts           # createEffectApp, EffectApp, createEffectDefine exports
│   ├── app.ts           # EffectApp class + createEffectApp factory
│   ├── define.ts        # createEffectDefine (copy+adapt from plugin-effect)
│   ├── runtime.ts       # makeRuntime() — mirrors plugin-effect/src/runtime.ts
│   ├── resolver.ts      # createResolver() — mirrors plugin-effect/src/resolver.ts
│   └── types.ts         # Re-exported Effect types
└── tests/
    ├── app_test.ts      # SC-1, SC-4: proxy methods + independent runtimes
    ├── signal_test.ts   # SC-3: SIGTERM subprocess test
    └── types_test.ts    # SC-2: tsc type rejection test
```

### Pattern 1: EffectApp Class — Proxy via Delegation

**What:** `EffectApp<State, AppR>` holds a private `#app: App<State>` and
`#runtime:
ManagedRuntime<AppR, unknown>`. Each builder method delegates to
`#app` and returns `this`.

**When to use:** Always — this is the only architecture for Phase 7.

**Key insight:** `App<State>` methods return `this` (typed as `App<State>`). To
keep `EffectApp` as the return type from chaining, each proxied method must
return `this` explicitly (typed as `EffectApp<State, AppR>`), not delegate the
return value from `#app`.

```typescript
// Source: packages/fresh/src/app.ts — studied directly
export class EffectApp<State, AppR> {
  readonly #app: App<State>;
  readonly #runtime: ManagedRuntime<AppR, unknown>;
  readonly #controller: AbortController;

  constructor(app: App<State>, runtime: ManagedRuntime<AppR, unknown>) {
    this.#app = app;
    this.#runtime = runtime;
    this.#controller = new AbortController();
  }

  // Proxy builder methods — return this (EffectApp), not #app's this
  use(...args: Parameters<App<State>["use"]>): this {
    // @ts-ignore — overload dispatch
    this.#app.use(...args);
    return this;
  }

  get(path: string, ...middlewares: MaybeLazy<Middleware<State>>[]): this {
    this.#app.get(path, ...middlewares);
    return this;
  }

  // ... post, patch, put, delete, head, all, route, notFound, onError,
  //     appWrapper, layout, fsRoutes, mountApp similarly

  handler() {
    return this.#app.handler();
  }

  async listen(options: ListenOptions = {}): Promise<void> {
    return this.#app.listen(options);
  }

  get config() {
    return this.#app.config;
  }
}
```

### Pattern 2: Signal Lifecycle — SIGTERM/SIGINT via Deno.addSignalListener

**What:** Register SIGTERM and SIGINT handlers at `createEffectApp()` call time.
On signal: call `runtime.dispose()`, then `Deno.exit(0)`. Remove listeners after
to avoid double-handling.

**Why not `unload`:** `registerDisposal` in the current `plugin-effect` uses
`globalThis.addEventListener("unload", ...)`. The v2 decision (locked) replaces
this with `Deno.addSignalListener` for explicit SIGTERM/SIGINT. The `unload`
event is not guaranteed in Deno Deploy.

**Evidence from platform-deno-smol:** `DenoRuntime.ts` shows the exact Deno
signal pattern: `Deno.addSignalListener("SIGTERM", handler)` paired with
`Deno.removeSignalListener` after receipt.

```typescript
// Source: platform-deno-smol/packages/platform-deno/src/DenoRuntime.ts
// Pattern verified from source

function registerSignalDisposal(
  runtime: ManagedRuntime<unknown, unknown>,
): () => void {
  async function onSignal(): Promise<void> {
    Deno.removeSignalListener("SIGINT", onSignal);
    Deno.removeSignalListener("SIGTERM", onSignal);
    try {
      await runtime.dispose();
    } finally {
      Deno.exit(0);
    }
  }

  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal); // Not supported on Windows

  // Return cleanup function for testing
  return () => {
    Deno.removeSignalListener("SIGINT", onSignal);
    Deno.removeSignalListener("SIGTERM", onSignal);
  };
}
```

**Windows note:** `Deno.addSignalListener("SIGTERM", ...)` throws on Windows.
The example in platform-deno confirms this with a comment. For Phase 7, register
SIGTERM only on non-Windows (`Deno.build.os !== "windows"`).

### Pattern 3: createEffectApp Factory

**What:** The factory function creates `App<State>`, calls `setEffectRunner` to
register the resolver, creates `ManagedRuntime`, registers signal handlers, then
returns `EffectApp<State, AppR>`.

```typescript
// Source: packages/plugin-effect/src/mod.ts — effectPlugin() pattern adapted
import { App } from "@fresh/core";
import { setEffectRunner } from "@fresh/core/internal";
import { Layer, ManagedRuntime } from "effect";
import { createResolver } from "./resolver.ts";

export interface CreateEffectAppOptions<AppR, E> {
  layer: Layer.Layer<AppR, E, never>;
  config?: FreshConfig;
  mapError?: (cause: unknown) => Response;
}

export function createEffectApp<State = unknown, AppR = never, E = never>(
  options: CreateEffectAppOptions<AppR, E>,
): EffectApp<State, AppR> {
  const app = new App<State>(options.config);
  const runtime = ManagedRuntime.make(
    options.layer as Layer.Layer<any, any, never>,
  );
  const resolver = createResolver(runtime, { mapError: options.mapError });
  const runner: EffectRunner = (value, ctx) =>
    resolver(value, ctx) as Promise<unknown>;
  setEffectRunner(app, runner);
  // Register signal handlers for lifecycle
  registerSignalDisposal(runtime as ManagedRuntime<unknown, unknown>);
  return new EffectApp<State, AppR>(app, runtime);
}
```

### Pattern 4: Type-Level Handler Narrowing — The Type Gap

**What:** The current `App<State>` methods (`get`, `post`, `use`) accept
`MaybeLazy<Middleware<State>>` where
`Middleware<State> = (ctx) => Response | Promise<Response>`. This does NOT
include `EffectLike<A>`. At runtime, `runMiddlewares` checks `isEffectLike()`
and dispatches through the runner — it works. But TypeScript rejects
Effect-returning handlers without a cast.

**State of the gap:** From `STATE.md` [06-02]: "Type casts used in SC-2/SC-3
tests... type-level EffectLike support deferred to Phase 7."

**The fix in Phase 7:** `EffectApp` overrides the builder method signatures to
accept `EffectMiddleware<State, AppR>` in addition to `Middleware<State>`:

```typescript
// The narrowed middleware type for EffectApp methods
type EffectMiddleware<State, R> = (
  ctx: Context<State>,
) => Response | Promise<Response> | Effect.Effect<Response, unknown, R>;

// EffectApp.get() accepts the broader type:
get(
  path: string,
  ...middlewares: MaybeLazy<EffectMiddleware<State, AppR>>[]
): this
```

**IMPORTANT:** `App<State>`'s internal type for `#commands` still uses
`MaybeLazyMiddleware<State>`. To delegate to `#app.get()`, a cast is needed
because `EffectMiddleware<State, AppR>` is structurally assignable at runtime
but not at the TypeScript type level (since `App` doesn't know about `Effect`).
Use `as unknown as MaybeLazy<Middleware<State>>[]` in the delegation.

**Alternative:** Add overloaded `use()`/`get()` etc. on `App<State>` that accept
`EffectLike`. This is invasive to `@fresh/core`. The proxy pattern avoids
touching core types.

### Pattern 5: createEffectDefine in @fresh/effect

**What:** `createEffectDefine<State, R>()` in `@fresh/effect` is the standalone
path — it does NOT set up a runtime (that's done by `createEffectApp`). It is
purely a type-level wrapper that constrains handler return types to
`Effect<..., unknown, R>`.

**Difference from plugin-effect version:** In `plugin-effect`,
`createEffectDefine` optionally creates a runtime and calls `setEffectRunner`.
In `@fresh/effect`, the runtime is always managed by `EffectApp`, so
`createEffectDefine` is type-only.

```typescript
// Source: packages/plugin-effect/src/define.ts — adapted for @fresh/effect
export function createEffectDefine<State = unknown, R = never>(): EffectDefine<
  State,
  R
> {
  return {
    handlers(handlers) {
      return handlers;
    },
  };
}
```

This is simpler than the plugin-effect version because there's no `app` arg or
`layer` option — runtime management is `EffectApp`'s job.

### Anti-Patterns to Avoid

- **Reusing `registerDisposal` from plugin-effect:** The
  `globalThis.addEventListener("unload", ...)` pattern is the old approach.
  Phase 7 uses `Deno.addSignalListener`.
- **Calling `setEffectRunner` inside a middleware:** `setEffectRunner` must be
  called at `createEffectApp()` time, not per-request. The runner is captured by
  closure when `app.handler()` is called.
- **Returning `#app` from builder methods:** Each proxied method must return
  `this` (the `EffectApp` instance), not delegate `#app`'s return value.
  Otherwise chaining returns `App<State>` and loses the `EffectApp` type.
- **Registering signals after `.listen()`:** Signal handlers must be registered
  before the server starts, at `createEffectApp()` time.

---

## Don't Hand-Roll

| Problem                     | Don't Build             | Use Instead                                          | Why                                                     |
| --------------------------- | ----------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Effect execution            | Custom Promise wrapper  | `runtime.runPromiseExit(effect)`                     | Exit-based error handling; handles all failure variants |
| Effect detection            | Custom type check       | `isEffectLike(value)` from `@fresh/core`             | Already exported in Phase 6; handles v4 duck typing     |
| Failure to Response mapping | Re-implement resolver   | `createResolver(runtime, opts)` from `./resolver.ts` | Handles Cause.squash, HttpError, mapError callbacks     |
| ManagedRuntime from Layer   | Custom runtime building | `ManagedRuntime.make(layer)`                         | Handles scope, memoization, fiber finalization          |
| Signal listening            | AbortController polling | `Deno.addSignalListener`                             | Native Deno API; same pattern as platform-deno          |

**Key insight:** The resolver and runtime creation are already fully implemented
in `plugin-effect/src/`. Copy them into `@fresh/effect/src/` rather than
importing cross-package (the packages should be independently publishable).

---

## Common Pitfalls

### Pitfall 1: App Builder Methods Use Overloads

**What goes wrong:** `App.use()` has two overloaded signatures:
`use(...middleware)` and `use(path, ...middleware)`. Proxying it requires
handling the overload disambiguation. TypeScript overloads cannot be directly
spread into a delegating call without the implementation signature.

**Why it happens:** TypeScript overloads have a hidden "implementation"
signature that isn't visible externally. `#app.use(...args)` will fail type
checking because `args` is `any[]` vs the union of overload parameter types.

**How to avoid:** In the proxy, manually disambiguate:

```typescript
use(pathOrMiddleware: string | MaybeLazyMiddleware<State>, ...rest: MaybeLazyMiddleware<State>[]): this {
  if (typeof pathOrMiddleware === "string") {
    this.#app.use(pathOrMiddleware, ...rest);
  } else {
    this.#app.use(pathOrMiddleware, ...rest);
  }
  return this;
}
```

Or use `// @ts-ignore` with a brief comment on the single delegation line if the
overload structure makes clean typing impractical.

### Pitfall 2: Signal Handler Runs in Signal Callback (Synchronous Context)

**What goes wrong:** `Deno.addSignalListener` callbacks run synchronously.
`runtime.dispose()` returns `Promise<void>`. You cannot await a Promise in a
sync signal callback the same way — the process may exit before dispose
completes if `Deno.exit(0)` is called inside a `.then()` that doesn't run.

**Why it happens:** Signal handlers are sync by nature. Deno allows the callback
to return void (not `Promise<void>`), but if you return a Promise it is ignored.

**How to avoid:** Start an async IIFE inside the signal handler:

```typescript
function onSignal(): void {
  Deno.removeSignalListener("SIGINT", onSignal);
  Deno.removeSignalListener("SIGTERM", onSignal);
  // Fire async dispose then exit
  void (async () => {
    try {
      await runtime.dispose();
    } catch (_) {
      // best-effort
    } finally {
      Deno.exit(0);
    }
  })();
}
```

This pattern is validated by how platform-deno handles `teardown` callbacks.

### Pitfall 3: SIGTERM Not Supported on Windows

**What goes wrong:** `Deno.addSignalListener("SIGTERM", ...)` throws `TypeError`
on Windows (`SIGTERM is not supported`).

**Why it happens:** Windows does not have POSIX signals. Deno documents this.

**How to avoid:** Guard with `Deno.build.os !== "windows"`:

```typescript
Deno.addSignalListener("SIGINT", onSignal);
if (Deno.build.os !== "windows") {
  Deno.addSignalListener("SIGTERM", onSignal);
}
```

### Pitfall 4: Two ManagedRuntimes for the Same Layer Share Nothing

**What goes wrong (won't happen if correct):** If the same `Layer` object is
passed to two `createEffectApp()` calls, both get independent `ManagedRuntime`
instances with independent `memoMap`. This is correct behavior for SC-4 (two
`EffectApp` instances own independent runtimes).

**Warning sign:** If a test creates two `EffectApp` instances with the same
`Layer` and disposes one, the other's runtime should be unaffected. Verify this
explicitly — `ManagedRuntime.make()` creates a fresh scope each call.

### Pitfall 5: `app.handler()` Captures effectRunner at Call Time

**What goes wrong:** `effectRunner` is captured inside `app.handler()` at the
moment `.handler()` is called (see `app.ts` line 399:
`const effectRunner = this.#effectRunner`). If `setEffectRunner` is called after
`.handler()`, the runner is not active.

**Why it happens:** By design — `App.handler()` snapshots state to build the
router. Phase 6 implementation confirmed this in `app.ts`.

**How to avoid:** `createEffectApp` calls `setEffectRunner(app, runner)` before
returning the `EffectApp`. Users call `.handler()` after all routes are
registered. This is the correct order. Document it clearly.

### Pitfall 6: `use()` on EffectApp — Overload with Path Variant

**What goes wrong:** `App.use()` supports `app.use("/path", middleware)` as well
as `app.use(middleware)`. The `EffectApp` must support both. The typing for the
"Effect-aware" variant (`EffectMiddleware<State, AppR>`) needs to handle both
overloads.

**How to avoid:** Define two overloads in `EffectApp.use()` matching the App's
two public signatures but with the handler type broadened to
`MaybeLazyEffectMiddleware<State, AppR>`.

---

## Code Examples

### createEffectApp — Factory Signature

```typescript
// Source: derived from packages/fresh/src/app.ts + packages/plugin-effect/src/mod.ts
import { App, type FreshConfig, type ListenOptions } from "@fresh/core";
import { setEffectRunner } from "@fresh/core/internal";
import type { EffectRunner } from "@fresh/core/internal";
import { Layer, ManagedRuntime } from "effect";
import type { Effect } from "effect";
import { createResolver } from "./resolver.ts";

export interface CreateEffectAppOptions<AppR, E = never> {
  layer: Layer.Layer<AppR, E, never>;
  config?: FreshConfig;
  mapError?: (cause: unknown) => Response;
}

export function createEffectApp<State = unknown, AppR = never, E = never>(
  options: CreateEffectAppOptions<AppR, E>,
): EffectApp<State, AppR> {
  const app = new App<State>(options.config);
  // deno-lint-ignore no-explicit-any
  const runtime = ManagedRuntime.make(
    options.layer as Layer.Layer<any, any, never>,
  );
  const resolver = createResolver(runtime, { mapError: options.mapError });
  const runner: EffectRunner = (value, ctx) =>
    resolver(value, ctx) as Promise<unknown>;
  setEffectRunner(app, runner);
  return new EffectApp<State, AppR>(app, runtime);
}
```

### EffectApp.listen() — Lifecycle with Signal Handling

```typescript
// Source: packages/fresh/src/app.ts App.listen() + DenoRuntime.ts pattern
async listen(options: ListenOptions = {}): Promise<void> {
  // Signal handlers registered at createEffectApp() time, not here.
  // listen() simply delegates to #app.
  return this.#app.listen(options);
}
```

### ManagedRuntime.make() — API Verified

```typescript
// Source: platform-deno-smol/packages/effect/dist/ManagedRuntime.d.ts
// make: <R, ER>(layer: Layer<R, ER, never>, options?: { memoMap? }) => ManagedRuntime<R, ER>
// dispose: () => Promise<void>
// runPromiseExit: <A, E>(effect: Effect<A, E, R>) => Promise<Exit<A, ER | E>>

const runtime = ManagedRuntime.make(AppLayer);
// Later:
await runtime.dispose(); // returns Promise<void>
```

### createEffectDefine in @fresh/effect

```typescript
// Source: derived from packages/plugin-effect/src/define.ts — simplified
// In @fresh/effect, no layer/app args — runtime is EffectApp's concern

export function createEffectDefine<State = unknown, R = never>(): EffectDefine<
  State,
  R
> {
  return {
    handlers(handlers) {
      return handlers; // identity — all enforcement at type level
    },
  };
}
```

### SC-3 Test: SIGTERM Signal Test Pattern (Subprocess)

```typescript
// Pattern: spawn subprocess, wait for "ready", send SIGTERM, check exit code 0
// Source: packages/fresh/tests/test_utils.tsx withChildProcessServer pattern

const cp = new Deno.Command(Deno.execPath(), {
  args: ["run", "--allow-net", "--allow-env", "test_server.ts"],
  stdout: "piped",
  stderr: "piped",
}).spawn();

// Wait for server ready signal on stdout
// Then send SIGTERM (kill with signal 15)
// Assert cp.status.code === 0

// Deno doesn't have direct .kill() on process — use:
cp.kill("SIGTERM"); // Deno.ChildProcess.kill(signal)
const status = await cp.status; // Wait for exit
assertEquals(status.code, 0);
```

**Note:** `Deno.ChildProcess.kill(signal)` accepts signal name as string (e.g.,
`"SIGTERM"`). The subprocess test needs a minimal `EffectApp` server script.

---

## State of the Art

| Old Approach                                   | Current Approach                                        | When Changed                 | Impact                                                      |
| ---------------------------------------------- | ------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Global `_effectResolver` singleton             | Per-app `#effectRunner` on `App` instance               | Phase 6 (2026-02-25)         | Multiple apps in one process, no cross-contamination        |
| `globalThis.addEventListener("unload", ...)`   | `Deno.addSignalListener("SIGTERM"/"SIGINT", ...)`       | Phase 7 (v2 design decision) | Reliable cleanup; unload not guaranteed in Deno Deploy      |
| `effectPlugin(app, { layer })` as middleware   | `createEffectApp({ layer })` as first-class constructor | Phase 7 (v2 design)          | Builder pattern, typed `AppR`, lifecycle ownership          |
| `createEffectDefine` in `@fresh/plugin-effect` | `createEffectDefine` in `@fresh/effect`                 | Phase 7                      | Decoupled — plugin-effect becomes a compat shim in Phase 10 |

**Deprecated/outdated (in Phase 7 context):**

- `registerDisposal()` in `plugin-effect/src/runtime.ts` — uses `unload`,
  replaced by signal handlers in `@fresh/effect`
- `effectPlugin` as the primary entry point — `createEffectApp` is the v2
  replacement; `effectPlugin` lives on as compat shim (Phase 10)

---

## Open Questions

1. **`use()` overload complexity with EffectMiddleware**
   - What we know: `App.use()` has two overloads (with and without path).
     `EffectApp.use()` needs to support both overloads with the extended handler
     type.
   - What's unclear: Whether TypeScript correctly narrows the overloads when the
     handler type is extended to include `Effect<Response, unknown, AppR>`. The
     inner `#app.use()` call will need a cast since `App` doesn't know about
     `Effect` types.
   - Recommendation: Use a single implementation signature in `EffectApp` that
     handles both overloads, cast the handler args to `any` when calling `#app`,
     and test that TypeScript correctly rejects handlers requiring services not
     in `AppR`.

2. **SC-3 test: Timing for SIGTERM subprocess test**
   - What we know: Subprocess tests require waiting for the server to be ready
     before sending SIGTERM. `withChildProcessServer` in `test_utils.tsx` does
     this by scanning stdout for a "ready" line.
   - What's unclear: Whether `EffectApp.listen()` logs the same "Fresh ready"
     message to stdout as `App.listen()` (it delegates, so it should).
   - Recommendation: Create a minimal `test_server.ts` fixture that uses
     `createEffectApp` and calls `.listen()`. The existing Fresh "Fresh ready"
     log line is the readiness signal.

3. **`config` property access on EffectApp**
   - What we know: Some Fresh internals (and external tools like `Builder`)
     access `app.config` directly. `EffectApp` wraps `App`, so `config` must be
     accessible.
   - What's unclear: Whether tests or the example app access `.config` directly
     via `EffectApp`.
   - Recommendation: Expose `get config()` that proxies to `this.#app.config`
     and also expose a `get app()` getter that returns the inner `App<State>`
     for integration with `setBuildCache` and other internals.ts functions that
     accept `App<State>`.

4. **Package naming: `packages/effect/` vs `packages/fresh-effect/`**
   - What we know: The package is `@fresh/effect`. Other packages are
     `packages/plugin-effect`, `packages/fresh`, `packages/plugin-tailwindcss`.
     Convention is to use a short directory name.
   - Recommendation: Use `packages/effect/` to match the JSR package name
     `@fresh/effect`.

---

## Sources

### Primary (HIGH confidence)

- `packages/fresh/src/app.ts` — All `App<State>` methods, their signatures,
  `setEffectRunner`/`getEffectRunner` implementation, `App.listen()`
  implementation
- `packages/fresh/src/handlers.ts` — `EffectRunner`, `EffectLike`,
  `isEffectLike`, `HandlerFn` type
- `packages/fresh/src/internals.ts` — `setEffectRunner`, `getEffectRunner`
  exports confirmed
- `packages/fresh/src/mod.ts` — `isEffectLike`, `EffectRunner` confirmed in
  public API (Phase 6 additions)
- `packages/plugin-effect/src/mod.ts` — `effectPlugin` implementation: runtime
  creation, `setEffectRunner` call, middleware pattern
- `packages/plugin-effect/src/runtime.ts` — `makeRuntime()`,
  `registerDisposal()` (unload pattern being replaced)
- `packages/plugin-effect/src/resolver.ts` — `createResolver()`, `isEffect()`,
  error handling via `Exit`
- `packages/plugin-effect/src/define.ts` — `createEffectDefine` full
  implementation
- `packages/plugin-effect/tests/per_app_test.ts` — Confirms type cast pattern
  for `app.get()`/`app.use()` Effect returns
- `packages/plugin-effect/tests/define_types_test.ts` — SC-2 type rejection
  pattern using `@ts-expect-error`
- `platform-deno-smol/packages/effect/dist/ManagedRuntime.d.ts` —
  `ManagedRuntime` interface: `make()`, `dispose()`, `runPromiseExit()`
  confirmed
- `platform-deno-smol/packages/platform-deno/src/DenoRuntime.ts` —
  `Deno.addSignalListener("SIGTERM"/"SIGINT")` pattern, cleanup via
  `removeSignalListener`
- `packages/fresh/tests/test_utils.tsx` — `withChildProcessServer()` pattern for
  subprocess signal testing; `AbortController` with `Deno.serve`
- `.planning/REQUIREMENTS.md` — EAPP-01/02/03/04 requirements confirmed
- `.planning/STATE.md` — All v2-design decisions confirmed locked

### Secondary (MEDIUM confidence)

- `packages/fresh/src/middlewares/mod.ts` — `runMiddlewares()` — `isEffectLike`
  check and `effectRunner` dispatch path confirmed
- `packages/plugin-effect/src/hydration.ts` — atom hydration pattern (for
  understanding what `@fresh/effect` does/doesn't need to include)

### Tertiary (LOW confidence)

- None — all findings directly verified from source code.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all imports verified from existing packages
- Architecture (EffectApp proxy): HIGH — App source read directly, pattern clear
- Signal handling: HIGH — DenoRuntime.ts in platform-deno-smol verified
- Type gap fix: HIGH — per_app_test.ts type cast pattern confirms the gap and
  what Phase 7 must fix
- `use()` overload handling: MEDIUM — overload delegation is known tricky; one
  open question remains
- Subprocess signal test pattern: HIGH — withChildProcessServer pattern in
  test_utils.tsx verified

**Research date:** 2026-02-25 **Valid until:** 2026-04-25 (stable APIs; effect
version is locked at 4.0.0-beta.0 in workspace)
