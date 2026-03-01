# Roadmap: Fresh + Effect v4 Integration

## Overview

Five phases deliver native Effect v4 support in Fresh 2, progressing from the
type-safe handler detection foundation through plugin/runtime wiring, Preact atom
hooks, server-to-client atom hydration, and finally a working end-to-end example
that validates the full stack. Each phase is gated on the one before it; nothing
ships until the example runs clean.

## Milestone: v1

Native Effect v4 integration in Fresh — Effect-returning handlers, Preact atom
hooks, server-to-client hydration — working end-to-end and demonstrated in
`packages/examples/`.

## Phases

- [x] **Phase 1: Foundation** — Effect detection, plugin runtime, error dispatch
- [x] **Phase 2: Type-Safe API** — `createEffectDefine()` typed wrapper
- [x] **Phase 3: Preact Atom Hooks** — Native `useAtom` / `useAtomValue` / `useAtomSet`
- [x] **Phase 4: Atom Hydration** — Server-to-client atom serialization
- [x] **Phase 5: Example** — End-to-end demonstration in `packages/examples/`

## Phase Details

### Phase 1: Foundation

**Goal**: A route handler can return an Effect value and Fresh will run it through
a configured ManagedRuntime with typed error dispatch — without Effect types
appearing in `@fresh/core`'s public API.

**Depends on**: Nothing (first phase)

**Requirements**: HAND-01, HAND-02, HAND-03, HAND-05, PLUG-01, PLUG-02, PLUG-03, PLUG-04

**Success Criteria** (what must be TRUE):
1. A route handler returning `Effect<Response | PageResponse<Data>, E>` produces
   the same HTTP response as an equivalent async handler — verified by running the
   Fresh dev server and hitting the route.
2. `deno publish --dry-run` on `@fresh/core` succeeds — no Effect type imports
   leak into the public API surface.
3. An unhandled Effect failure renders the existing Fresh error page rather than
   crashing the Deno process.
4. `effectPlugin()` with no arguments works (zero-config); `effectPlugin({ layer })`
   works with a user-supplied Layer — both paths verified by running the example
   server and observing requests succeed.

**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — EffectLike structural type + setEffectResolver() hook in Fresh core
- [x] 01-02-PLAN.md — effectPlugin() package: ManagedRuntime lifecycle, middleware, resolver wiring
- [x] 01-03-PLAN.md — Error dispatch refinement + resolver/plugin test suite

---

### Phase 2: Type-Safe API

**Goal**: Developers can define Effect-returning route handlers with full TypeScript
inference over their Layer's service requirements via `createEffectDefine()`.

**Depends on**: Phase 1 (handler dispatch must work before type wrapper is useful)

**Requirements**: HAND-04

**Success Criteria** (what must be TRUE):
1. `createEffectDefine<State, R>()` compiles without error and the `R` type parameter
   threads through to the handler's Effect return type — verified by `expect-type`
   assertions in the test suite.
2. An `Effect` handler written with `createEffectDefine` that accidentally uses a
   service not provided by the configured Layer produces a TypeScript compile error
   at the handler definition site.

**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md — createEffectDefine<State, R>() implementation + EffectHandlerFn types + expect-type and runtime tests

---

### Phase 3: Preact Atom Hooks

**Goal**: Preact islands can subscribe to and update Effect v4 atoms using native
`useAtom`, `useAtomValue`, and `useAtomSet` hooks — no `preact/compat` required.

**Depends on**: Phase 1 (Effect runtime must exist; Phase 2 is independent and can
run in parallel with Phase 3 after Phase 1 completes)

**Requirements**: ATOM-01, ATOM-02, ATOM-03

**Success Criteria** (what must be TRUE):
1. A Preact island that calls `useAtom(atom)` renders the current atom value and
   re-renders when the atom is updated — observable in a browser with devtools open.
2. `useAtomValue` and `useAtomSet` work independently: value-only and setter-only
   consumers do not trigger unnecessary re-renders when only the other side updates.
3. No `react` or `preact/compat` import appears anywhere in `plugin-effect/src/island.ts`
   — verified by `deno info` dependency graph output.

