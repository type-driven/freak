# Project Research Summary

**Project:** Fresh + Effect v4 Integration (freak)
**Domain:** Framework capability — native Effect v4 support in Fresh 2 (Deno web framework)
**Researched:** 2026-02-18
**Confidence:** MEDIUM — stack and architecture verified from source; atom Preact compat unverified

## Executive Summary

This project adds native Effect v4 support to Fresh 2, targeting three capabilities: Effect-returning route handlers, Preact island atom hooks (`useAtom`, `useAtomValue`, `useAtomSet`), and server-to-client atom hydration. The Effect v4 ecosystem is in active beta (`4.0.0-beta.0`), which means the Atom API now lives inside the core `effect` package at `effect/unstable/reactivity/Atom` — no separate `@effect-atom/atom` dependency needed for v4. Critically, no `@effect/atom-preact` package exists from either the official team or the community, so Preact atom hooks must be built from scratch using native `preact/hooks`.

The recommended architecture is fully opt-in and non-breaking: a `packages/plugin-effect` package wires a `ManagedRuntime` singleton into Fresh via `app.use()`, and a registered resolver hook in `segments.ts` detects and runs Effect-returning handlers. Fresh core gets three minimal, targeted changes: a hook registration point in `renderRoute` (~5 lines), an extensible stringifiers registry in `preact_hooks.ts`, and an extensible `CUSTOM_PARSER` in `reviver.ts`. Effect types never appear in `@fresh/core`'s public API — JSR publishing safety is maintained by using a structural `EffectLike` duck-type for detection.

The biggest risks are: (1) Effect v4 atom API churn before stable release — mitigated by an adapter module that isolates all atom imports, and (2) TypeScript inference cascades if `HandlerFn` gains an `E` type parameter — mitigated by keeping `HandlerFn` unchanged and detecting Effect returns purely at runtime. The Preact compat path for `@effect/atom-react` is plausible (all required React APIs are shimmed in `preact/compat`) but carries real risk of subtle hook reconciler conflicts; native Preact hook implementation is recommended.

## Key Findings

### Recommended Stack

Effect v4's architectural reorganization is a net benefit for this integration: atoms are now in core, `ManagedRuntime` is unchanged, and the package surface is smaller. The v3 `@effect-atom/atom` package is fully incompatible (requires `effect@^3.19.x`; imports `effect/Runtime` which was removed in v4). Use only `effect@4.0.0-beta.0` and import atoms from `effect/unstable/reactivity/Atom`.

For Preact hooks, the native port approach is recommended over `preact/compat` aliasing. The hook implementation in `@effect/atom-react` is ~200 lines and uses only `useSyncExternalStore`, `useContext`, `useState`, `useEffect`, `useMemo`, `useCallback` — all available in `preact/hooks`. Building natively avoids the compat aliasing pitfall documented in Fresh's own issue tracker.

**Core technologies:**
- `effect@4.0.0-beta.0`: Effect core + atoms (`effect/unstable/reactivity/Atom`, `effect/unstable/reactivity/AtomRegistry`) — bundled, no separate atom package needed for v4
- `ManagedRuntime` (from `effect`): Server-side runtime singleton — created once at app start, shared across all requests, disposed on `unload` event
- `jsr:@fresh/core@^2.0.0`: Existing framework — modified in 3 targeted files, never importing Effect types
- `npm:preact@^10.28.2`: Existing island renderer — Preact-native atom hooks implemented directly against `preact/hooks`, no `preact/compat` dependency

### Expected Features

**Must have (table stakes):**
- Effect-returning route handlers (`Effect<Response | PageResponse<Data>, E, never>`) — the core value proposition; without this nothing else matters
- App-level runtime configuration via `effectPlugin({ layer })` — required for handlers to have services available
- Typed error-to-response mapping (`mapError` on plugin config) — required for production safety; unhandled Effect failures crash the Deno process
- `useAtom` / `useAtomValue` / `useAtomSet` Preact hooks — differentiator that justifies framework-level integration vs user-land wiring
- Working example in `packages/examples/` — required to demonstrate the integration end-to-end

**Should have (differentiator):**
- Server-to-client atom hydration — eliminates client-side loading flash; architecturally complex but the feature that makes atoms genuinely useful in SSR
- `createEffectDefine()` for type-safe service access in handlers — type-level only, high DX value, low effort once handler types are stable
- Effect-native error pages (`app.onError` with Effect handler) — free once handler detection exists

