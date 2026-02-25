# Fresh + Effect v4 Integration

## What This Is

Native Effect v4 support in Fresh, the Deno web framework. Route handlers return
`Effect<Response | PageResponse<Data>, E, R>` with full service-requirement typing.
`EffectApp<State, AppR>` wraps `App<State>` with a typed Layer, per-app lifecycle,
schema-first `HttpApi` mounting, and native Deno RPC via `platform-deno-smol`.

## Core Value

Route handlers and Preact islands feel idiomatic in both Fresh and Effect — no
manual runtime wiring, no adapter boilerplate, just Effect returns where you
already write handlers.

## Requirements

### Validated

- ✓ Fresh 2 route handler system (`HandlerFn`, `RouteHandler`, `page()`) — v1 Phase 1
- ✓ Preact island architecture with client hydration — existing
- ✓ Fresh plugin API for third-party integrations — existing
- ✓ Effect detection via `EffectLike` duck-type; no Effect import in `@fresh/core` — v1 Phase 1
- ✓ `effectPlugin({ layer })` wires `ManagedRuntime` into Fresh via `app.use()` — v1 Phase 1
- ✓ `createEffectDefine<State, R>()` carries service requirements through handler definitions — v1 Phase 2
- ✓ `useAtom`, `useAtomValue`, `useAtomSet` native Preact hooks (no preact/compat) — v1 Phase 3
- ✓ Server-to-client atom hydration via `setAtom()` + `<script>` injection — v1 Phase 4
- ✓ End-to-end example in `packages/examples/effect-integration/` — v1 Phase 5

### Active

- [ ] Per-app Effect runner replaces global `_effectResolver` singleton — no last-writer-wins
- [ ] Effect handlers work via `app.get()`/`app.post()` (not just `app.route()`)
- [ ] Effect middlewares work via `app.use()` — not just route handlers
- [ ] `createEffectApp<State, AppR>({ layer })` wraps App with typed Layer
- [ ] Per-app ManagedRuntime lifecycle via AbortController (not Deno `unload` event)
- [ ] `app.httpApi(api, groupImpls)` mounts schema-first Effect HttpApi routes
- [ ] `app.rpc({ group, path, protocol })` mounts native Effect RPC server
- [ ] `useRpcClient(group)` in islands returns a typed, schema-validated RPC client
- [ ] `@fresh/plugin-effect` continues working unchanged (compat shim)

### Out of Scope

- Effect v3 support — v4 is the target; separate integration path needed
- React bindings — Preact is the Fresh target
- Per-request Layer provisioning — performance overhead; `ManagedRuntime` created once at startup
- Replacing `@preact/signals` — atoms are additive, not a replacement
- Framework-level Schema validation at file-system routing layer — too opinionated

## Context

- Repository: Fresh framework monorepo (`packages/fresh`, `packages/plugin-effect`, `packages/examples`, etc.)
- Companion repo: `/Users/davidpeter/workspace/type-driven.com/platform-deno-smol` — Effect-TS source (effect-smol beta)
  - `packages/effect/src/unstable/http/` — HttpRouter, HttpApp, HttpEffect
  - `packages/effect/src/unstable/httpapi/` — HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder
  - `packages/effect/src/unstable/rpc/` — Rpc, RpcGroup, RpcServer, RpcClient, RpcMiddleware
  - `packages/platform-deno/src/` — DenoRuntime, DenoWorker (no HttpServer — use `HttpRouter.toWebHandler`)
- Deno integration: `HttpRouter.toWebHandler(appLayer)` → `{ handler, dispose }` → `Deno.serve`
- `_effectResolver` in `segments.ts` is currently a module-level global — last writer wins
- v2 strategy: `EffectApp<State, AppR>` wraps `App<State>`, delegates routing to Fresh, owns Effect lifecycle
- Stack: Deno 2, TypeScript, Fresh 2, Preact, Effect v4 (effect-smol beta)

## Constraints

- **Tech stack**: Deno 2, Fresh 2, Preact — no React, no Node-specific APIs
- **Backwards compatibility**: `effectPlugin()` must keep working; zero breaking changes for v1 users
- **Deno-native**: RPC uses `platform-deno-smol` — no Node adapters
- **JSR publishing**: `@fresh/core` must never import `npm:effect` types in its public API
- **Per-app isolation**: Multiple `App` instances in the same process (e.g., in tests) must not interfere

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Extend HandlerFn union rather than a new handler type | Least breaking, existing routes unaffected | ✓ Good |
| Native Preact hooks (no preact/compat) | Avoids dual reconciler conflict (Fresh issue #1491) | ✓ Good |
| `EffectLike` duck-type for Effect detection in core | Keeps `@fresh/core` free of npm:effect; JSR-safe | ✓ Good |
| Global `_effectResolver` for v1 | Fastest path; only one runtime per process in v1 | ⚠️ Revisit — last-writer-wins bug, per-app isolation needed |
| `EffectApp<State, AppR>` wraps `App<State>` | Fresh routing/segments/islands untouched; Effect owns lifecycle only | — Pending |
| HttpApi/RPC via `HttpRouter.toWebHandler` sub-handler | Effect HTTP stack fully intact; Fresh dispatches by URL prefix | — Pending |
| AbortController for runtime lifecycle | Replaces unreliable Deno `unload` event; wires to SIGTERM/SIGINT | — Pending |

---
*Last updated: 2026-02-25 after milestone v2 start*