**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md — Verify v4 Atom API surface, implement useAtom/useAtomValue/useAtomSet in island.ts, export and type tests

---

### Phase 4: Atom Hydration

**Goal**: An atom value set server-side inside an Effect handler is serialized into
the island's initial props and available synchronously when the island boots on
the client — no loading flash.

**Depends on**: Phase 3 (atom hooks must be stable before layering serialization on
top; also requires verifying v4 atom pre-seeding API before starting)

**Requirements**: HYDR-01, HYDR-02, HYDR-03

**Success Criteria** (what must be TRUE):
1. A Preact island renders the server-computed atom value on first paint without a
   loading state — observable by disabling JavaScript after the initial HTML loads
   and confirming the value is present in the markup.
2. Atoms have stable string identifiers: the same atom key resolves to the same
   value across server render and client hydration — verified by inspecting the
   serialized props in the page source.
3. `deno publish --dry-run` on `@fresh/core` continues to pass after the
   `stringify.ts` / `reviver.ts` extension points are added.

**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — Server-side: Fresh core hook + setAtom() helper + hydration serialization into HTML
- [x] 04-02-PLAN.md — Client-side: initAtomHydration() in island.ts + registry pre-seeding + round-trip tests

---

### Phase 5: Example

**Goal**: A runnable kitchen-sink app in `packages/examples/effect-integration/`
demonstrates Effect-returning handlers with a typed Layer, Preact islands using
`useAtom` with server-hydrated atoms, full CRUD via API routes, and typed error
dispatch with Cause.pretty() logging.

**Depends on**: Phase 4 (all prior phases must be complete)

**Requirements**: EXAM-01, EXAM-02

**Success Criteria** (what must be TRUE):
1. `deno task dev` in `packages/examples/effect-integration/` starts without errors
   and the example route responds with data from the Effect handler's Layer service.
2. The example island displays an atom value hydrated from the server on first paint
   and updates it via `useAtom` setter when a button is clicked — observable in a
   browser without any additional setup.

**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Project scaffold, TodoService + TodoLayer (in-memory), AppLayer, serializable atoms, app shell
- [x] 05-02-PLAN.md — Routes (index, API CRUD, error demo), TodoApp island with optimistic updates, error pages

---

## Milestone: v2

Effect-First Handlers, HttpApi & RPC — per-app Effect runner, `@fresh/effect`
package with `EffectApp<State, AppR>`, schema-first `HttpApi` mounting, native
Effect RPC via `platform-deno-smol`, and `@fresh/plugin-effect` compat shim.

## v2 Phases

- [x] **Phase 6: Fresh Core Plumbing** — Per-app Effect runner, `isEffectLike` export
- [x] **Phase 7: @fresh/effect Package** — `EffectApp`, `createEffectApp`, per-app lifecycle
- [x] **Phase 8: HttpApi Integration** — `app.httpApi()` mounts Effect HttpApi
- [x] **Phase 9: RPC Integration** — `app.rpc()` mounts Effect RpcServer, `useRpcResult()` / `useRpcStream()` in islands
- [~] **Phase 10: Migration + Example** — skipped (MIG-02 satisfied by Phase 9; no external users require MIG-01 compat shim)
- [x] **Phase 11: Micro-App Architecture** — Research `mountApp` issues, evaluate Module Federation, architectural decision
- [x] **Phase 12: Atom-Based Island Hydration** — Research replacing signal hydration with atom hydration, decision document
- [x] **Phase 13: Benchmarks — Freak vs Fresh** — Repeatable benchmark suite, published results report

## v2 Phase Details

### Phase 6: Fresh Core Plumbing

**Goal**: Multiple `App` instances in the same process each own their Effect runner
— the global `_effectResolver` singleton is replaced with a per-app hook, and
Effect handlers work via `app.get()` / `app.post()` / `app.use()` with no
observable behavior change for existing code.

**Depends on**: Phase 5 (v1 complete — all existing integration tests must remain green)

**Requirements**: CORE-01, CORE-02, CORE-03

**Success Criteria** (what must be TRUE):
1. Two `App` instances created in the same test process each run Effect handlers
   through their own runner without interfering — verified by a test that registers
   distinct Layers on two apps and asserts each handler sees only its own services.
