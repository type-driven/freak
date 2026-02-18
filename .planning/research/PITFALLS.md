# Domain Pitfalls: Effect v4 Integration in Fresh

**Domain:** Effect v4 beta integration into Fresh 2 monorepo
**Researched:** 2026-02-18
**Confidence:** MEDIUM — Effect v4 is in active alpha/beta; some specifics are based on source
inspection and partially-verified ecosystem research.

---

## Critical Pitfalls

Mistakes that cause rewrites or block the integration entirely.

---

### Pitfall 1: Effect v4 Beta API Churn — Atoms Are Not Yet Stable

**What goes wrong:**
Effect v4 is in active alpha development. The TODOS.md in `effect-smol` (the v4
staging repository) shows atom support was ported but beta-phase work — including
JSDoc documentation and migration codemods — is still incomplete. Michael Arnaldi
confirmed in November 2025 that `effect-atom` will be folded into the core `effect`
package in v4, but the exact final API surface is not locked.

Code written against `npm:effect@4.0.0-beta.x` atom APIs (`Atom.make`,
`Atom.runtime`, `AtomRuntime`) may require changes before v4 stable. The rename
from `effect-rx` to `effect-atom` already happened once (2025), demonstrating
active API evolution.

**Warning signs:**
- Importing from `@effect-atom/atom` as a separate package — this package will be
  absorbed into `effect` for v4 stable, requiring import path updates.
- Using `Atom.runtime(layer)` patterns that mirror current `effect-atom` v0.5.x
  without pinning to a specific beta version.

**Prevention strategy:**
- Pin the exact beta version in `deno.json` (`npm:effect@4.0.0-beta.X`) and commit
  to upgrading deliberately, not automatically.
- Isolate all Effect and atom imports behind a thin adapter module
  (`packages/plugin-effect/src/effect_adapter.ts`). If the import path changes from
  `@effect-atom/atom` to `effect/Atom`, only one file needs updating.
- Track the `effect-smol` TODOS.md and changelogs on each beta bump before merging.

**Phase to address:** Phase 1 (initial integration scaffold) — establish the adapter
module pattern before any feature work begins.

---

### Pitfall 2: JSR Publishing Constraint — npm: Types Cannot Appear in Public API

**What goes wrong:**
Fresh packages are published on JSR. JSR enforces a "no slow types" rule: all
exported types in a JSR package must be explicitly annotatable without requiring a
full TypeScript compiler pass. Additionally, JSR's npm compatibility layer cannot
generate type declarations when the public API surface references `npm:` specifiers
in ways that cannot be statically analyzed.

If `HandlerFn` is extended to include `Effect<Response | PageResponse<Data>, E, R>`
and `Effect` is imported from `npm:effect`, that import appears in the public
signature of `HandlerFn`, which is re-exported from `jsr:@fresh/core`. This may
break JSR publishing or cause downstream type-checking degradation for users.

**Warning signs:**
- Running `deno publish --dry-run` and seeing "slow types detected" or type
  declaration generation errors.
- TypeScript consumers of `jsr:@fresh/core` getting `Cannot find name 'Effect'`
  errors because the npm compatibility layer failed to generate declarations.

**Prevention strategy:**
- Keep Effect types out of Fresh's core public API. Rather than extending `HandlerFn`
  to include `Effect<...>` in its union at the type level, define the Effect-aware
  handler type only in a separate `@fresh/plugin-effect` package that depends on
  `npm:effect` directly.
- The runtime detection of Effect values (checking `instanceof` or the Effect
  `_tag` symbol) can live in core without any Effect type imports — use `unknown`
  and narrow at runtime rather than importing Effect types into core.
- Validate with `deno publish --dry-run` on every PR that touches public type exports.

**Phase to address:** Phase 1 (architecture decisions) — this constraint must drive
the package boundary design before implementation starts.

---

### Pitfall 3: Preact Compat Hook Registration Conflict