**Defer to v2+:**
- Effect-returning middleware with `ctx.nextEffect()` — requires `Context` type changes that affect all Fresh users; `yield* Effect.promise(() => ctx.next())` is a usable v1 workaround
- Streaming responses from `Effect<Stream<Uint8Array>>` — Effect v4 stream semantics unvalidated in Deno's HTTP layer
- Schema validation at framework level — complexity far exceeds v1 scope; better as user-land library
- Global signal replacement — Effect atoms and `@preact/signals` should coexist, not compete

### Architecture Approach

The integration follows a single guiding principle: Effect is detected and resolved at one call site (`segments.ts:renderRoute`), invisibly to everything above and below. A registered resolver hook pattern keeps Fresh core free of any Effect import. The plugin creates a `ManagedRuntime` singleton before the request loop starts, attaches it to `ctx.state` via middleware, and `renderRoute` calls the resolver (if registered) after `await fn(ctx)`. Island serialization is extended via registerable stringifiers (server) and a mutable `CUSTOM_PARSER` (client).

**Major components:**
1. `packages/plugin-effect/src/runtime.ts` — `ManagedRuntime` lifecycle: `make(layer)` at startup, `dispose()` on Deno `unload` event; attached to `ctx.state.effectRuntime` per-request via middleware
2. `packages/plugin-effect/src/island.ts` — Native Preact atom hooks (`useAtom`, `useAtomValue`, `useAtomSet`) implemented against `preact/hooks`; no `react` or `preact/compat` import
3. `packages/fresh/src/segments.ts` (targeted change) — `setEffectResolver()` registration point; `renderRoute` calls registered resolver after handler invocation; ~5 lines changed
4. `packages/plugin-effect/src/stringifiers.ts` + `parser.ts` — Server-side atom value serialization and client-side reconstruction; extends Fresh's existing `Stringifiers` / `CUSTOM_PARSER` registries
5. `packages/examples/` — Working example demonstrating the full stack: Effect handler + atom hydration + island hooks

### Critical Pitfalls

1. **JSR publishing: Effect types in `@fresh/core` public API** — If `HandlerFn` is extended to include `Effect<...>` in its union and `Effect` is imported from `npm:effect`, JSR's "no slow types" rule breaks publishing. Prevention: keep Effect types out of core entirely; use duck-typed `EffectLike` structural type; validate with `deno publish --dry-run` on every PR touching public type exports.

2. **`HandlerFn` union extension causes TypeScript inference cascade** — Adding an `E` type param to `HandlerFn` cascades into `RouteHandler`, `HandlerByMethod`, `Route`, `Define`, and every route file in every Fresh app. Prevention: do not modify `HandlerFn`; define `EffectHandlerFn` in `plugin-effect` only; detect Effect returns at runtime in the resolver, not at the type level in core.

3. **Preact/React reconciler conflict in islands** — If `@effect/atom-react` is imported into islands via `preact/compat` aliasing and the reconciler registries don't fully merge, hooks state is stored in different slots causing double renders and teardown failures. Prevention: implement atom hooks natively using `preact/hooks` with zero `react` imports; this is the recommended path from both this research and Fresh's own issue tracker.

4. **`ManagedRuntime` lifecycle mismatch** — Fresh has no `onStart`/`onShutdown` app lifecycle hooks. Creating the runtime per-request leaks connections; creating it as an uncommitted global leaks on process exit. Prevention: create runtime once when `effectPlugin()` is called (before request loop); attach `globalThis.addEventListener("unload", () => runtime.dispose())` for cleanup; never create inside request handler.

5. **Unhandled Effect errors crash Deno** — Unlike Node.js, Deno has no `unhandledRejection` safety net — unhandled promise rejections exit the process. Prevention: dispatch layer must use `runtime.runPromiseExit(effect)` (typed `Exit<A, E>`) rather than `runPromise`; `Exit.Failure` is always caught and converted to `Response` before returning, never re-thrown.

## Implications for Roadmap

Based on research, the dependency graph enforces a clear phase order. Types and architecture decisions come first (JSR safety, inference stability), then runtime wiring, then the plugin package, then the atom layer on top.

### Phase 1: Foundation — Types, Runtime Detection, Error Handling

**Rationale:** Every subsequent phase depends on handler detection and runtime wiring being correct. The JSR constraint and TypeScript inference pitfalls must be resolved before writing any implementation. This phase has no external unknowns — all decisions can be made from existing research.

**Delivers:** `isEffect()` duck-typed detector (verified TypeId symbol); `EffectLike` structural type in plugin-effect only; `setEffectResolver()` hook in `segments.ts`; `effectPlugin()` middleware creating `ManagedRuntime` singleton; error dispatch using `runPromiseExit` with typed failure handling; `mapError` config option; runtime disposal on `unload` event.

**Addresses:** Features 1 (Effect handler detection), 2 (runtime configuration), 4 (error mapping).