2. An Effect handler registered via `app.get()` or `app.post()` returns the correct
   HTTP response — verified by the existing plugin-effect integration test suite
   running without modification.
3. An Effect-returning middleware registered via `app.use()` runs and its Effect is
   resolved — verified by a test that uses a middleware Effect to inject a value
   into `ctx.state` and asserts a downstream handler reads it.
4. All existing plugin-effect integration tests pass unchanged after the refactor.

**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — Per-app Effect runner + thread through all dispatch paths
- [x] 06-02-PLAN.md — Update plugin-effect consumer + comprehensive tests

---

### Phase 7: @fresh/effect Package

**Goal**: Developers can replace `effectPlugin` with `createEffectApp({ layer })`
and get a fully typed `EffectApp<State, AppR>` that proxies all `App<State>` builder
methods, manages its `ManagedRuntime` per-app via `AbortController`, and shuts
down cleanly on SIGTERM/SIGINT.

**Depends on**: Phase 6 (`setEffectRunner` / `getEffectRunner` must exist in Fresh core)

**Requirements**: EAPP-01, EAPP-02, EAPP-03, EAPP-04

**Success Criteria** (what must be TRUE):
1. `createEffectApp({ layer })` returns an `EffectApp` where calling `.get()`,
   `.post()`, `.use()`, and `.route()` all work identically to `App` — verified by
   running the existing example app converted to `createEffectApp` and observing
   all routes respond correctly.
2. TypeScript rejects an `EffectApp<State, AppR>` whose handler uses a service not
   present in the provided `Layer` — verified by a `tsc --noEmit` check on a
   deliberately misconfigured handler.
3. Sending SIGTERM to a running `EffectApp` server causes `ManagedRuntime.dispose()`
   to be called and the process to exit cleanly — verified by spawning the server
   as a subprocess, sending SIGTERM, and asserting the exit code is 0.
4. Two `EffectApp` instances in the same test process each own independent
   `ManagedRuntime` instances — verified by a test that disposes one and asserts
   the other continues to serve requests.

**Plans**: 2 plans

Plans:
- [x] 07-01-PLAN.md — Core @fresh/effect package: EffectApp class, createEffectApp factory, signal lifecycle, createEffectDefine, resolver/runtime
- [x] 07-02-PLAN.md — Tests for all 4 SCs (app_test, types_test, signal_test) + example app conversion to createEffectApp

---

### Phase 8: HttpApi Integration

**Goal**: Calling `app.httpApi(prefix, api, ...groupLayers)` on an `EffectApp` mounts
an Effect `HttpApi` definition within Fresh — requests routed to the API's declared
path prefix are handled by the Effect HTTP stack with fully decoded params/query/payload
and typed errors mapped to correct HTTP status codes.

**Depends on**: Phase 7 (`EffectApp` must exist)

**Requirements**: HAPI-01, HAPI-02, HAPI-03

**Success Criteria** (what must be TRUE):
1. A GET request to a mounted `HttpApi` endpoint returns the response defined by
   the group implementation — verified by hitting the endpoint in the running
   example app and asserting the JSON body matches expectations.
2. A request with invalid query parameters returns 400 with a schema-validation
   error body — verified by sending a malformed request and inspecting the response
   status and body.
3. A handler that returns a typed `HttpApiError` produces the correct HTTP status
   code (e.g., 404 for not-found) — verified by hitting a route that deliberately
   returns the typed error and asserting the response status.

**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — EffectApp.httpApi() method + deno.json import maps + dispose integration
- [x] 08-02-PLAN.md — Test suite (3 SCs) + example app HttpApi demo

---

### Phase 9: RPC Integration

**Goal**: Calling `app.rpc({ group, path, protocol })` on an `EffectApp` mounts
a native Effect RPC server, and Preact islands can call `useRpcResult(group)` and
`useRpcStream(group)` to get fully typed clients that send requests over HTTP or
WebSocket — no manual fetch wiring.

**Depends on**: Phase 8 (RPC layers are accumulated and dispatched alongside HttpApi
layers in `EffectApp.build()`)

**Requirements**: RPC-01, RPC-02, RPC-03