**What goes wrong:**
`@effect-atom/atom-react` imports from `react` (not `preact/compat`). When running
in a Fresh island, the bundler must alias `react` to `preact/compat`. If the
bundler alias is incomplete or if both `react` and `preact` end up registered as
separate reconcilers, hooks state is stored in different slots and components
can render twice with stale state — a documented failure mode for preact-compat
plus third-party React libraries in Fresh islands.

In Fresh's esbuild bundler, `react` and `react-dom` aliases must be explicitly
mapped to `preact/compat`. If `atom-react` uses `useSyncExternalStore` (the modern
approach for external stores), that hook must resolve from the same Preact hook
registry as the island's own hooks — any mismatch breaks subscription teardown.

**Warning signs:**
- Island components subscribing to atoms re-render on every frame, or render twice
  on initial mount with different values.
- Console errors like `Cannot read property '...' of undefined` inside hook calls
  after initial hydration.
- Atom subscription callbacks firing after the island unmounts (teardown not called).

**Prevention strategy:**
- If building a native `useAtom` hook for Preact rather than using atom-react, import
  directly from `preact/hooks` — never from `react`. This avoids the entire compat
  aliasing problem.
- If reusing `atom-react`, add an esbuild alias entry that maps `react` and
  `react-dom` to `preact/compat` in the island bundler configuration, and verify it
  with a test island that counts renders.
- Prefer native Preact hooks (`useSignal`, `useEffect` from `preact/hooks`) for atom
  subscriptions over any library that imports from `react`.

**Phase to address:** Phase 2 (atom hooks in islands) — evaluate whether to build
native Preact bindings or alias atom-react, and test both approaches before committing.

---

### Pitfall 4: HandlerFn Union Extension Breaks `define.handlers` Type Inference

**What goes wrong:**
`HandlerFn<Data, State>` is an interface with a call signature. The `define.handlers`
function infers `Data` from the return type of the handler. If `HandlerFn` is extended
to include `Effect<Response | PageResponse<Data>, E, R>` in the return union, TypeScript
must now unify `Data` across two code paths: the synchronous `PageResponse<Data>` path
and the `Effect<..., E, R>` path.

Effect's type system uses 3-parameter generics (`A, E, R`). When TypeScript unifies a
union containing `Effect<PageResponse<Data>, E, R>` with `PageResponse<Data>`, it must
solve for `Data` through a conditional/mapped type chain. At complex handler shapes
(multiple HTTP methods, generic Data types), this can hit TypeScript's type instantiation
depth limit (max recursion: 1000), producing the error:
`Type instantiation is excessively deep and possibly infinite. ts(2589)`.

Additionally, because `define.page<typeof handler>` infers `Data` from the handler via
`RouteData<Handler>`, any change to how `HandlerFn` represents its return type ripples
into page component prop types for every route in every Fresh app.

**Warning signs:**
- `ts(2589)` errors in route files that use `define.handlers` with Effect-returning
  handlers.
- `data` prop on page components inferred as `unknown` instead of the concrete type.
- TypeScript language server becomes slow (>5s) to type-check route files.

**Prevention strategy:**
- Do not change the signature of `HandlerFn` itself. Instead, define a separate
  `EffectHandlerFn<Data, State, E, R>` interface, and extend `RouteHandler` with a
  distinct overload rather than widening the union inside `HandlerFn`.
- Alternatively, keep `HandlerFn` unchanged and detect Effect returns purely at
  runtime in the middleware dispatch layer — this preserves all existing type inference
  and adds zero TypeScript complexity for users who don't use Effect.
- Write TypeScript inference tests (`tsd` or `expect-type`) for the handler-to-page
  data flow before any HandlerFn changes ship.

**Phase to address:** Phase 1 (type design) — the inference strategy must be decided
before implementing the runtime dispatch, since it determines whether `define.handlers`
needs changes.

---

## Moderate Pitfalls

Mistakes that cause delays or significant technical debt.

---

### Pitfall 5: Effect Runtime Lifecycle Mismatch With Fresh Request Lifecycle

