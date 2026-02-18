# Technology Stack: Effect v4 + Fresh Integration

**Project:** Effect v4 native support in Fresh 2 (Deno web framework)
**Researched:** 2026-02-18
**Research mode:** Ecosystem — Stack dimension

---

## Summary Verdict

The Effect v4 ecosystem is in **active beta** (`4.0.0-beta.0`), with a significant architectural reorganization from v3. The atom/reactivity story for Preact specifically has a gap: **no official Preact bindings exist** in either the v3 (`@effect-atom/atom-react`) or v4 (`@effect/atom-react`) packages. Both are React-only. This integration must either port the React hooks to Preact or adapt them using `preact/compat`.

---

## Core Packages

### Effect v4 Core

| Package | Version | Status | Notes |
|---------|---------|--------|-------|
| `effect` | `4.0.0-beta.0` | Beta on npm, `latest` tag is still `3.19.18` | V4 installs via `effect@beta` or `effect@4.0.0-beta.0` |
| `@effect/platform-*` | `4.0.0-beta.0` | Beta | Platform-specific packages remain separate |

**Confidence: HIGH** — Verified directly via npm registry `https://registry.npmjs.org/effect`.

**Key v4 architectural changes relevant to this integration:**

1. **`Runtime<R>` is removed.** The `Runtime` module in v4 only contains process lifecycle utilities (`Teardown`, `makeRunMain`). `Runtime<R>` is replaced by `ServiceMap<R>`. This breaks `@effect-atom/atom` (v3) which imports `Runtime.Runtime<R>`.

2. **`Context.Tag` / `Effect.Tag` → `ServiceMap.Service`.** All service definitions must be migrated. The proxy accessor pattern is gone; use `Service.use()` or `yield*` instead.

3. **Atom/Reactivity moved into core.** In v4, the Atom module lives at `effect/unstable/reactivity/Atom` and `effect/unstable/reactivity/AtomRegistry` inside the core `effect` package. It is marked `unstable/` (may change in minor releases).

4. **Package consolidation.** `@effect/platform`, `@effect/rpc`, `@effect/cluster` are merged into `effect`. Only platform-specific, provider-specific, or framework-binding packages stay separate.

5. **Single version number across ecosystem.** All packages share one version: if you use `effect@4.0.0-beta.0`, the SQL package is `@effect/sql-pg@4.0.0-beta.0`.

**Sources:** npm registry, `https://github.com/effect-TS/effect-smol/blob/main/MIGRATION.md`

---

## Effect Atom Packages — Two Parallel Lineages

There are currently two separate atom package lineages, one for v3 and one for v4:

### Lineage A: `@effect-atom/*` (v3-compatible, third-party)

Maintained by Tim Smart (`github.com/tim-smart/effect-atom`). Renamed from `effect-rx` in August 2025.

| Package | Version | Peer Deps | Notes |
|---------|---------|-----------|-------|
| `@effect-atom/atom` | `0.5.2` | `effect@^3.19.15` | Core atom logic |
| `@effect-atom/atom-react` | `0.5.0` | `effect@^3.19`, `react@>=18 <20`, `scheduler@*` | React hooks only |

**`@effect-atom/atom-preact` does NOT exist.** Confirmed by npm registry returning `{ "error": "Not found" }` for `@effect-atom/atom-preact`.

This lineage is **incompatible with Effect v4** because it imports `effect/Runtime` (which is removed in v4) and requires `effect@^3.19.x`.

### Lineage B: `@effect/atom-react` (v4-official)

Maintained by the Effect team, lives in `github.com/effect-TS/effect-smol`. Part of the official v4 release.

| Package | Version | Peer Deps | Notes |
|---------|---------|-----------|-------|
| `@effect/atom-react` | `4.0.0-beta.0` | `effect: workspace:^`, `react@^19.2.4`, `scheduler@*` | Official v4 React bindings |

**No `@effect/atom-preact` exists** in the effect-smol repo. The `packages/atom/` directory contains only: `react`, `solid`, `vue`. Confirmed by direct GitHub inspection.

**Confidence: HIGH** — Verified via npm registry + GitHub repo directory listing.

---

## `@effect-atom/atom` Core API (v3 lineage)

Source: `github.com/tim-smart/effect-atom/blob/main/packages/atom/src/Atom.ts`

### Atom Constructors

