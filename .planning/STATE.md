# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-01)

**Core value:** Route handlers and Preact islands feel idiomatic in both Fresh and
Effect — no manual runtime wiring, no adapter boilerplate, just Effect returns
where you already write handlers.

**Current focus:** Milestone v3 — Typed Plugin System (Phase 16 plan 01 complete; Phase 17 next)

## Current Position

Phase: 16 of 17 (Islands in Plugins) — plan 1/1 complete
Plan: 1/1 complete in Phase 16
Status: Phase 16 plan 01 complete — ISLD-01/02/03 formal requirement tests for plugin islands in host BuildCache; 5 new tests passing
Last activity: 2026-03-01 — Completed 16-01-PLAN.md on branch worktree-typed-composition

Progress: [████░░░░░░] v3 in progress — Phases 14-16 (3/3) complete; Phase 17 pending

## Performance Metrics

**Velocity (v1):**
- Total plans completed: 9
- Average duration: ~4.2 min
- Total execution time: ~38 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 3/3 | 13 min | 4.3 min |
| 02-type-safe-api | 1/1 | 6 min | 6 min |
| 03-preact-atom-hooks | 1/1 | 2 min | 2 min |
| 04-atom-hydration | 2/2 | 8 min | 4 min |
| 05-example | 2/2 | 10 min | 5 min |
| 06-fresh-core-plumbing | 2/2 | 12 min | 6 min |
| 07-fresh-effect-package | 2/2 | 7 min | 3.5 min |
| 08-httpapi-integration | 2/2 | 13 min | 6.5 min |
| 09-rpc-integration | 2/2 | 15 min | 7.5 min |
| 10-migration-example | 0/TBD | — | — |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [05-02]: In-memory Map for TodoService instead of Deno KV — simpler, no external dependencies
- [05-02]: Resolver default throws HttpError(500) with Cause in error.cause — enters Fresh error chain
- [05-02]: Example app mapError maps NotFoundError → HttpError(404) — bypasses Fresh dev overlay
- [05-02]: HttpError < 500 flows through segment error handler to _error.tsx without dev overlay
- [v2-design]: `EffectApp<State, AppR>` wraps `App<State>` — Fresh routing untouched, Effect owns lifecycle
- [v2-design]: HttpApi + RPC both accumulate layers in `EffectApp.build()` → single `HttpRouter.toWebHandler` sub-handler
- [v2-design]: AbortController replaces Deno `unload` event for runtime lifecycle — wires to SIGTERM/SIGINT
- [v2-design]: `@fresh/plugin-effect` becomes a compat shim re-exporting from `@fresh/effect`
- [06-01]: EffectRunner type defined in handlers.ts (not app.ts) — avoids circular import via app.ts->commands.ts->segments.ts
- [06-01]: commands.ts applyCommands/applyCommandsInner thread effectRunner through all renderRoute closures
- [06-01]: isEffectLike and EffectRunner added to public mod.ts API for Phase 7 EffectApp use
- [06-02]: effectPlugin signature changed to effectPlugin(app, opts?) — app-first enables per-app isolation without global state
- [06-02]: createEffectDefine standalone path requires app as first arg when layer provided — throws descriptive error if called without app
- [06-02]: Type casts used in SC-2/SC-3 tests for app.get()/app.use() Effect returns — type-level EffectLike support deferred to Phase 7
- [07-01]: createEffectDefine in @fresh/effect is type-only (no app/layer args) — runtime is EffectApp's job
- [07-01]: registerSignalDisposal uses Deno.addSignalListener (SIGINT/SIGTERM) not globalThis.addEventListener('unload')
- [07-01]: setEffectRunner cast to App<any> needed due to State type variance in BuildCache — safe at runtime
- [07-01]: EffectApp.mountApp accepts App<State> not EffectApp — plain App for micro-app composition
- [07-02]: @ts-expect-error for app.get() type rejection: use typed variable pattern (const x: Parameters<typeof app.get>[1] = ...) so directive aligns with error line
- [07-02]: Deno ChildProcess streams must be cancelled after cp.status to avoid resource leak errors: await cp.stdout.cancel() + cp.stderr.cancel()
- [07-02]: signal_server.ts uses port:0 + onListen callback for subprocess readiness handshake (READY:<port>)
- [08-01]: registerSignalDisposal accepts generic disposeFn not ManagedRuntime — enables calling EffectApp.dispose() on signal so httpApi sub-handlers are included
- [08-01]: createEffectApp creates EffectApp first then registers signal disposal through effectApp.dispose() — _setCleanupSignals internal setter used for two-phase init
- [08-01]: httpApi() uses any casts throughout — groupLayers spread, apiLayer for toWebHandler, handler call — consistent with method signature's no-explicit-any
- [08-01]: No mod.ts re-exports for HttpApi types — users import from effect/unstable/httpapi directly; deno.json import map enables this
- [08-02]: httpApi() uses app.all(prefix + "/*") not app.use(prefix) — Fresh use() middleware only fires when UrlPatternRouter matches a Route; all() registers an actual route
- [08-02]: httpApi() strips prefix from request URL before forwarding to Effect handler — Effect HttpRouter knows paths relative to group root, not mount prefix
- [08-02]: Schema.FiniteFromString over Schema.NumberFromString for integer query params — NumberFromString accepts NaN (Getter.Number coercion, never fails); FiniteFromString decodes to Finite and rejects NaN
- [08-02]: Layer.provide(GroupLive, AppLayer) pre-composition needed before passing to httpApi() — ensures service dependencies are available when group builds handlers
- [09-01]: rpc() with protocol param ('http' | 'websocket') mirrors httpApi() — same Layer → toWebHandler → mount flow; RpcServer.layerHttp called with path '/' (prefix stripped in Fresh route)
- [09-01]: WebSocket dual-route registration: exact path for WS upgrade GET + path/* for sub-paths; both rewrite pathname to '/' for inner Effect router
- [09-01]: FetchHttpClient imported as namespace (import * as FetchHttpClient) — module exports layer/Fetch/RequestInit directly, not as namespace re-export
- [09-01]: Island hooks use Layer-as-any coercions for ManagedRuntime.make and Effect.runPromise — TypeScript leaves residual requirements in mergeAll result type; runtime is correct
- [09-01]: @effect/platform-browser@4.0.0-beta.13 added — BrowserSocket.layerWebSocket wraps globalThis.WebSocket for browser island WS support
- [09-02]: RpcTest.makeClient for unit tests — in-process, no FakeServer, no HTTP/WS setup needed
- [09-02]: ListItems() takes no args (not ListItems({})) — procedures without payload declared use zero-argument call
- [09-02]: RpcSchema.Stream(success, error) not stream:true — two-arg constructor for correct TS handler typing (handler returns Stream<A,E,R> directly)
- [09-02]: Stream.fromEffectSchedule(effect, schedule) — correct API in effect@4.0.0-beta.0 (repeatEffectWithSchedule doesn't exist)
- [09-02]: Effect.ignore not Effect.catchAll — correct API for swallowing all errors in this beta version
- [09-02]: main.ts restructured: const app captures createEffectApp(); rpc() called as standalone statement
- [09-02]: export const app = effectApp.use(...).fsRoutes().app — Builder.listen() calls setBuildCache() which uses JS private fields; EffectApp wrapper is not an App instance so setBuildCache fails; must export inner App<State> via .app getter
- [11-01]: Adopt programmatic plugin pattern (pluginName(config)(app)) as supported sub-app composition model — production-validated by workflowPlugin + authPlugin; mountApp limited to static prefix / no islands / no appWrapper / no fsRoutes
- [11-01]: Module Federation ruled inapplicable — browser-side mechanism, requires Vite, wrong problem layer for server-side route composition
- [11-01]: Fix mountApp deferred indefinitely — HIGH complexity (BuildCache aggregation, path-scoped appWrapper, dynamic prefix redesign) vs. LOW complexity plugin pattern already in production
- [13-01]: Builder({ root: import.meta.dirname }) required in dev.ts when running from outside the app directory — prevents _fresh/ being written to repo root
- [13-01]: Benchmark apps added as explicit workspace members in root deno.json — ./packages/* glob does not recursively cover nested apps/*/deno.json
- [13-01]: upstream-app pins jsr:@fresh/core@2.2.0 exactly (not range) — reproducible comparisons against known upstream baseline
- [13-02]: oha requires --ipv4 flag and 127.0.0.1 not localhost — macOS resolves localhost to ::1 (IPv6), oha defaults to IPv4
- [13-02]: upstream-app needs explicit fresh/internal import override — root deno.json maps 'fresh' to jsr:@fresh/core@^2.0.0 which resolves to local fork; upstream-app/deno.json must override with jsr:@fresh/core@2.2.0/internal
- [13-02]: Effect throughput overhead: 14.2% for trivial in-memory handler (freak-effect vs freak-plain); negligible for I/O-bound workloads
- [13-02]: Effect zero client bundle impact — server-only Effect usage tree-shaken completely from islands
- [13-02]: Effect startup overhead (+104ms) from Deno module graph resolution, not from ManagedRuntime.make()
- [12-01]: Atom hydration layers on top of signal hydration (parallel channels) — no replacement, no new protocol
- [12-01]: setAtom()/initAtomHydration()/setAtomHydrationHook() — no breaking changes, no migration required
- [12-01]: setAtomHydrationHookForApp() is dead code — stored in App#atomHydrationHook but FreshRuntimeScript never calls it; deferred
- [12-01]: Partials gap deferred — __FRSH_ATOM_STATE not emitted during Fresh Partial navigation; workaround: use RPC streams
- [12-01]: hydration.ts duplication (plugin-effect has identical local copy of effect/src/hydration.ts) — deferred pending JSR constraint verification
- [15-01]: Plugin<Config,S,R> phantom type via optional field (readonly _phantom?: R) — @fresh/core never imports Effect; R documents Effect service requirements at type level only
- [15-01]: instanceof App discriminator for Plugin vs App — 'handler' in appInstance always true (prototype chain), instanceof App is correct runtime discriminator
- [15-01]: createPlugin explicit return type required for JSR slow-types compliance
- [15-01]: CounterServiceIdentifier = typeof CounterService — exports service tag as type alias for Plugin<Config, S, CounterServiceIdentifier>
- [16-01]: No production source changes needed — island aggregation already implemented in app.ts mountApp (lines 421-423) and build_cache.ts IslandPreparer; Phase 16 plan 01 is tests-only
- [16-01]: ISLD-03 collision scenario tested with distinct function refs using same export name string ({ CounterIsland: CounterIsland2 }) — BuildCache keyed on ComponentType (function ref), so distinct refs never collide
- [16-01]: frsh:island SSR markers use component export name (not chunk name) — asserted on entry.exportName and HTML content