**Success Criteria** (what must be TRUE):
1. An island calling `useRpcResult(group)` can invoke an RPC procedure and receive
   the typed response — verified by automated integration test using RpcTest.makeClient pattern.
2. The same RPC group works over both HTTP and WebSocket protocols — verified in-browser
   (real WS connection observable in devtools) with example app.
3. TypeScript rejects a `useRpcResult` call that invokes a procedure not declared
   in the group's schema — verified by a `tsc --noEmit` check on a deliberately
   incorrect call site.

**Plans**: 2 plans

Plans:
- [x] 09-01-PLAN.md — EffectApp.rpc() method + useRpcResult/useRpcStream island hooks + deno.json imports
- [x] 09-02-PLAN.md — Test suite (3 SCs) + example app RPC demo with live WS updates

---

### Phase 10: Migration + Example

**Goal**: `@fresh/plugin-effect` users can migrate to `@fresh/effect` at their own
pace — importing `effectPlugin` from the old package continues to work unchanged
while the updated example demonstrates `createEffectApp` + `httpApi` + `rpc`
end-to-end as the canonical v2 usage pattern.

**Depends on**: Phase 9 (all v2 capabilities must be stable before the shim and
example can demonstrate them together)

**Requirements**: MIG-01, MIG-02

**Success Criteria** (what must be TRUE):
1. An existing project importing `effectPlugin` from `@fresh/plugin-effect` without
   any code changes continues to start and handle Effect-returning handlers — verified
   by running the original v1 example unmodified and asserting all routes respond.
2. The updated `packages/examples/effect-integration/` starts with `deno task dev`,
   serves a route via `createEffectApp`, returns data from a mounted `httpApi`
   endpoint, and renders island data sourced from `useRpcClient` — all observable
   in a browser without additional setup.

**Plans**: TBD

---

### Phase 11: Micro-App Architecture

**Goal**: Produce an architectural decision document for `mountApp` composition in Freak
— documenting root causes of current failures, evaluating three composition models (fix
mountApp, programmatic plugin pattern, Module Federation), and recording the decision
to adopt the programmatic plugin pattern with rationale.

**Depends on**: Can be planned independently of Phases 7-10 (parallel research track)

**Requirements**: TBD (to be defined during planning)

**Reference**: https://github.com/module-federation/vite#readme — Module Federation Vite plugin

**Success Criteria** (what must be TRUE):
1. The root cause of the current `mountApp` issues is documented — what breaks, why, and
   under what conditions.
2. An architectural decision is recorded: fix `mountApp`, replace with a sub-app pattern,
   adopt Module Federation, or another approach — with rationale.
3. If code changes are made: a working example demonstrates two Freak apps composing
   correctly in the same process without interference.

**Plans**: 1 plan

Plans:
- [x] 11-01-PLAN.md — Synthesize research into 11-DECISION.md (root causes, options evaluation, decision)

---

### Phase 12: Atom-Based Island Hydration

**Goal**: Confirm the dual-channel hydration architecture (signals for island props, atoms
for global state via __FRSH_ATOM_STATE) is correct and complete. Produce a decision document
recording that atom-based hydration layers on top of signal hydration, with gap assessment
and API stability analysis.

**Depends on**: Phase 11 (v2 complete)

**Requirements**: TBD (to be defined during planning)

**Success Criteria** (what must be TRUE):
1. The current hydration path (stringify.ts / reviver.ts / island props) is fully
   documented — how atoms are serialized server-side and rehydrated client-side today.
2. A decision document records whether atom-based hydration replaces signal hydration
   entirely, layers on top, or requires a new protocol — with rationale.
3. Any breaking changes to the existing `initAtomHydration()` / `setAtom()` API surface
   are identified and a migration path is proposed.

**Plans**: 1 plan

Plans:
- [x] 12-01-PLAN.md — Write decision document (dual-channel architecture confirmation, gap assessment, API stability)

---

### Phase 13: Benchmarks — Freak vs Fresh

**Goal**: Establish a repeatable benchmark suite comparing Freak against upstream Fresh 2
across key performance dimensions (handler throughput, build time, bundle size, startup
time) — results published as `packages/benchmarks/RESULTS.md`.