```typescript
// Read-only derived atom (sync)
const readable = <A>(
  read: (get: Context) => A,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void
): Atom<A>

// Effectful atom (wraps an Effect<A, E, Scope | AtomRegistry> or Stream)
const make: {
  <A, E>(
    create: (get: Context) => Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
    options?: { readonly initialValue?: A }
  ): Atom<Result.Result<A, E>>
  <A, E>(
    effect: Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
    options?: { readonly initialValue?: A }
  ): Atom<Result.Result<A, E>>
}

// Writable state atom
const state = <A>(initialValue: A): Writable<A, A>

// Runtime atom — ties an Effect Layer to the registry
const runtime: RuntimeFactory  // global default RuntimeFactory
```

### RuntimeFactory API

```typescript
interface RuntimeFactory {
  <R, E>(
    create:
      | Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>
      | ((get: Context) => Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>)
  ): AtomRuntime<R, E>
  readonly memoMap: Layer.MemoMap
  readonly addGlobalLayer: <A, E>(layer: Layer.Layer<A, E, AtomRegistry | Reactivity.Reactivity>) => void
}
```

Usage: `const myRuntime = Atom.runtime(MyServiceLayer)` — creates an atom that, when the registry evaluates it, builds a `Runtime.Runtime<R>` from the given Layer.

### AtomRuntime API

```typescript
interface AtomRuntime<R, ER> extends Atom<Result.Result<Runtime.Runtime<R>, ER>> {
  // Create an effectful atom scoped to this runtime's services
  atom<A, E>(
    create: (get: Context) => Effect.Effect<A, E, Scope.Scope | R | AtomRegistry | Reactivity.Reactivity>,
    options?: { readonly initialValue?: A }
  ): Atom<Result.Result<A, E | ER>>

  // Create a function atom (re-runs when arg changes)
  fn<Arg>(): {
    <E, A>(fn: (arg: Arg, get: FnContext) => Effect.Effect<A, E, ...R>): (arg: Arg) => Atom<Result.Result<A, E | ER>>
  }
}
```

### Registry

```typescript
interface Registry {
  get<A>(atom: Atom<A>): A
  mount<A>(atom: Atom<A>): () => void  // returns unmount fn
  set<R, W>(atom: Writable<R, W>, value: W): void
  subscribe<A>(atom: Atom<A>, f: (_: A) => void, options?: { immediate?: boolean }): () => void
  refresh<A>(atom: Atom<A>): void
  dispose(): void
}

const make = (options?: {
  initialValues?: Iterable<readonly [Atom<any>, any]>
  scheduleTask?: (f: () => void) => void
  timeoutResolution?: number
  defaultIdleTTL?: number
}): Registry
```

**Confidence: HIGH** — Verified from actual TypeScript source files.

---

## `@effect-atom/atom-react` React Hook API (v3 lineage)

Source: `github.com/tim-smart/effect-atom/blob/main/packages/atom-react/src/Hooks.ts`

### React APIs Used

The package uses these React APIs:
- `React.useCallback`
- `React.useContext`
- `React.useEffect`
- `React.useMemo`
- `React.useState`
- `React.useSyncExternalStore`

### Hook Exports

```typescript
// Read an atom value (re-renders on change)
useAtomValue<A>(atom: Atom<A>): A
useAtomValue<A, B>(atom: Atom<A>, f: (_: A) => B): B

// Mount + get setter for a writable atom
useAtomSet<R, W>(atom: Writable<R, W>, options?): (value: W | ((v: R) => W)) => void

// Combined read + write
useAtom<R, W>(atom: Atom<R> | Writable<R, W>): [R, setter]

// Mount atom (keep alive while component is mounted)
useAtomMount<A>(atom: Atom<A>): void

// Set initial SSR values
useAtomInitialValues(initialValues: Iterable<readonly [Atom<any>, any]>): void

// Suspend until async atom resolves
useAtomSuspense<A, E>(atom: Atom<Result<A, E>>): A

// Subscribe callback
useAtomSubscribe<A>(atom: Atom<A>, f: (value: A) => void): void

// Refresh
useAtomRefresh<A>(atom: Atom<A>): () => void
```

### Provider Component

```typescript
// Wraps the app; creates and provides a Registry
<RegistryProvider
  initialValues?: Iterable<readonly [Atom<any>, any]>
  scheduleTask?: (f: () => void) => void
  timeoutResolution?: number
  defaultIdleTTL?: number
>
  {children}
</RegistryProvider>

// Also exported:
const RegistryContext: React.Context<Registry>
```

**Confidence: HIGH** — Verified from actual TypeScript source.

---

## `@effect/atom-react` v4 Hook API (v4-official)