**Avoids:** Pitfalls 2 (JSR constraint), 4 (HandlerFn cascade), 5 (runtime lifecycle), 9 (error channel crash).

**Research flag:** Needs one targeted lookup — the exact `Effect.EffectTypeId` symbol string from Effect v4 source. Everything else is decided.

### Phase 2: Type-Safe Handler API (`createEffectDefine`)

**Rationale:** Once the runtime dispatch works, threading the `R` type parameter through `createEffectDefine<State, Services>()` is purely type-level work with no runtime changes. This is low effort, high DX value, and validates the type design before building the more complex atom layer.

**Delivers:** `createEffectDefine<State, R>()` in `plugin-effect`; `RouteData<H>` extended with `EffectHandlerFn` branch; TypeScript inference tests (`expect-type` assertions) for handler-to-page data flow.

**Addresses:** Feature 7 (type-safe service access), Feature 8 (Effect error pages, which are free once Phase 1 exists).

**Avoids:** Pitfall 10 (`data: never` inference regression for Effect handlers).

**Research flag:** Standard TypeScript type-level patterns. No additional research needed.

### Phase 3: Preact Atom Hooks (Native Implementation)

**Rationale:** This phase is independent of island hydration (Phase 4) but must precede it. Building native Preact hooks first — before tackling the serialization protocol — lets us validate the atom subscription lifecycle in isolation. Doing compat aliasing first would risk discovering the reconciler conflict only after the hydration layer is built on top.

**Delivers:** `packages/plugin-effect/src/island.ts` with native `useAtom`, `useAtomValue`, `useAtomSet`, `useAtomMount` using `preact/hooks`; `RegistryProvider` component; bundle size measurement for a minimal Counter island.

**Addresses:** Feature 5 (island hooks).

**Avoids:** Pitfall 3 (Preact/React compat conflict), Pitfall 8 (bundle size — measured early, before committing to design).

**Research flag:** Needs phase-level research to verify the exact `effect/unstable/reactivity/Atom` v4 API before implementing hooks. The `unstable/` prefix means the API may differ from v3 `@effect-atom/atom`. Confirm: constructor signatures, `AtomRegistry.make()`, `subscribe()` callback shape, `AsyncResult` vs `Result` type.

### Phase 4: Server-to-Client Atom Hydration

**Rationale:** This is the most architecturally complex phase and depends on Phase 3 hooks being stable. The serialization protocol must be designed before implementation — atom identity across the server/client boundary is non-trivial (atoms are objects, not strings).

**Delivers:** Extensible `Stringifiers` registry in `preact_hooks.ts`; extensible `CUSTOM_PARSER` in `reviver.ts`; `EffectAtom` stringifier and parser in `plugin-effect`; atom identity via stable string keys; atom runtime initialized client-side before `boot()` revives islands.

**Addresses:** Feature 6 (server-to-client hydration).

**Avoids:** Pitfall 6 (non-serializable atom state — serialize values only, never atom objects), Pitfall 11 (SSR lazy atom computation — force atom evaluation in handler before returning Effect).

**Research flag:** Blocked on one unknown: does `effect/unstable/reactivity/Atom` v4 support pre-seeded initial values? If `Atom.state(initialValue)` creates a synchronously-available atom, hydration is straightforward. If not, a Context-injection strategy is needed. Verify from source before starting this phase.

### Phase 5: Example and Integration Validation

**Rationale:** A working `packages/examples/` app is required per the project spec and validates the full integration end-to-end. This phase also serves as the integration test that surfaces any remaining cross-phase issues.

**Delivers:** `packages/examples/` with: Effect-returning GET handler using a service from `AppLayer`; an island component using `useAtomValue`; server-side atom hydration so the island starts with server data; typed error handling with `mapError`.

**Addresses:** Feature — working example (project constraint).

**Research flag:** Standard patterns. If Phases 1-4 are solid, this phase is assembly, not research.

### Phase Ordering Rationale

- **Types before runtime:** The JSR constraint and TypeScript inference pitfalls are architecture-level decisions that cannot be fixed post-hoc without breaking changes. They gate everything.
- **Hooks before hydration:** Atom subscription lifecycle must be validated in isolation before layering the serialization protocol on top. Discovering a reconciler conflict after building hydration would require unwinding two phases.
- **Runtime singleton first, per-request access second:** The `ManagedRuntime` lifecycle (create once, dispose on unload) is a correctness requirement, not a performance optimization. It must be correct before any handler runs.
- **Adapter module from day one:** All atom and Effect imports in `plugin-effect` go through `packages/plugin-effect/src/effect_adapter.ts`. When Effect v4 stable changes import paths (likely), only one file updates.