**Depends on**: Phase 11 (v2 complete; can run in parallel with Phase 12)

**Requirements**: BENCH-01, BENCH-02, BENCH-03

**Success Criteria** (what must be TRUE):
1. A benchmark harness in `packages/benchmarks/` runs against both Freak and upstream
   Fresh 2 and produces consistent, reproducible numbers.
2. Results are published as `packages/benchmarks/RESULTS.md` with methodology, raw
   numbers, and a summary table.
3. Any performance regressions introduced by Freak's Effect integration are identified
   and documented with root-cause notes.

**Plans**: 2 plans

Plans:
- [x] 13-01-PLAN.md — Scaffold three benchmark apps (freak-app, freak-plain-app, upstream-app) with parity routes
- [x] 13-02-PLAN.md — Benchmark scripts (oha throughput, hyperfine build, bundle size, startup), orchestrator, run suite, root-cause analysis, publish RESULTS.md

---

## Progress

**Execution Order**: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
(v1: Phases 2 and 3 are independent after Phase 1; Phase 4 requires Phase 3)
(v2: Each phase strictly requires the prior; Phase 10 requires all of 6-9)
(Phase 11 is an independent research + architecture track)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-02-18 |
| 2. Type-Safe API | 1/1 | Complete | 2026-02-21 |
| 3. Preact Atom Hooks | 1/1 | Complete | 2026-02-21 |
| 4. Atom Hydration | 2/2 | Complete | 2026-02-23 |
| 5. Example | 2/2 | Complete | 2026-02-24 |
| 6. Fresh Core Plumbing | 2/2 | Complete | 2026-02-25 |
| 7. @fresh/effect Package | 2/2 | Complete | 2026-02-25 |
| 8. HttpApi Integration | 2/2 | Complete | 2026-02-26 |
| 9. RPC Integration | 2/2 | Complete | 2026-02-27 |
| 10. Migration + Example | N/A | Skipped | 2026-02-27 |
| 11. Micro-App Architecture | 1/1 | Complete | 2026-02-27 |
| 12. Atom-Based Island Hydration | 1/1 | Complete | 2026-02-28 |
| 13. Benchmarks — Freak vs Fresh | 2/2 | Complete | 2026-02-28 |
| 14. Typed App Composition | 1/1 | Complete | 2026-03-01 |
| 15. Plugin Formal Type | 1/1 | Complete | 2026-03-01 |
| 16. Islands in Plugins | 1/1 | Complete | 2026-03-01 |
| 17. Typed Composition Demo | 1/1 | Complete | 2026-03-01 |

---

## Milestone: v3

Typed Plugin System — formal `Plugin<Config, S, R>` type, islands in mounted plugins
(BuildCache aggregation), and a multi-plugin demo with typed auth state flowing from
host `EffectApp` to plugin handlers without casts.

## v3 Phases

- [x] **Phase 14: Typed App Composition** — WeakMap state isolation, `runEffect()`, generic hydration functions, `createCounterPlugin<S>`
- [x] **Phase 15: Plugin Formal Type** — `Plugin<Config, S, R>` interface + `createPlugin()` factory
- [x] **Phase 16: Islands in Plugins** — BuildCache aggregation for plugin islands
- [x] **Phase 17: Typed Composition Demo** — Auth state + multi-plugin composition example

## v3 Phase Details

### Phase 14: Typed App Composition

**Goal**: Per-request state stored in module-level WeakMaps (not `ctx.state`), hydration
functions generic over `S`, `runEffect(ctx, eff)` returns honest `Promise<A>`, and plugin
factories parameterized over host state — all without any `as any` or forced casts.

**Depends on**: Phase 13 (v2 complete)

**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04

**Success Criteria** (what must be TRUE):
1. `setAtom(ctx, atom, value)` compiles with a typed ctx (`Context<HostState>`) without a cast — verified by TypeScript accepting the call in `counter_plugin.tsx`.
2. `runEffect(ctx, eff)` returns `Promise<Response>` and is accepted by `app.get()` — no `as unknown as Response` cast anywhere in plugin handler code.
3. Per-request state (hydration map + runner) lives in WeakMaps; `ctx.state` has no Symbol or `__frsh` keys — verified by inspecting `ctx.state` after a request.
4. `createCounterPlugin<HostState>()` is accepted by `hostApp.mountApp()` when `hostApp: EffectApp<HostState, R>` — TypeScript compiles without error.