Source: `github.com/effect-TS/effect-smol/blob/main/packages/atom/react/src/`

The v4 hook API is structurally identical to the v3 hook API but:
- Imports from `effect/unstable/reactivity/Atom` and `effect/unstable/reactivity/AtomRegistry`
- Uses `AsyncResult` instead of `Result` for async atoms
- Same hooks: `useAtomValue`, `useAtom`, `useAtomSet`, `useAtomMount`, `useAtomInitialValues`, `useAtomSuspense`, `useAtomSubscribe`, `useAtomRefresh`, `useAtomRef`, `useAtomRefProp`, `useAtomRefPropValue`
- Same provider: `RegistryProvider`, `RegistryContext`
- Still React-only (imports `* as React from "react"`)

**Confidence: HIGH** — Verified from actual TypeScript source.

---

## Preact Compatibility Analysis

### Can `@effect-atom/atom-react` work with Preact via `preact/compat`?

**Verdict: Likely yes, with caveats.**

The critical question is whether `preact/compat` implements all React APIs used by `@effect-atom/atom-react`. Analysis:

| React API Used | In `preact/compat`? | Notes |
|----------------|---------------------|-------|
| `React.useContext` | YES | Core Preact hook |
| `React.useCallback` | YES | Core Preact hook |
| `React.useEffect` | YES | Core Preact hook |
| `React.useMemo` | YES | Core Preact hook |
| `React.useState` | YES | Core Preact hook |
| `React.useSyncExternalStore` | YES | Implemented as shim in `preact/compat/src/hooks.js` |
| `React.createElement` | YES | Core |
| `React.createContext` | YES | Core |

All React APIs used by `@effect-atom/atom-react` are implemented in `preact/compat`. The `useSyncExternalStore` implementation is a polyfill based on the React reference implementation (confirmed in source: `preact/compat/src/hooks.js`).

**Caveat:** The `preact/compat` `useSyncExternalStore` is a shim, not native. There is a known behavioral difference: if `getSnapshot` returns a function, `setState` executes it (differs from React). The `@effect-atom/atom-react` `getServerSnapshot` returns a plain value, so this edge case likely does not apply.

**Caveat:** `@effect-atom/atom-react` peer-requires `scheduler` package (`scheduler@*`) and imports `Scheduler.unstable_scheduleCallback`. Preact does not use `scheduler`. The `scheduler` package is a React-internal package but is published standalone. This dependency must be resolved separately.

**Practical approach:** To use `@effect-atom/atom-react` in a Preact environment, add import aliases in `deno.json`:
```json
{
  "imports": {
    "react": "npm:preact/compat",
    "react-dom": "npm:preact/compat",
    "react/jsx-runtime": "npm:preact/jsx-runtime"
  }
}
```

**Confidence: MEDIUM** — Preact compat support for all needed APIs is verified from source. Full runtime compatibility is not tested in this context; may surface edge cases with the `scheduler` package.

---

## Fresh 2 Plugin/Middleware API

Source: `github.com/denoland/fresh/blob/main/packages/fresh/src/`

### App Class (core extension point)

```typescript
class App<State> {
  // Register middleware at root or path
  use(...middleware: MaybeLazyMiddleware<State>[]): this
  use(path: string, ...middleware: MaybeLazyMiddleware<State>[]): this

  // HTTP method-specific routes
  get(path: string, ...middlewares: MaybeLazy<Middleware<State>>[]): this
  post(path: string, ...middlewares: MaybeLazy<Middleware<State>>[]): this
  // patch, put, delete, head, all ...

  // Route with component + handler
  route(path: string, route: MaybeLazy<Route<State>>, config?: RouteConfig): this

  // Merge another App instance
  mountApp(path: string, app: App<State>): this

  // Create handler for Deno.serve
  handler(): (request: Request, info?: Deno.ServeHandlerInfo) => Promise<Response>

  // Config
  config: ResolvedFreshConfig  // { root, basePath, mode }
}
```

### Middleware Type

```typescript
type Middleware<State> = (ctx: Context<State>) => Response | Promise<Response>
```

### Route Handler Return Types (current, pre-Effect integration)

```typescript
interface HandlerFn<Data, State> {
  (ctx: Context<State>):
    | Response
    | PageResponse<Data>
    | Promise<Response | PageResponse<Data>>
}

interface PageResponse<T> {
  data: T
  headers?: HeadersInit
  status?: number
}
```

