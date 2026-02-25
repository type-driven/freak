# Requirements: Fresh + Effect v4 Integration

**Defined:** 2026-02-18
**Core Value:** Route handlers and Preact islands feel idiomatic in both Fresh and Effect — no manual runtime wiring, no adapter boilerplate.

## v1 Requirements

### Handler Integration

- [x] **HAND-01**: Route handler can return `Effect<Response | PageResponse<Data>, E>` and Fresh runs it
- [x] **HAND-02**: Effect detection uses `EffectTypeId` duck-type check (structural, no Effect import in `@fresh/core`)
- [x] **HAND-03**: `HandlerFn` union type extended with `EffectLike<A>` — no new `E` type parameter (preserves inference)
- [x] **HAND-04**: `createEffectDefine()` typed wrapper carries `R` (Layer requirements) through route definition
- [x] **HAND-05**: Unhandled Effect failures map to Fresh's existing error boundary / error page

### Plugin & Runtime

- [x] **PLUG-01**: `effectPlugin({ layer })` configures a `ManagedRuntime` from a user-supplied Effect `Layer`
- [x] **PLUG-02**: `effectPlugin()` with no arguments works using `Layer.empty` (zero-config path)
- [x] **PLUG-03**: `ManagedRuntime` attached to Fresh middleware context; available per-request via `ctx.state.effectRuntime`
- [x] **PLUG-04**: `ManagedRuntime` disposed cleanly on Deno `unload` event (Fresh has no app lifecycle hooks)

### Preact Atom Hooks

- [x] **ATOM-01**: `useAtom(atom)` hook returns `[value, set]` — native Preact hooks (no `preact/compat`)
- [x] **ATOM-02**: `useAtomValue(atom)` hook returns current atom value
- [x] **ATOM-03**: `useAtomSet(atom)` hook returns setter function

### Atom Hydration

- [x] **HYDR-01**: Server handler can set an atom value that is serialized into the island's initial props
- [x] **HYDR-02**: Fresh island boots with the pre-seeded atom value (client hydration from server state)
- [x] **HYDR-03**: Atoms have stable string identifiers for cross-boundary identity

### Example

- [x] **EXAM-01**: `packages/examples/effect-integration/` demonstrates an Effect-returning handler with a typed Layer
- [x] **EXAM-02**: Example includes a Preact island using `useAtom` with a value hydrated from the server

## v2 Requirements

### Core Integration

- [x] **CORE-01**: Fresh core supports per-app Effect runner — `setEffectRunner(app, fn)` replaces global `_effectResolver`
- [x] **CORE-02**: Effect handlers work via `app.get()` / `app.post()` — not just `app.route()`
- [x] **CORE-03**: Effect middlewares work via `app.use()` — `runMiddlewares` resolves Effect returns using app runner

### Effect App

- [x] **EAPP-01**: `createEffectApp<State, AppR>({ layer })` wraps `App<State>` with a typed Layer
- [x] **EAPP-02**: `EffectApp` proxies all `App<State>` builder methods (`use`, `route`, `get`, `post`, etc.)
- [x] **EAPP-03**: Per-app `ManagedRuntime` lifecycle via `AbortController` — disposed on SIGTERM/SIGINT, not Deno `unload`
- [x] **EAPP-04**: `createEffectDefine<State, R>()` in `@fresh/effect` carries R type through handler definitions

### HTTP API Integration

- [ ] **HAPI-01**: `app.httpApi(api, groupImpls)` mounts an Effect `HttpApi` at its declared path prefix
- [ ] **HAPI-02**: HttpApi handlers receive fully decoded and typed `params`, `query`, `payload`, `headers`
- [ ] **HAPI-03**: HttpApi typed errors are auto-encoded to HTTP responses with correct status codes (404, 422, etc.)

### RPC Integration

- [ ] **RPC-01**: `app.rpc({ group, path, protocol })` mounts an Effect `RpcServer` — Deno native via `platform-deno-smol`
- [ ] **RPC-02**: RPC supports both HTTP and WebSocket protocols
- [ ] **RPC-03**: `useRpcClient(group)` in Preact islands returns a fully typed RPC client

### Migration

- [ ] **MIG-01**: `@fresh/plugin-effect` re-exports from `@fresh/effect` — zero breaking changes for v1 users
- [ ] **MIG-02**: Updated `packages/examples/effect-integration/` demonstrates `createEffectApp` + `httpApi` + `rpc`

## Out of Scope

| Feature | Reason |
|---------|--------|
| Effect v3 support | v4 beta is the target; v3 uses different Runtime API; separate integration needed |
| React bindings | Fresh uses Preact; React is not in scope |
| Per-request Layer provisioning | Performance overhead + confusion; `ManagedRuntime` created once at startup |
| Replacing `@preact/signals` | Signals are load-bearing in Fresh; atoms are additive |
| Framework-level Schema validation | Mismatch with file-system routing model; too opinionated |
| Effect Stream over HTTP | Unvalidated in Deno HTTP server; separate streaming story needed |
| `preact/compat` path for atom-react | Runtime conflicts documented in Fresh issue #1491; native hooks are simpler |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HAND-01 | Phase 1 — Foundation | Complete |
| HAND-02 | Phase 1 — Foundation | Complete |
| HAND-03 | Phase 1 — Foundation | Complete |
| HAND-04 | Phase 2 — Type-Safe API | Complete |
| HAND-05 | Phase 1 — Foundation | Complete |
| PLUG-01 | Phase 1 — Foundation | Complete |
| PLUG-02 | Phase 1 — Foundation | Complete |
| PLUG-03 | Phase 1 — Foundation | Complete |
| PLUG-04 | Phase 1 — Foundation | Complete |
| ATOM-01 | Phase 3 — Preact Atom Hooks | Complete |
| ATOM-02 | Phase 3 — Preact Atom Hooks | Complete |
| ATOM-03 | Phase 3 — Preact Atom Hooks | Complete |
| HYDR-01 | Phase 4 — Atom Hydration | Complete |
| HYDR-02 | Phase 4 — Atom Hydration | Complete |
| HYDR-03 | Phase 4 — Atom Hydration | Complete |
| EXAM-01 | Phase 5 — Example | Complete |
| EXAM-02 | Phase 5 — Example | Complete |

| CORE-01 | Phase 6 — Fresh Core Plumbing | Complete |
| CORE-02 | Phase 6 — Fresh Core Plumbing | Complete |
| CORE-03 | Phase 6 — Fresh Core Plumbing | Complete |
| EAPP-01 | Phase 7 — @fresh/effect Package | Complete |
| EAPP-02 | Phase 7 — @fresh/effect Package | Complete |
| EAPP-03 | Phase 7 — @fresh/effect Package | Complete |
| EAPP-04 | Phase 7 — @fresh/effect Package | Complete |
| HAPI-01 | Phase 8 — HttpApi Integration | Pending |
| HAPI-02 | Phase 8 — HttpApi Integration | Pending |
| HAPI-03 | Phase 8 — HttpApi Integration | Pending |
| RPC-01 | Phase 9 — RPC Integration | Pending |
| RPC-02 | Phase 9 — RPC Integration | Pending |
| RPC-03 | Phase 9 — RPC Integration | Pending |
| MIG-01 | Phase 10 — Migration + Example | Pending |
| MIG-02 | Phase 10 — Migration + Example | Pending |

**Coverage:**
- v1 requirements: 17 total — all Complete ✓
- v2 requirements: 15 total
- v2 mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-18*
*Last updated: 2026-02-25 after milestone v2 start — v2 requirements added (CORE, EAPP, HAPI, RPC, MIG)*
