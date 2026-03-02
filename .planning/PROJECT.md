# Fresh + Effect v4 Integration

## What This Is

Native Effect v4 support in Fresh, the Deno web framework. Route handlers return
`Effect<Response | PageResponse<Data>, E, R>` with full service-requirement
typing. `EffectApp<State, AppR>` wraps `App<State>` with a typed Layer, per-app
lifecycle, schema-first `HttpApi` mounting, and native Deno RPC via
`platform-deno-smol`.

## Core Value

Route handlers and Preact islands feel idiomatic in both Fresh and Effect — no
manual runtime wiring, no adapter boilerplate, just Effect returns where you
already write handlers.

## Current Milestone: v3 — Typed Plugin System

**Goal:** First-class typed plugin composition — `Plugin<Config, S, R>` formal
type, islands in plugins (BuildCache aggregation), and a multi-plugin demo with
typed auth state flowing from host to plugin handlers.

**Target features:**

- Typed App Composition — WeakMap state isolation, `runEffect()`, generic
  hydration functions
- `Plugin<Config, S, R>` formal interface + `createPlugin()` factory
- Islands in plugins (BuildCache aggregation)
- Multi-plugin typed composition demo

## Requirements

### Validated

- ✓ Fresh 2 route handler system (`HandlerFn`, `RouteHandler`, `page()`) — v1
  Phase 1
- ✓ Preact island architecture with client hydration — existing
- ✓ Fresh plugin API for third-party integrations — existing
- ✓ Effect detection via `EffectLike` duck-type; no Effect import in
  `@fresh/core` — v1 Phase 1
- ✓ `effectPlugin({ layer })` wires `ManagedRuntime` into Fresh via `app.use()`
  — v1 Phase 1
- ✓ `createEffectDefine<State, R>()` carries service requirements through
  handler definitions — v1 Phase 2
- ✓ `useAtom`, `useAtomValue`, `useAtomSet` native Preact hooks (no
  preact/compat) — v1 Phase 3
- ✓ Server-to-client atom hydration via `setAtom()` + `<script>` injection — v1
  Phase 4
- ✓ End-to-end example in `packages/examples/effect-integration/` — v1 Phase 5
- ✓ Per-app Effect runner replaces global `_effectResolver` singleton — v2 Phase
  6
- ✓ `EffectApp<State, AppR>` wraps `App<State>` with typed Layer + per-app
  lifecycle — v2 Phase 7
- ✓ `app.httpApi()` mounts schema-first Effect HttpApi routes — v2 Phase 8
- ✓ `app.rpc()` mounts native Effect RPC server; `useRpcClient()` in islands —
  v2 Phase 9
- ✓ mountApp propagates islands, effectRunner, atomHydrationHook from inner to
  outer — v2 Phase 11
- ✓ Dual-channel hydration: signals for island props, atoms for global state —
  v2 Phase 12

### Active

- [ ] `setAtom<A,S>`, `serializeAtomHydration<S>`, `initAtomHydrationMap<S>`
      generic over host state
- [ ] `runEffect(ctx, eff)` returns `Promise<A>` — no Effect-as-Response cast at
      call sites
- [ ] WeakMap-based per-request state: hydration maps + Effect runner on ctx,
      not ctx.state
- [ ] `createCounterPlugin<S = unknown>(): App<S>` — plugin factory generic over
      host state
- [ ] `Plugin<Config, S, R>` formal interface in `@fresh/core`
- [ ] `createPlugin()` factory creates typed plugins from config + App builder
- [ ] TypeScript rejects mounting a plugin whose S is incompatible with host
      state
- [ ] Islands in plugins build correctly (BuildCache aggregation)
- [ ] Multi-plugin typed composition demo with typed auth state

### Out of Scope

- Effect v3 support — v4 is the target; separate integration path needed
- React bindings — Preact is the Fresh target
- Per-request Layer provisioning — performance overhead; `ManagedRuntime`
  created once at startup