**Goal:** Also allow `Effect<Response | PageResponse<Data>, E>` as a return type. This requires wrapping the handler execution in an Effect-aware adapter that runs the Effect and resolves to a `Promise<Response>`.

### Plugin Pattern (Fresh 2)

Fresh 2 does not have a formal `plugin` interface separate from `App`. Plugins are implemented by:
1. Exporting a function that takes an `App<State>` and calls `app.use(...)`, `app.get(...)`, etc.
2. Alternatively, exporting a standalone `App` instance and calling `mainApp.mountApp(path, pluginApp)`.

```typescript
// Plugin pattern A: function
export function effectPlugin<State>(
  layer: Layer.Layer<..., ...>,
  app: App<State>
): void {
  app.use(effectMiddleware(layer))
}

// Plugin pattern B: standalone App
export function createEffectApp<State>(
  layer: Layer.Layer<..., ...>
): App<State> {
  const pluginApp = new App()
  pluginApp.use(effectMiddleware(layer))
  return pluginApp
}
// Usage: mainApp.mountApp("/", createEffectApp(AppLayer))
```

**Confidence: HIGH** — Verified from Fresh v2 source code.

---

## Effect v4 Runtime API (relevant subset)

### Key APIs for Handler Integration

```typescript
// Effect v4 — running effects (on Effect namespace directly)
Effect.runPromise<A, E>(effect: Effect.Effect<A, E, never>, options?: { signal?: AbortSignal }): Promise<A>
Effect.runPromiseExit<A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, E>>
Effect.runSync<A, E>(effect: Effect.Effect<A, E, never>): A

// Providing services to an effect
Effect.provide<A, E, R, R2>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, R2>
): Effect.Effect<A, E | R2, never>

// Layer construction
Layer.succeed<T>(tag: ServiceMap.Service<T, ...>, impl: T): Layer.Layer<T>
Layer.effect<T, E, R>(tag, effect): Layer.Layer<T, E, R>
Layer.provide(layerA, layerB): Layer.Layer<...>
Layer.merge(layerA, layerB): Layer.Layer<...>
```

Note: `ManagedRuntime` still exists in v4 and is the recommended way to build a long-lived runtime from a Layer when you need to run many effects over time (e.g., per-request in a server context). The `ManagedRuntime` interface is unchanged from v3:

```typescript
interface ManagedRuntime<R, ER> {
  runPromise<A, E>(effect: Effect<A, E, R>, options?: { signal?: AbortSignal }): Promise<A>
  runPromiseExit<A, E>(effect: Effect<A, E, R>): Promise<Exit<A, ER | E>>
  runSync<A, E>(effect: Effect<A, E, R>): A
  runFork<A, E>(effect: Effect<A, E, R>): Fiber<A, E | ER>
  dispose(): Promise<void>
}

// Constructor
ManagedRuntime.make<R, E>(layer: Layer.Layer<R, E>): ManagedRuntime<R, E>
```

**Confidence: HIGH** — Verified from Effect source (`ManagedRuntime.ts` in effect-TS/effect).

---

## Recommended Stack for This Integration

### Package Choices

| Concern | Package | Version | Reason |
|---------|---------|---------|--------|
| Effect core | `effect` | `4.0.0-beta.0` | Target version per project spec |
| Atom core | `effect/unstable/reactivity/Atom` | (bundled with v4) | Built into `effect` v4 core |
| Atom React bindings | `@effect/atom-react` | `4.0.0-beta.0` | Official v4 bindings; must be ported to Preact |
| Preact compat | `npm:preact@^10.28.2` | `^10.28.2` | Existing project dep |
| Preact compat shim | `preact/compat` | (bundled with preact) | For aliasing React imports |
| Fresh core | `jsr:@fresh/core@^2.0.0` | `^2.0.0` | Existing project dep |

### What Must Be Built (the gap)