**What goes wrong:**
Fresh's `App.handler()` is a pure function that processes each request independently
through a middleware chain. It has no application-level lifecycle hooks (no `onStart`,
no `onShutdown`). An Effect `ManagedRuntime` built from a `Layer` must be created once
per application (not once per request) and explicitly disposed on shutdown.

Two failure modes:

**A) Runtime created per-request:** If `ManagedRuntime.make(layer)` is called inside
the middleware that handles Effect returns, a new runtime is created for every HTTP
request. This initializes database pools, background fibers, and other Layer resources
on every request, leaking them when the runtime is disposed after the response or,
worse, never disposed.

**B) Runtime never disposed:** If the runtime is created as a module-level global
(outside any Fresh lifecycle), it is never cleaned up on `Deno.serve` shutdown (SIGINT,
SIGTERM). Long-running fibers and open connections leak for the duration of the
process.

Fresh does not currently expose application lifecycle hooks (confirmed by inspecting
`App`, `FreshConfig`, and `ResolvedFreshConfig` — no `onStart`/`onStop` callbacks).

**Warning signs:**
- Increasing memory usage on long-running Fresh server.
- Connection pool exhaustion after many requests in development.
- Fibers running after Deno process exits (zombie processes or unclosed TCP connections).

**Prevention strategy:**
- Expose the `ManagedRuntime` through a Fresh middleware that is registered once at
  startup. Use `Deno.serve`'s return value (the `Deno.HttpServer`) and attach a
  `beforeunload` / `unload` event listener (Deno's lifecycle events) to call
  `runtime.dispose()` on shutdown.
- Alternatively, make the plugin API accept a `Layer` and create the runtime lazily
  on first request, then store it in a module-level singleton.
- Never create the runtime inside the per-request handler.

**Phase to address:** Phase 1 (plugin API design) — the runtime creation point and
disposal must be designed before writing any request dispatch code.

---

### Pitfall 6: Atom State Serialization — Effect Atoms Are Not JSON-Serializable

**What goes wrong:**
Fresh's island hydration works by serializing island props into a JSON-like format
using the custom `stringify`/`parse` system in `packages/fresh/src/jsonify/`. This
system supports: primitives, `URL`, `Date`, `RegExp`, `Uint8Array`, `Set`, `Map`,
`@preact/signals` (via custom `Signal` and `Computed` serializers).

Effect Atom values themselves are not in this list. An `Atom.make(initialValue)`
contains internal Effect fiber state and a reactive graph — neither is serializable.
What _is_ serializable is the atom's current primitive value (the data inside it).

The hydration design must thread only the atom's current value from server to client,
not the atom itself. The atom is re-initialized client-side with the hydrated value.
This has two edge cases:

**A) Non-serializable atom values:** If an atom holds a `Date`, `Error`, or other
complex type, it must be explicitly handled by a custom serializer entry in
`CUSTOM_PARSER`. Forgetting this causes silent hydration failures where the client
atom initializes with `undefined`.

**B) Atom identity across islands:** If multiple islands on the same page share an
atom, each island gets its own deserialized initial value from the HTML. This is
correct for initial load, but after hydration, cross-island reactivity depends on both
islands subscribing to the same atom singleton — which only works if the atom runtime
is initialized before island revival.

**Warning signs:**
- Island renders with the correct server value on first load, then immediately shows a
  different (stale or empty) value after hydration completes.
- Multiple islands showing out-of-sync values when they should share state.
- Browser console errors during island revival about unexpected prop types.

**Prevention strategy:**
- Define atom hydration as "value-only": serialize `atom.get()` (the plain value),
  never serialize the atom object itself.
- Add a `CustomParser` entry for any complex types that atoms may hold.
- The atom runtime (Effect `Layer`) must be initialized client-side before
  `boot()` revives islands. This means the atom runtime initialization must
  run in the client entry script before the Fresh reviver runs.
- Write an integration test that renders two islands sharing an atom, performs a
  server-to-client hydration, and asserts both islands show the same value.

**Phase to address:** Phase 2 (island hydration) — this requires explicit design of
the serialization protocol before building the `useAtom` hook.