- Replacing `@preact/signals` — atoms are additive, not a replacement
- Framework-level Schema validation at file-system routing layer — too
  opinionated

## Context

- Repository: Fresh framework monorepo (`packages/fresh`,
  `packages/plugin-effect`, `packages/examples`, etc.)
- Companion repo:
  `/Users/davidpeter/workspace/type-driven.com/platform-deno-smol` — Effect-TS
  source (effect-smol beta)
  - `packages/effect/src/unstable/http/` — HttpRouter, HttpApp, HttpEffect
  - `packages/effect/src/unstable/httpapi/` — HttpApi, HttpApiGroup,
    HttpApiEndpoint, HttpApiBuilder
  - `packages/effect/src/unstable/rpc/` — Rpc, RpcGroup, RpcServer, RpcClient,
    RpcMiddleware
  - `packages/platform-deno/src/` — DenoRuntime, DenoWorker (no HttpServer — use
    `HttpRouter.toWebHandler`)
- Deno integration: `HttpRouter.toWebHandler(appLayer)` → `{ handler, dispose }`
  → `Deno.serve`
- `_effectResolver` in `segments.ts` is currently a module-level global — last
  writer wins
- v2 strategy: `EffectApp<State, AppR>` wraps `App<State>`, delegates routing to
  Fresh, owns Effect lifecycle
- Stack: Deno 2, TypeScript, Fresh 2, Preact, Effect v4 (effect-smol beta)

## Constraints

- **Tech stack**: Deno 2, Fresh 2, Preact — no React, no Node-specific APIs
- **Backwards compatibility**: `effectPlugin()` must keep working; zero breaking
  changes for v1 users
- **Deno-native**: RPC uses `platform-deno-smol` — no Node adapters
- **JSR publishing**: `@fresh/core` must never import `npm:effect` types in its
  public API
- **Per-app isolation**: Multiple `App` instances in the same process (e.g., in
  tests) must not interfere

## Key Decisions

| Decision                                              | Rationale                                                                                      | Outcome                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------- |
| Extend HandlerFn union rather than a new handler type | Least breaking, existing routes unaffected                                                     | ✓ Good                                 |
| Native Preact hooks (no preact/compat)                | Avoids dual reconciler conflict (Fresh issue #1491)                                            | ✓ Good                                 |
| `EffectLike` duck-type for Effect detection in core   | Keeps `@fresh/core` free of npm:effect; JSR-safe                                               | ✓ Good                                 |
| Global `_effectResolver` for v1                       | Fastest path; only one runtime per process in v1                                               | ✓ Fixed — per-app runner in v2 Phase 6 |
| `EffectApp<State, AppR>` wraps `App<State>`           | Fresh routing/segments/islands untouched; Effect owns lifecycle only                           | ✓ Good                                 |
| HttpApi/RPC via `HttpRouter.toWebHandler` sub-handler | Effect HTTP stack fully intact; Fresh dispatches by URL prefix                                 | ✓ Good                                 |
| AbortController for runtime lifecycle                 | Replaces unreliable Deno `unload` event; wires to SIGTERM/SIGINT                               | ✓ Good                                 |
| WeakMap for per-request hydration + runner storage    | ctx.state stays user-domain only; no Symbol keys; GC-friendly                                  | ✓ Good — v3 Phase 14                   |
| `runEffect(ctx, eff): Promise<A>` for plugin handlers | Honest return type, no Effect-as-Response cast; per-ctx runner from WeakMap                    | ✓ Good — v3 Phase 14                   |
| `SerializableAtom<A>` typed interface                 | Replaces `(atom as any)` with structural type using SerializableTypeId key                     | ✓ Good — v3 Phase 14                   |
| Programmatic plugin pattern over fixing mountApp      | mountApp has deep BuildCache issues; plugin pattern (App<S> + factory) is production-validated | ✓ Good — v2 Phase 11                   |

---

_Last updated: 2026-03-01 after milestone v3 start_