1. **Preact-native atom hooks:** No `@effect/atom-preact` exists. Two options:
   - **Option A (import alias):** Alias `react` → `preact/compat` in `deno.json`. Use `@effect/atom-react` as-is. Add `scheduler` as a dependency. Lowest effort, relies on compat shim.
   - **Option B (native port):** Write `packages/fresh-effect-atom` that re-implements the hooks using `preact/hooks` directly (no `preact/compat`). Replace `React.useSyncExternalStore` with preact's own implementation. Zero compat overhead.

   **Recommendation: Option B (native port).** Fresh already uses Preact natively; adding a `preact/compat` layer introduces overhead and potential edge cases. The hook implementation is ~200 lines and depends only on stable primitives (`useContext`, `useState`, `useEffect`, `useLayoutEffect`). Preact implements `useSyncExternalStore` as a userland shim anyway (the same shim we'd use); implementing it directly is equivalent.

2. **Effect-aware route handler adapter:** Wrap Fresh's `HandlerFn` to accept `Effect<Response | PageResponse<Data>, E, R>` and run it against a `ManagedRuntime<R>` stored in app state or middleware context.

3. **Server-side atom hydration:** Mechanism to pre-populate `initialValues` on the server and serialize them into the HTML for island hydration.

### What Does NOT Need to Be Built

- The Effect v4 core runtime — it's in `effect@4.0.0-beta.0`
- The Atom registry logic — it's in `effect/unstable/reactivity/AtomRegistry`
- The Atom model — it's in `effect/unstable/reactivity/Atom`
- Fresh middleware/plugin infrastructure — `app.use()` is the right entry point

---

## Version Compatibility Matrix

| Combination | Compatible? | Notes |
|-------------|-------------|-------|
| `effect@4.0.0-beta.0` + `@effect-atom/atom@0.5.2` | NO | `@effect-atom/atom` requires `effect@^3.19.x`; v4 removed `Runtime<R>` |
| `effect@4.0.0-beta.0` + `@effect/atom-react@4.0.0-beta.0` | YES | Official v4 pairing |
| `effect@3.19.x` + `@effect-atom/atom@0.5.2` | YES | Current stable v3 |
| `@effect/atom-react` + `preact/compat` | LIKELY YES | All React APIs shimmed; scheduler dep needed |

---

## Sources

- npm registry: `https://registry.npmjs.org/effect` — Effect dist-tags confirming `beta: 4.0.0-beta.0`, `latest: 3.19.18`
- npm registry: `https://registry.npmjs.org/@effect-atom/atom` — version `0.5.2`, peer `effect@^3.19.15`
- npm registry: `https://registry.npmjs.org/@effect-atom/atom-react` — version `0.5.0`
- npm registry: `https://registry.npmjs.org/@effect-atom/atom-preact` — `{ "error": "Not found" }` (does not exist)
- npm registry: `https://registry.npmjs.org/@effect/atom-react` — `beta: 4.0.0-beta.0` (official v4)
- GitHub: `https://github.com/tim-smart/effect-atom` — `packages/atom/src/Atom.ts` — Atom constructors, RuntimeFactory, AtomRuntime interfaces
- GitHub: `https://github.com/tim-smart/effect-atom` — `packages/atom-react/src/Hooks.ts` — React APIs used; hook exports
- GitHub: `https://github.com/tim-smart/effect-atom` — `packages/atom-react/src/RegistryContext.ts` — RegistryProvider pattern
- GitHub: `https://github.com/effect-TS/effect-smol` — `MIGRATION.md` — v4 breaking changes overview
- GitHub: `https://github.com/effect-TS/effect-smol` — `migration/runtime.md` — `Runtime<R>` removal
- GitHub: `https://github.com/effect-TS/effect-smol` — `migration/services.md` — `Context.Tag` → `ServiceMap.Service`
- GitHub: `https://github.com/effect-TS/effect-smol` — `packages/atom/` directory — confirms `react`, `solid`, `vue` only (no `preact`)
- GitHub: `https://github.com/effect-TS/effect-smol` — `packages/atom/react/src/Hooks.ts` — v4 hook API
- GitHub: `https://github.com/effect-TS/effect-smol` — `packages/atom/react/src/RegistryContext.ts` — v4 `effect/unstable/reactivity/AtomRegistry` import paths
- GitHub: `https://github.com/effect-TS/effect` — `packages/effect/src/ManagedRuntime.ts` — ManagedRuntime API (still exists in v4 source)
- GitHub: `https://github.com/denoland/fresh` — `packages/fresh/src/app.ts` — App class, `use()`, `mountApp()`
- GitHub: `https://github.com/denoland/fresh` — `packages/fresh/src/handlers.ts` — `HandlerFn`, `PageResponse`, `RouteHandler` types
- GitHub: `https://github.com/denoland/fresh` — `packages/fresh/src/middlewares/mod.ts` — `Middleware<State>` type
- GitHub: `https://github.com/preactjs/preact` — `compat/src/hooks.js` — confirms `useSyncExternalStore` is implemented
- Tim Smart on X (2025-08-08): `effect-rx` renamed to `effect-atom`, new `AtomRpc` module added