### Pending Todos

- Phase 10 skipped (MIG-02 done in Phase 9; no external users need MIG-01 compat shim)
- Phase 11 complete — follow-on candidates: Plugin<Config> formal type in @fresh/core, islands in plugins (BuildCache aggregation), ctx.state namespacing, plugin authoring DX

### Roadmap Evolution

- Phase 11 added (2026-02-25): Micro-App Architecture — research mountApp issues, evaluate Module Federation (https://github.com/module-federation/vite#readme), architectural decision for Freak app composition
- Phase 12 added (2026-02-28): Atom-Based Island Hydration — research replacing signal-based island hydration with atom-based hydration (Effect v4 atoms vs Preact signals mismatch)
- Phase 13 added (2026-02-28): Benchmarks — Freak vs Fresh — repeatable benchmark suite comparing handler throughput, hydration latency, build time, bundle size; results published to packages/benchmarks/

### Blockers/Concerns

- Pre-existing test failures due to missing `--allow-env` and `--allow-run` Deno permissions (not caused by v2 work)
- SC-2 browser verification still requires manual check: run `deno task dev` in example app, visit /rpc-demo, observe WS in devtools

## Session Continuity

Last session: 2026-03-01T21:24:25Z
Stopped at: Phase 16 plan 01 complete — ISLD-01/02/03 plugin islands tests, 5 new tests passing (c7823435)
Resume file: None