**Plans**: 1 plan (complete)

Plans:
- [x] 14-01-PLAN.md — WeakMap hydration, SerializableAtom<A> type, runEffect(), generic setAtom, counter_plugin<S> factory, 8 integration tests

---

### Phase 15: Plugin Formal Type

**Goal**: A `Plugin<Config, S, R>` formal interface in `@fresh/core` documents what a
plugin provides (routes as `App<S>`, Effect service requirements as `R`) and what it
requires from the host (state shape `S`). A `createPlugin()` factory constructs a
typed plugin from a config object and App builder function.

**Depends on**: Phase 14 (typed composition must be solid before formalizing the interface)

**Requirements**: PLUG-01, PLUG-02, PLUG-03

**Success Criteria** (what must be TRUE):
1. `Plugin<Config, S, R>` interface compiles and `deno publish --dry-run` on `@fresh/core` succeeds — no Effect types leak into the public API.
2. `createPlugin(config, factory): Plugin<Config, S, R>` factory creates a plugin that can be mounted via `host.mountApp()` without any additional cast.
3. TypeScript produces a compile error when mounting a `Plugin<Config, { count: number }, R>` on a host `App<{ name: string }>` — state type mismatch is caught at the mount site.

**Plans**: 1 plan

Plans:
- [x] 15-01-PLAN.md — Plugin<Config,S,R> interface, createPlugin() factory, mount-site type checking, tests

---

### Phase 16: Islands in Plugins

**Goal**: Island components registered via `plugin.app.islands()` appear in the host's
BuildCache and produce correct SSR `<!--frsh:island:-->` markers. Two plugins with
different island sets can be mounted on the same host without chunk name collisions.

**Depends on**: Phase 15 (Plugin type must exist before BuildCache aggregation is designed)

**Requirements**: ISLD-01, ISLD-02, ISLD-03

**Success Criteria** (what must be TRUE):
1. A plugin that registers `CounterIsland` via `app.islands()` — after `mountApp()` — produces `<!--frsh:island:counter-island:-->` markers in SSR HTML from the host app.
2. The island component hydrates correctly on the client (chunk loaded, component mounted) — verified by running the host app in `deno task dev` and observing the island in devtools.
3. Mounting two plugins with different island sets on the same host produces no chunk naming errors — verified by running `deno task build` and checking the `_fresh/` output.

**Plans**: 1 plan

Plans:
- [x] 16-01-PLAN.md — BuildCache aggregation for mounted plugin islands, chunk isolation, SSR + hydration tests

---

### Phase 17: Typed Composition Demo

**Goal**: A runnable demo in `packages/examples/typed-composition/` shows two plugins
(`CounterPlugin`, `GreetingPlugin`) mounted on a single `EffectApp<AuthState>` host.
The host sets typed auth state via middleware; both plugins read it generically without
any cast. Both plugins register islands and set atoms; all state serializes correctly
into one `__FRSH_ATOM_STATE` blob.

**Depends on**: Phase 16 (islands in plugins must work)

**Requirements**: DEMO-01, DEMO-02, DEMO-03

**Success Criteria** (what must be TRUE):
1. The demo app starts with `deno task dev` without errors — two plugin route groups respond at `/counter/*` and `/greeting/*`.
2. Both plugins read `ctx.state.requestId` and `ctx.state.userId` from the typed `AuthState` without any cast — TypeScript compiles cleanly.
3. `serializeAtomHydration(ctx)` in the response handler returns a JSON blob containing atoms from both plugins — no collisions.

**Plans**: 1 plan

Plans:
- [x] 17-01-PLAN.md — AuthState host app, CounterPlugin + GreetingPlugin, multi-plugin routes, typed state, atom serialization, dev server smoke test

---
*Roadmap created: 2026-02-18*
*Last updated: 2026-03-01 — Phase 17 complete (Typed Composition Demo; milestone v3 CLOSED)*