---

### Pitfall 7: Deno TypeScript Version Lag With npm: Effect Imports

**What goes wrong:**
The Effect team prioritizes supporting the latest TypeScript version immediately upon
release. Deno releases on a 12-week cycle; TypeScript releases on a ~13-week cycle.
This creates up to a quarter-year window where Effect's latest beta uses TypeScript
features not yet supported by Deno's bundled TypeScript compiler.

Concretely: if Effect v4 beta uses TypeScript 5.7+ features (e.g., new inference
improvements, new utility types) and Deno ships TypeScript 5.5, `deno check` will
produce false-positive type errors on Effect imports even though the JavaScript works.
This was confirmed as a known issue in the `effect-smol` Deno support thread.

**Warning signs:**
- `deno check` reports errors on Effect imports that disappear when running the same
  code through Node/tsc.
- Error messages reference TypeScript features or syntax that look like valid TS to a
  human.
- Effect team's release notes mention a TypeScript version that is newer than Deno's
  bundled TypeScript.

**Prevention strategy:**
- Check `deno --version` and compare the bundled TypeScript version against Effect's
  minimum TypeScript requirement on each Effect beta update.
- Use `// @ts-types="npm:effect/..."` directives if Deno's type-checker struggles
  with specific modules.
- Run `deno check` in CI but do not treat it as the only type-check — also run
  `tsc` via `deno run npm:typescript/tsc` with the current TypeScript version to
  distinguish Deno-lag errors from real errors.
- The monorepo's `deno.json` already uses `"check:types": "deno check --allow-import"`
  — add a second check task using npm TypeScript if version divergence is detected.

**Phase to address:** Phase 1 (CI setup) — establish the dual type-check strategy
before writing significant Effect code.

---

### Pitfall 8: Bundle Size in Islands — Effect Is Substantial

**What goes wrong:**
Fresh's island architecture is explicitly designed for minimal client-side JavaScript.
Islands are individually bundled via esbuild. Effect v4 aims for smaller bundles than
v3 (~20x faster streams, smaller bundles per the Effect team), but any island that
imports atom hooks will pull Effect's core runtime into its bundle.

Effect's runtime includes a scheduler, fiber implementation, cause/error tracking, and
the effect execution engine. Even with tree-shaking, an island using `useAtom` will
include all of Effect's reactive graph code that the atom hooks depend on.

This is a different cost model than `@preact/signals` (which Fresh already uses for
reactive state and is ~3KB gzip). If every island that uses atoms adds a significant
Effect runtime overhead, the island architecture's performance advantage erodes.

**Warning signs:**
- Island bundle size analyzer showing >50KB for a simple island that only uses
  `useAtom`.
- Lighthouse "Reduce JavaScript payload" warnings after adding the first atom island.
- Build times increasing significantly when Effect is added to the island bundle.

**Prevention strategy:**
- Measure the actual island bundle size impact in Phase 2 before committing to the
  hook design — build a minimal `Counter` island that uses `useAtom` and check the
  bundle output size.
- Consider making the atom hooks opt-in per island (explicitly import from
  `@fresh/plugin-effect/hooks`) rather than bundling Effect into every island.
- Evaluate whether the atom runtime can be shared as a module-level singleton loaded
  once per page (as a separate script tag) rather than included in each island bundle
  individually.
- Do not assume Effect v4's "smaller bundles" claim applies to the atom submodule
  specifically — measure with the actual beta version being used.

**Phase to address:** Phase 2 (island hooks) — measure before building, not after.

---

### Pitfall 9: Effect Error Channel Leaks to HTTP Response

**What goes wrong:**
`Effect<Response | PageResponse<Data>, E, R>` — the `E` (error channel) is
user-controlled and can contain anything: database errors, domain errors, validation
failures. When Fresh runs the Effect and it fails, the error must be caught and
converted to an appropriate HTTP response.

Two dangerous defaults:

**A) Unhandled errors crash the request:** If the Effect error is not caught before
reaching Fresh's dispatch layer and Fresh's catch block re-throws it, Deno's
unhandled rejection handler terminates the process (there is no equivalent to Node's
`unhandledRejection` event in Deno — it crashes).

**B) Error details leak in production:** If the error channel is converted directly
to a 500 response body (e.g., `String(error)`), internal implementation details
(database query text, file paths, stack traces) are exposed to the client.

**Warning signs:**
- Deno process exits unexpectedly during high load.
- 500 responses containing TypeScript class names or internal error messages.
- No error logging before the process exits (crash happens in unhandled rejection).

**Prevention strategy:**
- The dispatch layer must call `Effect.runPromise(effect).catch(err => ...)` — the
  `.catch()` is not optional. Any unhandled Effect failure must be caught, logged, and
  converted to a generic 500 response.
- Alternatively, use `Effect.runPromiseExit` to get a typed `Exit<A, E>` and handle
  failure explicitly before returning from the handler.
- Define a convention: Effect handlers should use `Effect.mapError` to convert domain
  errors to `HttpError` (Fresh's existing error type) before returning, so the error
  channel is always `HttpError` by the time Fresh sees it.

**Phase to address:** Phase 1 (runtime dispatch design) — the error handling contract
must be specified before the dispatcher is implemented.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable with targeted changes.

---

### Pitfall 10: `define.handlers` Overload — Effect Handler Breaks Page Inference

**What goes wrong:**
`define.page<typeof handler>` currently infers `Data` from
`RouteData<typeof handler>`, which uses conditional type extraction on `HandlerFn`.
If the handler now returns `Effect<PageResponse<Data>, E, R>`, the conditional type
`Handler extends RouteHandler<infer Data, unknown> ? Data : never` may not successfully
infer `Data` through the Effect wrapper without explicit adjustment.

Users will see `data: never` or `data: unknown` in their page component props instead
of the concrete type, and lose the end-to-end type safety that `define.handlers` +
`define.page<typeof handler>` provides.

**Warning signs:**
- `data` prop typed as `never` in a page component when using an Effect-returning handler.
- TypeScript not complaining about accessing `.nonExistentField` on `data`.

**Prevention strategy:**
- Extend `RouteData<H>` with an additional branch:
  `H extends EffectHandlerFn<infer Data, ...> ? Data : ...`
- Test with `tsd` assertions: `expectType<{ name: string }>(data)` in a test route.

**Phase to address:** Phase 1 (type design) — caught during inference testing.

---

### Pitfall 11: Fresh's Synchronous `renderToString` + Async Effect

**What goes wrong:**
`Context.render()` in Fresh is async (`async render(vnode, ...)`), but it calls
`renderToString(vnode)` from `preact-render-to-string` synchronously. Preact components
can be async (Fresh supports `AsyncAnyComponent`), but the render pipeline is not
streaming — it collects the full HTML string before responding.

If an Effect handler sets atom state that page components read during SSR, the atom
values must be fully resolved before the `renderToString` call. Lazy atom computation
(pull-based atoms that compute on subscription) may produce empty/default values
during SSR if they haven't been forced before rendering.

**Warning signs:**
- SSR renders show the atom's initial value instead of the server-computed value.
- Hydration flash where the correct value appears only after client-side Effect runs.

**Prevention strategy:**
- Force atom evaluation explicitly in the handler before returning. A handler that
  sets atom state should complete all effect computations before returning the Effect.
- Treat atom values in SSR as "pre-fetched data passed as props," not reactive
  subscriptions — pull the value from the Effect, pass it as `PageResponse.data`,
  then hydrate the island atom with that value.

**Phase to address:** Phase 2 (SSR integration) — during island hydration design.

---

### Pitfall 12: Module Import Side Effects on Deno Deploy

**What goes wrong:**
Deno Deploy is the primary deployment target for Fresh apps. Deno Deploy runs in an
isolate environment that may not support all npm package behaviors. Effect uses
`@effect/platform` for environment-specific APIs, and some of its internals (like
`@opentelemetry` integration, which Fresh already uses) assume Node-compatible APIs
available via npm.

If Effect's atom runtime uses any Node-specific APIs at module initialization time
(not just at runtime), those imports will fail in Deno Deploy's isolate even before
any handler is called.

**Warning signs:**
- Cold start failures on Deno Deploy with errors like "not supported in Deno Deploy."
- Module-level `import` of Effect modules that reference Node `process` or `Buffer`.

**Prevention strategy:**
- Use `@effect/platform-deno` or equivalent Deno-specific Effect platform adapters
  where available.
- Test on Deno Deploy (or a local Deploy emulator) in CI before shipping Phase 1 —
  do not assume local Deno compatibility implies Deploy compatibility.

**Phase to address:** Phase 1 (CI setup) — add a Deno Deploy smoke test before
writing any substantial code.

---

## Phase-Specific Warnings

| Phase Topic                  | Likely Pitfall                        | Mitigation                                          |
|------------------------------|---------------------------------------|-----------------------------------------------------|
| Package boundary design      | JSR npm: type leak (Pitfall 2)        | Keep Effect types out of `@fresh/core` public API   |
| HandlerFn type extension     | Inference depth explosion (Pitfall 4) | Use separate EffectHandlerFn, runtime detection only |
| Plugin API / runtime         | Per-request runtime creation (P5)     | Module-level singleton + Deno lifecycle disposal    |
| Error handling in dispatch   | Unhandled errors crash Deno (P9)      | Always `.catch()` or `runPromiseExit`               |
| Island hook implementation   | Preact/React compat conflict (P3)     | Native `preact/hooks`, no `react` dependency        |
| Island bundle size           | Effect runtime cost (P8)             | Measure before committing; lazy/shared runtime       |
| Atom hydration design        | Non-serializable atom state (P6)      | Serialize values only, not atom objects              |
| TypeScript / Deno CI         | Version lag false positives (P7)      | Dual type-check: `deno check` + `tsc`               |
| Effect v4 beta version bumps | API churn (Pitfall 1)                 | Pin exact version; adapter module isolates changes  |

---

## Sources

- Fresh source: `packages/fresh/src/handlers.ts`, `app.ts`, `context.ts`,
  `runtime/client/reviver.ts`, `jsonify/stringify.ts` — all inspected directly
  (HIGH confidence)
- [effect-smol TODOS.md](https://github.com/Effect-TS/effect-smol/blob/main/TODOS.md) —
  confirms atom in alpha, beta phase incomplete (MEDIUM confidence)
- [effect-atom confirmation thread](https://www.answeroverflow.com/m/1436553817293590629) —
  Michael Arnaldi confirmed atom-react folding into Effect 4.0 (MEDIUM confidence,
  based on community forum summary of a November 2025 video)
- [Deno Support issue effect-smol #79](https://github.com/Effect-TS/effect-smol/issues/79) —
  TypeScript version lag documented by Effect maintainers (HIGH confidence)
- [JSR publishing docs](https://jsr.io/docs/publishing-packages) — "no slow types"
  constraint on npm: type references (HIGH confidence)
- [Preact/React hook conflict](https://github.com/denoland/fresh/issues/1491) —
  Fresh issue confirming React library dual-reconciler problems in islands
  (HIGH confidence, first-party source)
- [preact-vs-compat](https://marvinh.dev/blog/preact-vs-compat/) — Preact compat
  pitfalls by Fresh maintainer (HIGH confidence)
- [Effect ManagedRuntime docs](https://effect.website/docs/runtime/) — disposal
  required, no auto cleanup (HIGH confidence, official docs)
- [What's New in Effect v4](https://gist.github.com/kevinmichaelchen/84c0ce72b5e33b39062822dcf6c7f595) —
  breaking changes overview (MEDIUM confidence, community summary)
- [Effect x TS @EffectTS_ tweet](https://x.com/EffectTS_/status/1909572722058805333) —
  "smaller bundles" claim for v4 (LOW confidence, marketing claim not measured)