### Research Flags

Phases needing deeper research during planning:
- **Phase 1:** Verify exact `Effect.EffectTypeId` symbol string from `effect` v4 source before implementing `isEffect()`.
- **Phase 3:** Verify `effect/unstable/reactivity/Atom` v4 API surface (constructor signatures, `AsyncResult` vs `Result`, `AtomRegistry.make()` options). The `unstable/` marker means this may differ from v3 docs.
- **Phase 4:** Verify whether v4 atoms support pre-seeded initial values before designing the hydration serialization protocol.

Phases with standard patterns (skip research-phase):
- **Phase 2:** Pure TypeScript type-level work; patterns well-established in existing `createDefine()` and `RouteData` infrastructure.
- **Phase 5:** Assembly phase; no novel patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | npm registry + GitHub source verified; exact package versions confirmed; v3/v4 incompatibility verified from source |
| Features | MEDIUM-HIGH | Fresh internals verified from source; feature boundaries clear; Preact compat compatibility for atom-react unverified (LOW) |
| Architecture | HIGH | Handler call site (`segments.ts:183`) verified from direct source read; island serialization mechanism verified from `preact_hooks.ts` + `reviver.ts` source |
| Pitfalls | HIGH | Most pitfalls verified from first-party sources (Fresh issue tracker, JSR docs, Deno effect-smol issue, Effect official docs) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Effect TypeId symbol exact value:** `isEffect()` requires the precise symbol string from `effect` v4 source. Lookup during Phase 1 implementation before writing the detector.
- **v4 Atom pre-seeding API:** Whether `effect/unstable/reactivity/Atom` supports synchronous initial values determines the entire hydration strategy. Verify from source before starting Phase 4.
- **Preact compat for `@effect/atom-react`:** Recommended path is native Preact hooks (avoids the risk entirely). If native port is blocked for any reason, the compat path needs an isolated test before committing to it.
- **Deno Deploy cold start compatibility:** Effect module-level imports must not reference Node-specific APIs. Validate with a Deploy smoke test in CI before shipping Phase 1 (Pitfall 12).
- **`Request.signal` availability in Fresh `Context`:** Needed for AbortSignal integration in handler dispatch. Verify `ctx.req.signal` exists before implementing cancellation.

## Sources

### Primary (HIGH confidence)
- Fresh source: `packages/fresh/src/segments.ts`, `app.ts`, `handlers.ts`, `context.ts`, `middlewares/mod.ts`, `runtime/server/preact_hooks.ts`, `runtime/client/reviver.ts`, `jsonify/stringify.ts` — direct source reads
- npm registry: `https://registry.npmjs.org/effect` — dist-tags confirming `beta: 4.0.0-beta.0`, `latest: 3.19.18`
- npm registry: `https://registry.npmjs.org/@effect-atom/atom`, `@effect-atom/atom-react`, `@effect-atom/atom-preact`, `@effect/atom-react` — version and peer dep verification; `atom-preact` confirmed non-existent
- GitHub: `effect-TS/effect-smol` — `packages/atom/` directory (react/solid/vue only, no preact); `packages/atom/react/src/Hooks.ts` (v4 hook API); `MIGRATION.md` (v4 breaking changes)
- GitHub: `tim-smart/effect-atom` — `packages/atom/src/Atom.ts`, `packages/atom-react/src/Hooks.ts` (v3 hook API and React APIs used)
- GitHub: `effect-TS/effect` — `packages/effect/src/ManagedRuntime.ts` (confirmed present in v4)
- Effect official docs: `https://effect.website/docs/runtime/` — ManagedRuntime.make(), runPromise API
- JSR publishing docs: `https://jsr.io/docs/publishing-packages` — "no slow types" constraint
- Fresh issue tracker: `#1491` — dual reconciler conflict with React libraries in islands (first-party)

### Secondary (MEDIUM confidence)
- `effect-smol` TODOS.md — atom beta phase incomplete; atom API may change before stable
- Michael Arnaldi confirmation (community forum summary) — atom-react folding into Effect 4.0 core
- `effectbyexample.com/nextjs-api-handler` — ManagedRuntime pattern for Next.js API routes
- `@fastify/funky` GitHub — fp-ts + Fastify integration as design precedent

### Tertiary (LOW confidence)
- EffectTS_ tweet — "smaller bundles" claim for v4 (unverified; measure in Phase 3)
- Preact compat `useSyncExternalStore` behavioral parity with React 18 — not tested against `atom-react`; native hooks recommended to avoid entirely

---
*Research completed: 2026-02-18*
*Ready for roadmap: yes*
